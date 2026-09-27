import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database, type SqlDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { migrations as sqliteMigrations } from "../db/migrations";
import { nowIso } from "../kernel/ids";
import { verifyBackup } from "../ops/backup";
import { insertAuditEvent } from "../standalone/audit";
import type { IntraForgeClient } from "./intraforge";

/**
 * One-off migration of a standalone Spare Parts database into the store
 * IntraForge provisioned (contract sections 2, 3 and 6):
 *
 *   inspect source -> validate -> preview -> (the operator's IntraForge
 *   backup) -> import -> verify counts -> verify relationships and the stock
 *   ledger -> report.
 *
 * - The source is a standalone backup folder (backup.json + spareparts.sqlite
 *   + files/, verified first) or a standalone data folder. It is never
 *   modified: a temporary copy is brought to the current schema and read.
 * - The destination must hold no business data yet; nothing is ever
 *   overwritten or merged.
 * - Every row keeps its id, number and code (documents and PDFs refer to
 *   them); document sequences continue where they were.
 * - People: standalone users cannot move (their scrypt hashes mean nothing to
 *   IntraForge). Each user reference is mapped by email to the IntraForge user
 *   of the same email who has access to the application; unmapped references
 *   become empty, and the audit history keeps the name as it was recorded.
 * - Files are re-stored in IntraForge (SHA-256 checked both ways) under the
 *   same file ids. They are uploaded before the database transaction; if it
 *   fails they are deleted again.
 * - The whole database import is one transaction: all or nothing.
 */

/** Tables copied, in foreign-key order. Identity (users, sessions, login
 * attempts), configuration (IntraForge's now) and the search index (rebuilt)
 * are handled separately. */
export const COPY_ORDER = [
  "sequences",
  "files",
  "branches",
  "customers",
  "suppliers",
  "warehouses",
  "locations",
  "products",
  "product_numbers",
  "product_suppliers",
  "product_images",
  "product_reference_links",
  "shop_vehicles",
  "product_compatibility",
  "stock_movements",
  "stock_balances",
  "reservations",
  "enquiries",
  "enquiry_items",
  "quotations",
  "quotation_items",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "invoice_items",
  "payments",
  "sales_returns",
  "sales_return_items",
  "purchase_orders",
  "purchase_order_items",
  "goods_receipts",
  "goods_receipt_items",
  "catalogue_sources",
  "manufacturers",
  "vehicle_models",
  "vehicles",
  "catalogues",
  "sections",
  "import_jobs",
  "import_job_rows",
  "assets",
  "drawings",
  "catalogue_drawings",
  "catalogue_parts",
  "source_records",
  "part_facts",
  "fitments",
  "fitment_engines",
  "part_relations",
  "drawing_callouts",
  "callout_parts",
  "audit_events",
] as const;

/** Tables whose presence in the destination means "already in use". */
const BUSINESS_TABLES = [
  "products",
  "customers",
  "suppliers",
  "stock_movements",
  "invoices",
  "catalogue_parts",
  "files",
];
const USER_COLUMNS = new Set([
  "created_by",
  "linked_by",
  "recorded_by",
  "received_by",
  "actor_id",
]);

type Row = Record<string, unknown>;

export interface SourceInfo {
  kind: "backup" | "data-folder";
  schemaVersion: string;
  counts: Record<string, number>;
  users: { id: string; email: string; displayName: string }[];
  files: number;
  fileBytes: number;
  problems: string[];
}

export interface MigrationReport {
  source: SourceInfo;
  destinationEmpty: boolean;
  destinationCounts: Record<string, number>;
  userMapping: { email: string; intraforgeUserId: string | null }[];
  imported: Record<string, number>;
  filesUploaded: number;
  countsMatch: boolean;
  ledgerProblems: number;
  executed: boolean;
  conflicts: string[];
}

/** A read-only working copy of the source, brought to the current schema. */
export class StandaloneSource {
  private constructor(
    readonly db: Database,
    readonly filesDir: string,
    readonly kind: "backup" | "data-folder",
    private readonly tempDir: string,
  ) {}

