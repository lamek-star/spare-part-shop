import { join } from "node:path";
import { Database } from "../db/connection";
import { migrate } from "../db/migrate";
import type { Providers, Repositories, UnitOfWork } from "../providers/uow";
import { SqliteAuditProvider } from "./audit";
import { SqliteConfigurationProvider } from "./config";
import { LocalFileStorage } from "./files";
import { LocalIdentityProvider } from "./identity";
import { SqliteMasterDataRepository } from "./repos/masterdata";
import { SqliteProductRepository } from "./repos/products";
import { SqliteInventoryRepository } from "./repos/inventory";
import { SqliteSalesRepository } from "./repos/sales";
import { SqlitePurchasingRepository } from "./repos/purchasing";
import { SqliteReportRepository } from "./repos/reports";
import { SqliteCatalogueRepository } from "./repos/catalogue";

export interface AppContainer extends Providers {
  db: Database;
  repos: Repositories;
  dataDir: string;
  close(): Promise<void>;
}

/** Where all Spare Parts data lives: one directory holding the SQLite
 * database and the managed files. Backing up this directory (with the app
 * stopped, or via SQLite's online backup) backs up everything. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SPAREPARTS_DATA_DIR) return env.SPAREPARTS_DATA_DIR;
  return join(
    /*turbopackIgnore: true*/ process.cwd(),
    env.SPAREPARTS_TEST_MODE === "1" ? ".data-test" : ".data",
  );
}

export async function createContainer(
  options: { dataDir?: string; memory?: boolean } = {},
): Promise<AppContainer> {
  const dataDir = options.dataDir ?? resolveDataDir();
  const db = options.memory
    ? Database.open(":memory:")
    : Database.open(join(dataDir, "spareparts.sqlite"));
  await migrate(db);
  const audit = new SqliteAuditProvider(db);
  const repos: Repositories = {
    masterData: new SqliteMasterDataRepository(db),
    products: new SqliteProductRepository(db),
    inventory: new SqliteInventoryRepository(db),
    sales: new SqliteSalesRepository(db),
    purchasing: new SqlitePurchasingRepository(db),
    reports: new SqliteReportRepository(db),
    catalogue: new SqliteCatalogueRepository(db),
    audit,
    config: new SqliteConfigurationProvider(db, audit),
    files: new LocalFileStorage(
      db,
      options.memory
        ? join(process.cwd(), ".data-test", "mem-files")
        : join(dataDir, "files"),
    ),
  };
  const uow: UnitOfWork = {
    read: (fn) => db.read(() => fn(repos)),
    write: (fn) => db.write(() => fn(repos)),
  };
  return {
    db,
    repos,
    uow,
    identity: new LocalIdentityProvider(db, audit),
    dataDir,
    close: () => db.close(),
  };
}

const globals = globalThis as typeof globalThis & {
  __spContainer?: Promise<AppContainer>;
};
/** One container per server process (also across Next.js dev reloads). */
export function getContainer(): Promise<AppContainer> {
  globals.__spContainer ??= createContainer();
  return globals.__spContainer;
}
