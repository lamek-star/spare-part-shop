// Moves a standalone Spare Parts database into the application IntraForge
// installed (see src/server/platform/migrateStandalone.ts for exactly what it
// does and refuses). Runs inside the Spare Parts service container, which has
// the platform settings:
//
//   node dist/migrate-to-intraforge.mjs <standalone backup or data folder>            # preview only
//   node dist/migrate-to-intraforge.mjs <folder> --execute                              # import
//   ... --json                                                                          # machine-readable report
//
// Take an IntraForge backup first (the shop kit's Migrate-SparePartsData.ps1
// does it before calling this with --execute).
import { migrate } from "../src/server/db/migrate";
import { PostgresDatabase } from "../src/server/db/postgres";
import { fetchSelf } from "../src/server/platform/container";
import {
  IntraForgeClient,
  platformEnv,
} from "../src/server/platform/intraforge";
import {
  migrateStandalone,
  StandaloneSource,
} from "../src/server/platform/migrateStandalone";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const execute = args.includes("--execute");
const asJson = args.includes("--json");
if (!folder) {
  console.error(
    "usage: migrate-to-intraforge <standalone backup or data folder> [--execute] [--json]",
  );
  process.exit(2);
}

const client = new IntraForgeClient(platformEnv());
const self = await fetchSelf(client);
if (!self.installed || !self.database) {
  console.error(
    "Spare Parts is not installed in IntraForge yet (IntraForge > Apps > Install).",
  );
  process.exit(3);
}
const destination = new PostgresDatabase({
  host: process.env.SPAREPARTS_PG_HOST ?? "postgres-tenant",
  port: Number(process.env.SPAREPARTS_PG_PORT ?? 5432),
  database: process.env.SPAREPARTS_PG_DATABASE,
  user: self.database.role,
  password: process.env.SPAREPARTS_PG_PASSWORD,
  schema: self.database.schema,
  max: 2,
});
const source = await StandaloneSource.open(folder);
let code = 0;
try {
  await migrate(destination);
  const report = await migrateStandalone({
    source,
    destination,
    client,
    execute,
    log: asJson ? undefined : (l) => console.log("  " + l),
  });
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    const s = report.source;
    console.log(
      `Source: ${s.kind}, schema ${s.schemaVersion}, ${s.files} file(s), ${(s.fileBytes / 1e6).toFixed(1)} MB`,
    );
    for (const [t, n] of Object.entries(s.counts))
      if (n) console.log(`  ${t}: ${n}`);
    console.log("People (standalone email -> IntraForge user):");
    for (const u of report.userMapping)
      console.log(
        `  ${u.email} -> ${u.intraforgeUserId ?? "no IntraForge user with access (references become empty)"}`,
      );
    for (const c of report.conflicts) console.log(`CONFLICT: ${c}`);
    if (!execute)
      console.log(
        report.conflicts.length
          ? "Nothing can be imported until the conflicts are resolved."
          : "Preview only. Run again with --execute to import.",
      );
    else if (!report.executed) console.log("Nothing was imported.");
    else
      console.log(
        `Imported. Files: ${report.filesUploaded}. Counts match: ${report.countsMatch ? "yes" : "NO"}. Stock ledger problems: ${report.ledgerProblems}.`,
      );
  }
  if (report.conflicts.length) code = 4;
  else if (execute && (!report.countsMatch || report.ledgerProblems)) code = 5;
} catch (e) {
  console.error(
    `Migration failed and was rolled back: ${(e as Error).message}`,
  );
  code = 1;
} finally {
  await source.close();
  await destination.close();
}
process.exit(code);
