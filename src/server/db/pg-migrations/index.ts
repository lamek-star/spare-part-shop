import type { Migration } from "../migrations";
import { p0001 } from "./0001_core";
import { p0002 } from "./0002_products_inventory";
import { p0003 } from "./0003_sales_purchasing";
import { p0004 } from "./0004_reference_catalogue";
import { p0005 } from "./0005_audit_outbox";
import { p0006 } from "./0006_pay_requests";
import { p0007 } from "./0007_package_source_names";
import { p0008 } from "./0008_pharmacy";

/** PostgreSQL migrations, version-for-version with ../migrations. */
export const pgMigrations: Migration[] = [
  { version: "0001", name: "core", sql: p0001 },
  { version: "0002", name: "products_inventory", sql: p0002 },
  { version: "0003", name: "sales_purchasing", sql: p0003 },
  { version: "0004", name: "reference_catalogue", sql: p0004 },
  { version: "0005", name: "audit_outbox", sql: p0005 },
  { version: "0006", name: "pay_requests", sql: p0006 },
  { version: "0007", name: "package_source_names", sql: p0007 },
  { version: "0008", name: "pharmacy", sql: p0008 },
];
