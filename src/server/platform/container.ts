import { join } from "node:path";
import type { SqlDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { PostgresDatabase } from "../db/postgres";
import { AppError } from "../kernel/errors";
import type { Repositories, UnitOfWork } from "../providers/uow";
import type { AppContainer } from "../standalone/container";
import { SqliteCatalogueRepository } from "../standalone/repos/catalogue";
import { SqliteInventoryRepository } from "../standalone/repos/inventory";
import { SqliteMasterDataRepository } from "../standalone/repos/masterdata";
import { SqliteProductRepository } from "../standalone/repos/products";
import { SqlitePurchasingRepository } from "../standalone/repos/purchasing";
import { SqliteReportRepository } from "../standalone/repos/reports";
import { SqliteSalesRepository } from "../standalone/repos/sales";
import { AuditRelay, PlatformAuditProvider } from "./audit";
import { PlatformConfigurationProvider } from "./configuration";
import { PlatformFileStorage } from "./files";
import { PlatformIdentityProvider } from "./identity";
import { IntraForgeClient, platformEnv } from "./intraforge";
import { PlatformPayGateway } from "./pay";
import { productName } from "../edition";

/**
 * Composition root on IntraForge (the contract's step 6): the same domain
 * and repositories, with the store IntraForge provisioned for this instance
 * and IntraForge's identity, files, audit and configuration.
 */
export interface SelfInfo {
  installed: boolean;
  enabled?: boolean;
  deployment: string;
  launch_path: string;
  app?: {
    id: string;
    display_name: string;
    organization: { id: string; name: string };
  };
  database?: { schema: string; role: string };
}

export interface PlatformContainer extends AppContainer {
  self: SelfInfo;
  relay: AuditRelay;
  client: IntraForgeClient;
  /** True once IntraForge says the instance was removed or re-provisioned. */
  stale(): boolean;
}

export const isPlatformMode = (env: NodeJS.ProcessEnv = process.env) =>
  env.SPAREPARTS_MODE === "platform";

export async function fetchSelf(client: IntraForgeClient): Promise<SelfInfo> {
  const { data } = await client.json<SelfInfo>("GET", "/self/");
  return data;
}

/** The providers on a given store and IntraForge client (the container
 * without its lifecycle; also what the tests build). */
export function composePlatform(db: SqlDatabase, client: IntraForgeClient) {
  const relay = new AuditRelay(db, client);
  const audit = new PlatformAuditProvider(db, relay);
  const repos: Repositories = {
    masterData: new SqliteMasterDataRepository(db),
    products: new SqliteProductRepository(db),
    inventory: new SqliteInventoryRepository(db),
    sales: new SqliteSalesRepository(db),
    purchasing: new SqlitePurchasingRepository(db),
    reports: new SqliteReportRepository(db),
    catalogue: new SqliteCatalogueRepository(db),
    audit,
    config: new PlatformConfigurationProvider(db, client),
    files: new PlatformFileStorage(db, client),
  };
  const uow: UnitOfWork = {
    read: (fn) => db.read(() => fn(repos)),
    write: (fn) => db.write(() => fn(repos)),
  };

  return {
    repos,
    uow,
    relay,
    identity: new PlatformIdentityProvider(client),
    pay: new PlatformPayGateway(client),
  };
}

export async function createPlatformContainer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlatformContainer> {
  const client = new IntraForgeClient(platformEnv(env));
  const self = await fetchSelf(client);
  if (!self.installed || !self.database)
    throw new AppError(
      "NOT_INSTALLED",
      `${productName()} is not installed yet. In IntraForge, open Apps and install it.`,
      503,
    );
  const db = new PostgresDatabase({
    host: env.SPAREPARTS_PG_HOST ?? "postgres-tenant",
    port: Number(env.SPAREPARTS_PG_PORT ?? 5432),
    database: env.SPAREPARTS_PG_DATABASE,
    user: self.database.role,
    password: env.SPAREPARTS_PG_PASSWORD,
    schema: self.database.schema,
    max: Number(env.SPAREPARTS_PG_POOL ?? 8),
  });
  try {
    await migrate(db);
  } catch (e) {
    await db.close();
    throw e;
  }
  const { repos, uow, relay } = composePlatform(db, client);
  let stale = false;
  const version = env.SPAREPARTS_VERSION ?? "dev";
  const beat = async () => {
    try {
      await client.json("POST", "/heartbeat/", { version });
      const now = await fetchSelf(client);
      if (!now.installed || now.database?.schema !== self.database?.schema)
        stale = true;
    } catch {
      /* IntraForge restarting; the next beat retries */
    }
  };
  void beat();
  const heartbeat = setInterval(beat, 60_000);
  heartbeat.unref?.();
  relay.start();

  return {
    db,
    repos,
    uow,
    identity: new PlatformIdentityProvider(client),
    pay: new PlatformPayGateway(client),
    dataDir: join(process.cwd(), ".data-platform"),
    self,
    relay,
    client,
    stale: () => stale,
    close: async () => {
      clearInterval(heartbeat);
      relay.stop();
      await db.close();
    },
  };
}