  static async open(path: string): Promise<StandaloneSource> {
    let dbFile: string;
    let kind: "backup" | "data-folder";
    if (existsSync(join(path, "backup.json"))) {
      const manifest = verifyBackup(path); // throws on a damaged backup
      dbFile = join(path, manifest.database.file);
      kind = "backup";
    } else if (existsSync(join(path, "spareparts.sqlite"))) {
      dbFile = join(path, "spareparts.sqlite");
      kind = "data-folder";
    } else
      throw new Error(
        "Not a Spare Parts backup or data folder (no backup.json or spareparts.sqlite).",
      );
    const tempDir = mkdtempSync(join(tmpdir(), "sp-migrate-"));
    const copy = join(tempDir, "source.sqlite");
    copyFileSync(dbFile, copy);
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(dbFile + suffix))
        copyFileSync(dbFile + suffix, copy + suffix);
    const db = Database.open(copy);
    await migrate(db, sqliteMigrations);
    return new StandaloneSource(db, join(path, "files"), kind, tempDir);
  }

  async close() {
    await this.db.close();
    rmSync(this.tempDir, { recursive: true, force: true });
  }

  rows(table: string): Promise<Row[]> {
    const order = table === "sections" ? "" : " ORDER BY rowid";
    return this.db.read((h) => h.all<Row>(`SELECT * FROM ${table}${order}`));
  }

  async info(): Promise<SourceInfo> {
    const counts: Record<string, number> = {};
    for (const t of COPY_ORDER)
      counts[t] = await this.db.read((h) =>
        h.count(`SELECT COUNT(*) AS n FROM ${t}`),
      );
    const users = (
      await this.db.read((h) =>
        h.all<Row>("SELECT id, email, display_name FROM users ORDER BY email"),
      )
    ).map((u) => ({
      id: String(u.id),
      email: String(u.email),
      displayName: String(u.display_name),
    }));
    const files = await this.rows("files");
    const problems: string[] = [];
    let bytes = 0;
    for (const f of files) {
      const path = join(this.filesDir, String(f.storage_key));
      if (!existsSync(path)) {
        problems.push(`file ${f.id} (${f.original_name}) is missing`);
        continue;
      }
      const data = readFileSync(path);
      bytes += data.byteLength;
      if (createHash("sha256").update(data).digest("hex") !== f.sha256)
        problems.push(`file ${f.id} (${f.original_name}) fails its checksum`);
    }
    const version = await this.db.read((h) =>
      h.get<{ v: string }>("SELECT MAX(version) AS v FROM schema_migrations"),
    );
    return {
      kind: this.kind,
      schemaVersion: String(version?.v ?? "?"),
      counts,
      users,
      files: files.length,
      fileBytes: bytes,
      problems,
    };
  }
}

async function destinationCounts(db: SqlDatabase) {
  const out: Record<string, number> = {};
  for (const t of COPY_ORDER)
    out[t] = await db.read((h) => h.count(`SELECT COUNT(*) AS n FROM ${t}`));
  return out;
}

/** Parents before children for the one self-referencing table. */
function parentsFirst(rows: Row[]): Row[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const out: Row[] = [];
  const seen = new Set<string>();
  const visit = (r: Row) => {
    const id = String(r.id);
    if (seen.has(id)) return;
    seen.add(id);
    const parent = r.parent_id ? byId.get(String(r.parent_id)) : undefined;
    if (parent) visit(parent);
    out.push(r);
  };
  rows.forEach(visit);
  return out;
}

