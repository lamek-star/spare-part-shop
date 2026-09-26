process.on("uncaughtException", (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
import {
  createContainer,
  resolveDataDir,
} from "../src/server/standalone/container";
import { createBackup } from "../src/server/ops/backup";

const dest = process.argv[2];
if (!dest) {
  console.error("Usage: npm run backup -- <empty destination folder>");
  process.exit(2);
}
const dataDir = resolveDataDir();
const c = await createContainer({ dataDir });
try {
  const m = await createBackup(c.db, dataDir, dest);
  console.log(
    `Backup written to ${dest}: database ${m.database.bytes} bytes, ${m.files.count} file(s), schema ${m.schemaVersion}.`,
  );
} finally {
  await c.close();
}
