import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { SqlDatabase } from "../db/connection";
import { migrations } from "../db/migrations";

export interface BackupManifest {
  format: 1;
  createdAt: string;
  schemaVersion: string;
  database: { file: string; sha256: string; bytes: number };
  files: { count: number; bytes: number };
}
const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * A consistent copy of everything the application stores: the database (via
 * SQLite's own VACUUM INTO, safe while the app is running) plus the managed
 * files directory, with a manifest that restore verifies. Backups contain
 * personal and commercial data: keep them as protected as the live data.
 */
export async function createBackup(
  db: SqlDatabase,
  dataDir: string,
  destination: string,
): Promise<BackupManifest> {
  if (db.dialect !== "sqlite")
    throw new Error(
      "This backup covers the standalone store only; on IntraForge the platform backup includes the application's data.",
    );
  if (existsSync(destination) && readdirSync(destination).length)
    throw new Error("The backup folder must be empty.");
  mkdirSync(destination, { recursive: true });
  const dbFile = join(destination, "spareparts.sqlite");
  await db.read((h) => h.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`));
  const filesSrc = join(dataDir, "files");
  const filesDst = join(destination, "files");
  if (existsSync(filesSrc)) cpSync(filesSrc, filesDst, { recursive: true });
  const copied = walk(filesDst);
  const manifest: BackupManifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    schemaVersion: migrations[migrations.length - 1].version,
    database: {
      file: "spareparts.sqlite",
      sha256: sha256File(dbFile),
      bytes: statSync(dbFile).size,
    },
    files: {
      count: copied.length,
      bytes: copied.reduce((n, f) => n + statSync(f).size, 0),
    },
  };
  writeFileSync(
    join(destination, "backup.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

/** Verifies a backup folder without changing anything. */
export function verifyBackup(source: string): BackupManifest {
  const path = join(source, "backup.json");
  if (!existsSync(path))
    throw new Error("This folder is not a backup (backup.json is missing).");
  const m = JSON.parse(readFileSync(path, "utf8")) as BackupManifest;
  if (m.format !== 1)
    throw new Error("This backup was made by a newer version.");
  const db = join(source, m.database.file);
  if (!existsSync(db) || sha256File(db) !== m.database.sha256)
    throw new Error("The database in this backup is missing or damaged.");
  const files = walk(join(source, "files"));
  if (files.length !== m.files.count)
    throw new Error("The stored files in this backup are incomplete.");
  return m;
}

/** Restores a backup into an empty data directory (the app must be stopped). */
export function restoreBackup(source: string, dataDir: string): BackupManifest {
  const m = verifyBackup(source);
  if (existsSync(join(dataDir, "spareparts.sqlite")))
    throw new Error(
      "The data directory already holds a database. Move it away first; restore never overwrites live data.",
    );
  mkdirSync(dataDir, { recursive: true });
  cpSync(join(source, m.database.file), join(dataDir, "spareparts.sqlite"));
  if (existsSync(join(source, "files")))
    cpSync(join(source, "files"), join(dataDir, "files"), { recursive: true });
  return m;
}
export const relativeFiles = (dir: string) =>
  walk(dir)
    .map((f) => relative(dir, f).replace(/\\/g, "/"))
    .sort();
export const removeDir = (dir: string) =>
  rmSync(dir, { recursive: true, force: true });
