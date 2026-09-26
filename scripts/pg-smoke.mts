// Dev check: apply the PostgreSQL migrations to a throwaway schema.
// SPAREPARTS_TEST_PG_URL=postgres://user:pass@127.0.0.1:55432/db npx tsx scripts/pg-smoke.mts
import pg from "pg";
import { PostgresDatabase } from "../src/server/db/postgres";
import { migrate } from "../src/server/db/migrate";

const url = process.env.SPAREPARTS_TEST_PG_URL;
if (!url) throw new Error("Set SPAREPARTS_TEST_PG_URL.");
const schema = `smoke_${Date.now().toString(36)}`;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`CREATE SCHEMA ${schema}`);
try {
  const db = new PostgresDatabase({ connectionString: url, schema });
  console.log(await migrate(db));
  console.log("again:", await migrate(db));
  await db.close();
} finally {
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
