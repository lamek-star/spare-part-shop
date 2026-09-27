// Dev/qualification only: builds a standalone Spare Parts shop with the dev
// sample data (catalogue, products, photos, stock, sales) and writes a
// standalone backup of it -- a realistic source for rehearsing
// scripts/migrate-to-intraforge.mts. Never used in production.
//
//   npx tsx scripts/make-sample-standalone.mts <empty backup folder>
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/server/standalone/container";
import { createApp } from "../src/server/domain/app";
import { loadSampleData } from "../src/server/dev/sampleData";
import { createBackup } from "../src/server/ops/backup";

const out = process.argv[2];
if (!out) throw new Error("usage: make-sample-standalone <empty backup folder>");
const dir = mkdtempSync(join(tmpdir(), "sp-sample-"));
const container = await createContainer({ dataDir: dir, forceSqlite: true });
try {
  const app = createApp(container);
  const owner = await container.identity.createUser(null, {
    email: "owner@example.test",
    displayName: "Olivia Owner",
    role: "OWNER",
    password: "correct-horse-battery",
  });
  await container.identity.createUser(owner, {
    email: "former.staff@example.test",
    displayName: "Former Staff",
    role: "SALES",
    password: "correct-horse-battery",
  });
  await app.settings.update(owner, { shopName: "Sample Motors (standalone)" });
  console.log(JSON.stringify(await loadSampleData(app, owner)));
  console.log(JSON.stringify(await createBackup(container.db, dir, out)));
} finally {
  await container.close();
  rmSync(dir, { recursive: true, force: true });
}
