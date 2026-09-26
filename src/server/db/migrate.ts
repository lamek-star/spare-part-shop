import { createHash } from "node:crypto";
import type { Database } from "./connection";
import { migrations } from "./migrations";

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}
const checksum = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");

/**
 * Applies every pending migration, in order, inside one transaction.
 * An already-applied migration whose text has since changed is a hard
 * error: schema history is append-only, never edited in place.
 */
export async function migrate(db: Database): Promise<MigrationReport> {
  return db.write((h) => {
    h.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         checksum TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`,
    );
    const done = new Map(
      h
        .all<{
          version: string;
          checksum: string;
        }>("SELECT version, checksum FROM schema_migrations")
        .map((r) => [r.version, r.checksum]),
    );
    const report: MigrationReport = { applied: [], alreadyApplied: [] };
    for (const m of migrations) {
      const sum = checksum(m.sql);
      if (done.has(m.version)) {
        if (done.get(m.version) !== sum)
          throw new Error(
            `Migration ${m.version} (${m.name}) was modified after it was applied.`,
          );
        report.alreadyApplied.push(m.version);
        continue;
      }
      h.exec(m.sql);
      h.run(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?,?,?,?)",
        [m.version, m.name, sum, new Date().toISOString()],
      );
      report.applied.push(m.version);
    }
    return report;
  });
}
