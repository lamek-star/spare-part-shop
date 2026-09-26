import type {
  AuditProvider,
  ConfigurationProvider,
  FileStorage,
  IdentityProvider,
} from "./core";
import type {
  InventoryRepository,
  MasterDataRepository,
  ProductRepository,
} from "./data";
import type {
  PurchasingRepository,
  ReportRepository,
  SalesRepository,
} from "./sales";
import type { CatalogueRepository } from "./catalogue";

/** Everything business logic may touch. Each member is an interface; the
 * composition root decides which implementation backs it. */
export interface Repositories {
  masterData: MasterDataRepository;
  products: ProductRepository;
  inventory: InventoryRepository;
  sales: SalesRepository;
  purchasing: PurchasingRepository;
  reports: ReportRepository;
  catalogue: CatalogueRepository;
  audit: AuditProvider;
  config: ConfigurationProvider;
  files: FileStorage;
}
/** Runs a body as one atomic unit: everything in a `write` commits
 * together or not at all (including its audit events). */
export interface UnitOfWork {
  read<T>(fn: (r: Repositories) => Promise<T>): Promise<T>;
  write<T>(fn: (r: Repositories) => Promise<T>): Promise<T>;
}
export interface Providers {
  uow: UnitOfWork;
  identity: IdentityProvider;
}
