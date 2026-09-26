import type { Providers } from "../providers/uow";
import type { NewUser, ShopConfig } from "../providers/core";
import type { Role } from "./types";
import type { Actor, AuditEvent } from "./types";
import { requirePermission } from "./permissions";
import { MasterDataService } from "./masterdata";
import { InventoryService } from "./inventory";
import { ProductService } from "./products";
import { SalesService } from "./sales";
import { PurchasingService } from "./purchasing";
import { ReportService } from "./reports";
import { CatalogueService } from "./catalogue";
import { CatalogueImportService } from "../catalogue/importer";
import { PackageImportService } from "../catalogue/package";

/** The application's business API, independent of HTTP and of storage:
 * route handlers and tests both talk to this. */
export function createApp(providers: Providers) {
  const { uow, identity } = providers;
  return {
    identity,
    users: {
      async list(actor: Actor) {
        requirePermission(actor, "users.manage");
        return identity.listUsers();
      },
      async create(actor: Actor, user: NewUser) {
        requirePermission(actor, "users.manage");
        return identity.createUser(actor, { ...user, mustChangePassword: user.mustChangePassword ?? true });
      },
      async update(
        actor: Actor,
        id: string,
        patch: { displayName?: string; role?: Role; status?: "ACTIVE" | "DISABLED"; password?: string },
      ) {
        requirePermission(actor, "users.manage");
        return identity.updateUser(actor, id, patch);
      },
    },
    masterData: new MasterDataService(uow),
    products: new ProductService(uow),
    inventory: new InventoryService(uow),
    sales: new SalesService(uow),
    purchasing: new PurchasingService(uow),
    reports: new ReportService(uow),
    catalogue: new CatalogueService(uow),
    catalogueImport: new CatalogueImportService(uow),
    cataloguePackage: new PackageImportService(uow),
    audit: {
      async query(
        actor: Actor,
        filter: {
          entityType?: string;
          entityId?: string;
          actorId?: string;
          limit?: number;
          before?: string;
        },
      ): Promise<AuditEvent[]> {
        requirePermission(actor, "audit.read");
        return uow.read((r) => r.audit.query(filter));
      },
    },
    settings: {
      async get(actor: Actor) {
        requirePermission(actor, "settings.read");
        return uow.read((r) => r.config.get());
      },
      async update(actor: Actor, patch: Partial<ShopConfig>) {
        requirePermission(actor, "settings.manage");
        return uow.write((r) => r.config.update(actor, patch));
      },
    },
  };
}
export type App = ReturnType<typeof createApp>;
