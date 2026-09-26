import { createHash } from "node:crypto";
import type { SqlDatabase } from "./connection";
import { migrations as sqliteMigrations, type Migration } from "./migrations";
import { pgMigrations } from "./pg-migrations";

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** A migration's identity must not depend on how the source was checked
 * out: a Windows checkout with core.autocrlf puts CR LF inside the SQL
 * template strings. The recorded checksum is over LF text; a database
 * migrated from a CR LF checkout recorded the CR LF form, which is accepted
 * too, so moving a database between checkouts is not "modified". */
const checksum = (sql: string) => sha256(sql.replace(/\r\n/g, "\n"));
const acceptedChecksums = (sql: string) => {
  const lf = sql.replace(/\r\n/g, "\n");
  return new Set([sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))]);
};

/** The migration list for a store's engine. Both lists carry the same
 * versions; a new schema change is added to both. */
export const migrationsFor = (db: Pick<SqlDatabase, "dialect">) =>
  db.dialect === "postgres" ? pgMigrations : sqliteMigrations;

/**
 * Applies every pending migration, in order, inside one transaction.
 * An already-applied migration whose text has since changed is a hard
 * error: schema history is append-only, never edited in place.
 */
export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[] = migrationsFor(db),
): Promise<MigrationReport> {
  return db.write(async (h) => {
    await h.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         checksum TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`,
    );
    const done = new Map(
      (
        await h.all<{
          version: string;
          checksum: string;
        }>("SELECT version, checksum FROM schema_migrations")
      ).map((r) => [r.version, r.checksum]),
    );
    const report: MigrationReport = { applied: [], alreadyApplied: [] };
    for (const m of migrations) {
      const sum = checksum(m.sql);
      if (done.has(m.version)) {
        if (!acceptedChecksums(m.sql).has(done.get(m.version)!))
          throw new Error(
            `Migration ${m.version} (${m.name}) was modified after it was applied.`,
          );
        report.alreadyApplied.push(m.version);
        continue;
      }
      await h.exec(m.sql);
      await h.run(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?,?,?,?)",
        [m.version, m.name, sum, new Date().toISOString()],
      );
      report.applied.push(m.version);
    }
    return report;
  });
}
