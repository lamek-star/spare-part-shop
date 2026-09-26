import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { Database } from "../db/connection";
import type { FileStorage, StoredFile } from "../providers/core";
import { nowIso } from "../kernel/ids";

interface FileRow {
  id: string;
  storage_key: string;
  original_name: string;
  mime: string;
  size: number;
  sha256: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}
const toStored = (r: FileRow): StoredFile => ({
  id: r.id,
  originalName: r.original_name,
  mime: r.mime,
  size: r.size,
  sha256: r.sha256,
  kind: r.kind,
  entityType: r.entity_type,
  entityId: r.entity_id,
  createdAt: r.created_at,
});
/** Keeps a display name but strips anything that could act as a path. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

/**
 * Files live under <dataDir>/files/<xx>/<uuid>. The on-disk key is always
 * generated here — a caller-supplied name is metadata only and can never
 * influence where bytes are written or read.
 */
export class LocalFileStorage implements FileStorage {
  constructor(
    private readonly db: Database,
    private readonly root: string,
  ) {
    mkdirSync(root, { recursive: true });
  }
  private pathFor(key: string) {
    if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(key))
      throw new Error("Invalid storage key.");
    return join(this.root, key);
  }
  async put(input: {
    bytes: Uint8Array;
    originalName: string;
    mime: string;
    kind: string;
    entityType?: string;
    entityId?: string;
    createdBy?: string | null;
  }): Promise<StoredFile> {
    const id = randomUUID();
    const key = `${id.slice(0, 2)}/${id}`;
    const target = this.pathFor(key);
    mkdirSync(join(this.root, id.slice(0, 2)), { recursive: true });
    const temporary = target + ".tmp";
    writeFileSync(temporary, input.bytes);
    renameSync(temporary, target);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    try {
      await this.db.write((h) =>
        h.run(
          `INSERT INTO files(id, storage_key, original_name, mime, size, sha256, kind, entity_type, entity_id, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            key,
            safeFileName(input.originalName),
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
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
    return (await this.meta(id))!;
  }
  async meta(id: string): Promise<StoredFile | null> {
    const row = await this.db.read((h) =>
      h.get<FileRow>(
        "SELECT * FROM files WHERE id = ? AND deleted_at IS NULL",
        [id],
      ),
    );
    return row ? toStored(row) : null;
  }
  async get(
    id: string,
  ): Promise<{ file: StoredFile; bytes: Uint8Array } | null> {
    const row = await this.db.read((h) =>
      h.get<FileRow>(
        "SELECT * FROM files WHERE id = ? AND deleted_at IS NULL",
        [id],
      ),
    );
    if (!row) return null;
    const path = this.pathFor(row.storage_key);
    if (!existsSync(path)) return null;
    const bytes = new Uint8Array(readFileSync(path));
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== row.sha256)
      throw new Error("Stored file failed its integrity check.");
    return { file: toStored(row), bytes };
  }
  async delete(id: string): Promise<void> {
    const row = await this.db.write((h) => {
      const r = h.get<FileRow>("SELECT * FROM files WHERE id = ?", [id]);
      if (r) h.run("DELETE FROM files WHERE id = ?", [id]);
      return r;
    });
    if (row) rmSync(this.pathFor(row.storage_key), { force: true });
  }
  async listOrphans(): Promise<StoredFile[]> {
    // A file is an orphan when nothing that owns files points at it.
    const rows = await this.db.read((h) =>
      h.all<FileRow>(
        `SELECT f.* FROM files f
          WHERE f.deleted_at IS NULL
            AND f.kind = 'PRODUCT_IMAGE'
            AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.file_id = f.id)`,
      ),
    );
    return rows.map(toStored);
  }
}
