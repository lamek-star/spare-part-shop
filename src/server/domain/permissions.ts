import type { Actor, Role } from "./types";
import { forbidden } from "../kernel/errors";

/**
 * The one place that says who may do what. Every HTTP route names the
 * permission it needs and calls requirePermission(); no UI code decides
 * authorization. Roles are fixed for this standalone phase (a later
 * IdentityProvider will map platform roles onto these permissions).
 */
export const permissions = [
  "catalogue.read",
  "catalogue.import",
  "catalogue.admin",
  "products.read",
  "products.write",
  "products.cost.read",
  "inventory.read",
  "inventory.write",
  "warehouses.write",
  "customers.read",
  "customers.write",
  "suppliers.read",
  "suppliers.write",
  "enquiries.read",
  "enquiries.write",
  "quotations.read",
  "quotations.write",
  "orders.read",
  "orders.write",
  "invoices.read",
  "invoices.write",
  "payments.record",
  "purchasing.read",
  "purchasing.write",
  "reports.inventory",
  "reports.sales",
  "reports.financial",
  "audit.read",
  "users.manage",
  "settings.read",
  "settings.manage",
  "documents.read",
  "documents.write",
] as const;
export type Permission = (typeof permissions)[number];

const all = new Set<Permission>(permissions);
const without = (...removed: Permission[]) =>
  new Set<Permission>(permissions.filter((p) => !removed.includes(p)));

export const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  OWNER: all,
  ADMIN: without("users.manage"),
  SALES: new Set<Permission>([
    "catalogue.read",
    "products.read",
    "inventory.read",
    "customers.read",
    "customers.write",
    "enquiries.read",
    "enquiries.write",
    "quotations.read",
    "quotations.write",
    "orders.read",
    "orders.write",
    "invoices.read",
    "invoices.write",
    "payments.record",
    "reports.sales",
    "settings.read",
    "documents.read",
    "documents.write",
  ]),
  INVENTORY: new Set<Permission>([
    "catalogue.read",
    "products.read",
    "products.write",
    "products.cost.read",
    "inventory.read",
    "inventory.write",
    "warehouses.write",
    "suppliers.read",
    "purchasing.read",
    "purchasing.write",
    "reports.inventory",
    "settings.read",
    "documents.read",
    "documents.write",
  ]),
  VIEWER: new Set<Permission>([
    "catalogue.read",
    "products.read",
    "inventory.read",
    "settings.read",
    "documents.read",
  ]),
};

export const can = (
  actor: Pick<Actor, "role" | "permissions">,
  permission: Permission,
) =>
  actor.permissions
    ? actor.permissions.includes(permission)
    : (rolePermissions[actor.role]?.has(permission) ?? false);

export function requirePermission(
  actor: Pick<Actor, "role" | "permissions">,
  permission: Permission,
): void {
  if (!can(actor, permission))
    throw forbidden(
      actor.permissions
        ? "You do not have permission to perform this action."
        : `Your role (${actor.role}) may not perform this action.`,
    );
}
export const permissionsFor = (role: Role): Permission[] => [
  ...(rolePermissions[role] ?? []),
];
/** The permissions an actor effectively holds (explicit list or role). */
export const permissionsOf = (
  actor: Pick<Actor, "role" | "permissions">,
): Permission[] =>
  actor.permissions
    ? permissions.filter((p) => actor.permissions!.includes(p))
    : permissionsFor(actor.role);
