import { resolveDataDir } from "../src/server/standalone/container";
import { restoreBackup } from "../src/server/ops/backup";

const src = process.argv[2];
if (!src) {
  console.error(
    "Usage: npm run restore -- <backup folder>   (stop the application first; the data directory must be empty)",
  );
  process.exit(2);
}
const m = restoreBackup(src, resolveDataDir());
console.log(
  `Restored backup from ${m.createdAt} (schema ${m.schemaVersion}) into ${resolveDataDir()}.`,
);
