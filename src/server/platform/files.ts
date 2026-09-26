import { createHash, randomUUID } from "node:crypto";
import type { SqlDatabase } from "../db/connection";
import { AppError } from "../kernel/errors";
import { nowIso } from "../kernel/ids";
import type { FileStorage, StoredFile } from "../providers/core";
import {
  listFilesFor,
  listOrphanFiles,
  safeFileName,
  toStored,
  type FileRow,
} from "../standalone/files";
import type { IntraForgeClient } from "./intraforge";

/**
 * FileStorage over IntraForge object storage. Bytes go through IntraForge's
 * own upload pipeline (size limit, content sniffing, optional malware scan,
 * SHA-256, audit) into the instance's bucket; this application keeps the
 * metadata row (storage_key = IntraForge's file id) in its schema, as the
 * contract's data model expects, and verifies the SHA-256 on every read.
 *
 * Transactions: bytes are stored before the row is written. If the
 * surrounding unit rolls back, the IntraForge file is left unreferenced (an
 * orphan in the application's bucket, visible and deletable in IntraForge
 * Storage) -- the contract allows this. Deleting removes the row now and the
 * IntraForge file only after the unit has committed.
 */
export class PlatformFileStorage implements FileStorage {
  constructor(
    private readonly db: SqlDatabase,
    private readonly client: IntraForgeClient,
  ) {}

  async put(input: {
    bytes: Uint8Array;
    originalName: string;
    mime: string;
    kind: string;
    entityType?: string;
    entityId?: string;
    createdBy?: string | null;
  }): Promise<StoredFile> {
    if (!input.bytes.byteLength)
      throw new AppError("VALIDATION", "The file is empty.", 400);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const name = safeFileName(input.originalName);
    const form = new FormData();
    form.append(
      "file",
      new Blob([input.bytes as unknown as ArrayBuffer], { type: input.mime }),
      name,
    );
    form.append("kind", input.kind);
    if (input.createdBy) form.append("actorId", input.createdBy);
    const stored = await this.client.upload(form);
    if (stored.quarantined) {
      await this.client.deleteFile(stored.id, input.createdBy ?? null);
      throw new AppError(
        "FILE_BLOCKED",
        "The file was blocked by the malware scanner and was not stored.",
        422,
      );
    }
    if (stored.sha256 !== sha256)
      throw new Error("IntraForge stored different bytes than were sent.");
    const id = randomUUID();
    await this.db.write((h) =>
      h.run(
        `INSERT INTO files(id, storage_key, original_name, mime, size, sha256, kind, entity_type, entity_id, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          stored.id,
          name,
          input.mime,
          input.bytes.byteLength,
          sha256,
          input.kind,
          input.entityType ?? null,
          input.entityId ?? null,
          input.createdBy ?? null,
          nowIso(),
        ],
      ),
    );
    return (await this.meta(id))!;
  }

  private row(id: string) {
    return this.db.read((h) =>
      h.get<FileRow>(
        "SELECT * FROM files WHERE id = ? AND deleted_at IS NULL",
        [id],
      ),
    );
  }

  async meta(id: string): Promise<StoredFile | null> {
    const row = await this.row(id);
    return row ? toStored(row) : null;
  }

  async get(
    id: string,
  ): Promise<{ file: StoredFile; bytes: Uint8Array } | null> {
    const row = await this.row(id);
    if (!row) return null;
    const bytes = await this.client.download(row.storage_key);
    if (!bytes) return null;
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== row.sha256)
      throw new Error("Stored file failed its integrity check.");
    return { file: toStored(row), bytes };
  }

  listFor(entityType: string, entityId: string, kind?: string) {
    return listFilesFor(this.db, entityType, entityId, kind);
  }

  async delete(id: string): Promise<void> {
    await this.db.write(async (h) => {
      const r = await h.get<FileRow & { created_by: string | null }>(
        "SELECT * FROM files WHERE id = ?",
        [id],
      );
      if (!r) return;
      await h.run("DELETE FROM files WHERE id = ?", [id]);
      this.db.afterCommit(() =>
        this.client.deleteFile(r.storage_key, r.created_by),
      );
    });
  }

  listOrphans() {
    return listOrphanFiles(this.db);
  }
}
