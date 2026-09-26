import type { Migration } from "../migrations";
import { p0001 } from "./0001_core";
import { p0002 } from "./0002_products_inventory";
import { p0003 } from "./0003_sales_purchasing";
import { p0004 } from "./0004_reference_catalogue";

/** PostgreSQL migrations, version-for-version with ../migrations. */
export const pgMigrations: Migration[] = [
  { version: "0001", name: "core", sql: p0001 },
  { version: "0002", name: "products_inventory", sql: p0002 },
  { version: "0003", name: "sales_purchasing", sql: p0003 },
  { version: "0004", name: "reference_catalogue", sql: p0004 },
];
