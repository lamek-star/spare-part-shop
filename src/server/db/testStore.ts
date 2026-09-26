import { createHash } from "node:crypto";
import pg from "pg";
import { PostgresDatabase } from "./postgres";

/**
 * Test harness only: when SPAREPARTS_TEST_STORE=postgres, a test container
 * gets a PostgreSQL schema (in SPAREPARTS_TEST_PG_URL) derived from its data
 * directory -- so closing and reopening a container on the same directory
 * sees the same data, as with the SQLite file. The schemas a test process
 * created are dropped when it exits. This runs the whole server test suite
 * (the integration contract's "executable contract") against the engine
 * IntraForge provides.
 */
export const testStoreIsPostgres = (env: NodeJS.ProcessEnv = process.env) =>
  env.SPAREPARTS_TEST_STORE === "postgres";

const created = new Set<string>();
let cleanupRegistered = false;

function testUrl(env: NodeJS.ProcessEnv): string {
  const url = env.SPAREPARTS_TEST_PG_URL;
  if (!url)
    throw new Error(
      "SPAREPARTS_TEST_STORE=postgres needs SPAREPARTS_TEST_PG_URL.",
    );
  return url;
}

async function admin<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function openTestPostgres(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ db: PostgresDatabase; close: () => Promise<void> }> {
  const url = testUrl(env);
  const schema = `sptest_${createHash("sha1").update(dataDir).digest("hex").slice(0, 16)}`;
  await admin(url, (c) => c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
  created.add(schema);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    let done = false;
    process.on("beforeExit", async () => {
      if (done || !created.size) return;
      done = true;
      await admin(url, async (c) => {
        for (const s of created)
          await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
      });
    });
  }
  const db = new PostgresDatabase({ connectionString: url, schema, max: 4 });
  return { db, close: () => db.close() };
}
