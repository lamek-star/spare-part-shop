import { m0001 } from "./0001_core";
import { m0002 } from "./0002_products_inventory";
import { m0003 } from "./0003_sales_purchasing";
import { m0004 } from "./0004_reference_catalogue";
import { m0005 } from "./0005_audit_outbox";
import { m0006 } from "./0006_pay_requests";
import { m0007 } from "./0007_package_source_names";
import { m0008 } from "./0008_pharmacy";
export interface Migration {
  version: string;
  name: string;
  sql: string;
}
/** Append-only. Never edit a migration that has shipped; add a new one. */
export const migrations: Migration[] = [
  { version: "0001", name: "core", sql: m0001 },
  { version: "0002", name: "products_inventory", sql: m0002 },
  { version: "0003", name: "sales_purchasing", sql: m0003 },
  { version: "0004", name: "reference_catalogue", sql: m0004 },
  { version: "0005", name: "audit_outbox", sql: m0005 },
  { version: "0006", name: "pay_requests", sql: m0006 },
  { version: "0007", name: "package_source_names", sql: m0007 },
  { version: "0008", name: "pharmacy", sql: m0008 },
];
