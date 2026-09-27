import { join } from "node:path";
import { Database, type SqlDatabase } from "../db/connection";
import { openTestPostgres, testStoreIsPostgres } from "../db/testStore";
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
  db: SqlDatabase;
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
  options: { dataDir?: string; memory?: boolean; forceSqlite?: boolean } = {},
): Promise<AppContainer> {
  const dataDir = options.dataDir ?? resolveDataDir();
  let db: SqlDatabase;
  let close: () => Promise<void>;
  if (testStoreIsPostgres() && !options.forceSqlite) {
    const store = await openTestPostgres(dataDir);
    db = store.db;
    close = store.close;
  } else {
    const sqlite = options.memory
      ? Database.open(":memory:")
      : Database.open(join(dataDir, "spareparts.sqlite"));
    db = sqlite;
    close = () => sqlite.close();
  }
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
    close,
  };
}

const globals = globalThis as typeof globalThis & {
  __spContainer?: Promise<AppContainer>;
  __spResolved?: AppContainer & { stale?: () => boolean };
};
/** One container per server process (also across Next.js dev reloads).
 * SPAREPARTS_MODE=platform composes the IntraForge providers (ADR-0018 in
 * the IntraForge repository); otherwise the standalone ones. A failed start
 * is not remembered, so the next request tries again; a platform container
 * whose instance was removed or re-provisioned is replaced. */
export async function getContainer(): Promise<AppContainer> {
  const resolved = globals.__spResolved;
  if (resolved?.stale?.()) {
    globals.__spResolved = undefined;
    globals.__spContainer = undefined;
    await resolved.close().catch(() => undefined);
  }
  if (!globals.__spContainer) {
    const pending: Promise<AppContainer> = (async () => {
      const { isPlatformMode, createPlatformContainer } =
        await import("../platform/container");
      return isPlatformMode() ? createPlatformContainer() : createContainer();
    })();
    globals.__spContainer = pending;
    pending.then(
      (c) => {
        if (globals.__spContainer === pending) globals.__spResolved = c;
      },
      () => {
        if (globals.__spContainer === pending)
          globals.__spContainer = undefined;
      },
    );
  }
  return globals.__spContainer;
}
