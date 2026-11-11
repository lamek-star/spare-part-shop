import type { Permission } from "../domain/permissions";
import type { Role } from "../domain/types";
import { isPharmacy } from "../edition";

/**
 * IntraForge capability -> this application's permissions. The contract
 * puts the mapping inside the identity provider; IntraForge's four staff
 * roles (spare-parts-manager / -sales / -inventory / -viewer) reproduce this
 * application's ADMIN (and OWNER) / SALES / INVENTORY / VIEWER exactly --
 * tests/server/platform.test.ts pins that.
 */
export const CAPABILITY_PERMISSIONS: Record<string, Permission[]> = {
  "spareparts.view": ["settings.read", "documents.read"],
  "spareparts.catalogue.read": ["catalogue.read"],
  "spareparts.catalogue.import": ["catalogue.import"],
  "spareparts.catalogue.manage": ["catalogue.admin"],
  "spareparts.products.read": ["products.read"],
  "spareparts.products.manage": ["products.write", "documents.write"],
  "spareparts.cost.read": ["products.cost.read"],
  "spareparts.inventory.read": ["inventory.read"],
  "spareparts.inventory.manage": [
    "inventory.write",
    "warehouses.write",
    "documents.write",
  ],
  "spareparts.sales.read": [
    "customers.read",
    "enquiries.read",
    "quotations.read",
    "orders.read",
    "invoices.read",
  ],
  "spareparts.sales.manage": [
    "customers.write",
    "enquiries.write",
    "quotations.write",
    "orders.write",
    "invoices.write",
    "payments.record",
    "documents.write",
  ],
  "spareparts.suppliers.manage": ["suppliers.write"],
  "spareparts.purchasing.read": ["suppliers.read", "purchasing.read"],
  "spareparts.purchasing.manage": ["purchasing.write", "documents.write"],
  "spareparts.reports.inventory": ["reports.inventory"],
  "spareparts.reports.sales": ["reports.sales"],
  "spareparts.reports.financial": ["reports.financial"],
  "spareparts.audit.read": ["audit.read"],
  // People are managed in IntraForge; this only lets the application show
  // who has access.
  "spareparts.settings.manage": ["settings.manage", "users.manage"],
};

/** The capabilities of this edition. The Pharmacy (APP_EDITION=pharmacy) is its own IntraForge
 * application type: the same names under "pharmacy.", and no reference catalogue. */
export function editionCapabilities(): Record<string, Permission[]> {
  if (!isPharmacy()) return CAPABILITY_PERMISSIONS;
  const out: Record<string, Permission[]> = {};
  for (const [name, permissions] of Object.entries(CAPABILITY_PERMISSIONS)) {
    if (name.startsWith("spareparts.catalogue.")) continue;
    out["pharmacy." + name.slice("spareparts.".length)] = permissions;
  }
  return out;
}

export function permissionsFromCapabilities(
  capabilities: readonly string[],
): Permission[] {
  const table = editionCapabilities();
  const out = new Set<Permission>();
  for (const c of capabilities) for (const p of table[c] ?? []) out.add(p);
  return [...out].sort();
}

/** A role label for display and the owner/admin conveniences only;
 * authorization always uses the permission list. */
export function roleFromCapabilities(capabilities: readonly string[]): Role {
  const all = Object.keys(editionCapabilities());
  const prefix = isPharmacy() ? "pharmacy." : "spareparts.";
  if (all.every((c) => capabilities.includes(c))) return "ADMIN";
  if (capabilities.includes(prefix + "sales.manage")) return "SALES";
  if (capabilities.includes(prefix + "inventory.manage")) return "INVENTORY";
  return "VIEWER";
}