export async function migrateStandalone(opts: {
  source: StandaloneSource;
  destination: SqlDatabase;
  client: IntraForgeClient;
  execute: boolean;
  log?: (line: string) => void;
}): Promise<MigrationReport> {
  const log = opts.log ?? (() => undefined);
  const { source, destination, client } = opts;
  const info = await source.info();
  const before = await destinationCounts(destination);
  const destinationEmpty = BUSINESS_TABLES.every((t) => (before[t] ?? 0) === 0);
  const conflicts: string[] = [];
  if (!destinationEmpty)
    conflicts.push(
      "The destination already holds business data (" +
        BUSINESS_TABLES.filter((t) => before[t])
          .map((t) => `${before[t]} ${t}`)
          .join(", ") +
        "). Nothing is merged or overwritten; migrate into a freshly installed application.",
    );
  conflicts.push(...info.problems);

  // People: standalone user id -> IntraForge user id, by email.
  const { data } = await client.json<{
    results: { id: string; email: string }[];
  }>("GET", "/users/");
  const byEmail = new Map(
    data.results.map((u) => [u.email.toLowerCase(), u.id]),
  );
  const userMap = new Map<string, string | null>();
  const userMapping = info.users.map((u) => {
    const target = byEmail.get(u.email.toLowerCase()) ?? null;
    userMap.set(u.id, target);
    return { email: u.email, intraforgeUserId: target };
  });

  const report: MigrationReport = {
    source: info,
    destinationEmpty,
    destinationCounts: before,
    userMapping,
    imported: {},
    filesUploaded: 0,
    countsMatch: false,
    ledgerProblems: 0,
    executed: false,
    conflicts,
  };
  if (!opts.execute || conflicts.length) return report;

  // Files first (outside the transaction): same ids, new IntraForge keys.
  const files = await source.rows("files");
  const storageKey = new Map<string, string>();
  const uploaded: string[] = [];
  try {
    for (const f of files) {
      const bytes = readFileSync(join(source.filesDir, String(f.storage_key)));
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes as unknown as ArrayBuffer], { type: String(f.mime) }),
        String(f.original_name),
      );
      form.append("kind", String(f.kind));
      const actor = userMap.get(String(f.created_by ?? "")) ?? null;
      if (actor) form.append("actorId", actor);
      const stored = await client.upload(form);
      uploaded.push(stored.id);
      if (stored.quarantined || stored.sha256 !== f.sha256)
        throw new Error(
          `IntraForge did not store ${f.original_name} intact (${stored.quarantined ? "blocked by the malware scanner" : "checksum differs"}).`,
        );
      storageKey.set(String(f.id), stored.id);
    }
    report.filesUploaded = uploaded.length;
    log(`uploaded ${uploaded.length} file(s) to IntraForge`);

    await destination.write(async (h) => {
      for (const table of COPY_ORDER) {
        let rows = await source.rows(table);
        if (table === "sections") rows = parentsFirst(rows);
        const destColumns = new Set(
          (
            await h.all<{ column_name: string }>(
              h.dialect === "postgres"
                ? "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?"
                : `SELECT name AS column_name FROM pragma_table_info('${table}')`,
              h.dialect === "postgres" ? [table] : [],
            )
          ).map((c) => c.column_name),
        );
        if (table === "sequences") await h.run("DELETE FROM sequences"); // numbering continues from the source
        let n = 0;
        for (const row of rows) {
          const r: Row = { ...row };
          for (const c of Object.keys(r))
            if (
              USER_COLUMNS.has(c) &&
              r[c] != null &&
              userMap.has(String(r[c]))
            )
              r[c] = userMap.get(String(r[c]));
          if (table === "files") r.storage_key = storageKey.get(String(r.id));
          const cols = Object.keys(r).filter((c) => destColumns.has(c));
          await h.run(
            `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
            cols.map((c) => r[c] as never),
          );
          n++;
        }
        report.imported[table] = n;
        if (n) log(`${table}: ${n}`);
      }
      // The search index: the same text, re-indexed by this store.
      const search = await source.db.read((h2) =>
        h2.all<Row>(
          "SELECT part_id, oem, description, vehicles, sections FROM catalogue_search",
        ),
      );
      for (const s of search)
        await h.run(
          h.dialect === "postgres"
            ? "INSERT INTO catalogue_search(part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?)"
            : "INSERT INTO catalogue_search(part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?)",
          [s.part_id, s.oem, s.description, s.vehicles, s.sections] as never[],
        );
      report.imported.catalogue_search = search.length;
      // One summary event, relayed to IntraForge's audit log like any other.
      const eventId = await insertAuditEvent(h, null, {
        action: "data.migrate",
        entityType: "application",
        summary: `Standalone Spare Parts data migrated (${report.imported.products ?? 0} products, ${report.imported.invoices ?? 0} invoices, ${uploaded.length} files)`,
        metadata: {
          source: info.kind,
          schemaVersion: info.schemaVersion,
          rows: report.imported,
          files: uploaded.length,
          peopleMapped: userMapping.filter((u) => u.intraforgeUserId).length,
          peopleUnmapped: userMapping.filter((u) => !u.intraforgeUserId).length,
        },
      });
      await h.run(
        "INSERT INTO audit_outbox(event_id, queued_at) VALUES (?,?)",
        [eventId, nowIso()],
      );
    });
  } catch (error) {
    for (const id of uploaded)
      await client.deleteFile(id, null).catch(() => undefined);
    throw error;
  }
  report.executed = true;

  // Verify: every table's count, and the stock ledger recomputed from the
  // movements and reservations (the contract's verifyIntegrity).
  const after = await destinationCounts(destination);
  // audit_events gains the one summary event above.
  report.countsMatch = COPY_ORDER.every(
    (t) =>
      (after[t] ?? 0) ===
      (info.counts[t] ?? 0) + (t === "audit_events" ? 1 : 0),
  );
  report.ledgerProblems = await destination.read((h) =>
    h.count(
      `SELECT COUNT(*) AS n FROM stock_balances b WHERE b.on_hand <> COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id = b.product_id AND m.location_id = b.location_id), 0)
          OR b.reserved <> COALESCE((SELECT SUM(quantity) FROM reservations r WHERE r.product_id = b.product_id AND r.location_id = b.location_id AND r.status = 'ACTIVE'), 0)`,
    ),
  );
  return report;
}
