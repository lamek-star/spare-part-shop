import type { Providers } from "../providers/uow";
import type { ShopConfig } from "../providers/core";
import type { Actor, AuditEvent } from "./types";
import { requirePermission } from "./permissions";
import { MasterDataService } from "./masterdata";
import { InventoryService } from "./inventory";
import { ProductService } from "./products";
import { SalesService } from "./sales";
import { PurchasingService } from "./purchasing";
import { ReportService } from "./reports";

/** The application's business API, independent of HTTP and of storage:
 * route handlers and tests both talk to this. */
export function createApp(providers: Providers) {
  const { uow, identity } = providers;
  return {
    identity,
    masterData: new MasterDataService(uow),
    products: new ProductService(uow),
    inventory: new InventoryService(uow),
    sales: new SalesService(uow),
    purchasing: new PurchasingService(uow),
    reports: new ReportService(uow),
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
