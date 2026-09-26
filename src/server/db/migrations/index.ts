import { m0001 } from "./0001_core";
import { m0002 } from "./0002_products_inventory";
import { m0003 } from "./0003_sales_purchasing";
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
];
