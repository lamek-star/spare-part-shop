import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContainer,
  type AppContainer,
} from "../../src/server/standalone/container";
import { createApp, type App } from "../../src/server/domain/app";
import type { Actor, Role } from "../../src/server/domain/types";

export interface TestApp {
  container: AppContainer;
  app: App;
  actors: Record<Role, Actor>;
  dir: string;
  cleanup(): Promise<void>;
}
/** A fresh database + file store in a temp directory, with one signed-in
 * actor per role (the real identity provider created them). */
export async function makeApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), "sp-test-"));
  const container = await createContainer({ dataDir: dir });
  const app = createApp(container);
  const owner = await container.identity.createUser(null, {
    email: "owner@example.test",
    displayName: "Olivia Owner",
    role: "OWNER",
    password: "correct-horse-battery",
  });
  const actors = { OWNER: owner } as unknown as Record<Role, Actor>;
  for (const role of ["ADMIN", "SALES", "INVENTORY", "VIEWER"] as const) {
    actors[role] = await container.identity.createUser(owner, {
      email: `${role.toLowerCase()}@example.test`,
      displayName: `${role} User`,
      role,
      password: "correct-horse-battery",
    });
  }
  return {
    container,
    app,
    actors,
    dir,
    async cleanup() {
      await container.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Seeds one warehouse (with its default location), a customer, a supplier
 * and a product priced 100.00 with 10 units in stock. */
export async function seedBasics(t: TestApp) {
  const owner = t.actors.OWNER;
  const warehouse = await t.app.masterData.createWarehouse(owner, {
    name: "Main warehouse",
  });
  const location = (
    await t.app.masterData.listWarehouses(owner)
  ).locations.find((l) => l.warehouseId === warehouse.id)!;
  const customer = await t.app.masterData.createCustomer(owner, {
    name: "Acme Garage",
    email: "buyer@acme.test",
  });
  const supplier = await t.app.masterData.createSupplier(owner, {
    name: "Parts Depot",
  });
  const product = await t.app.products.create(owner, {
    sku: "OIL-001",
    name: "Oil filter",
    brand: "Toyota",
    priceMinor: 10000,
    costMinor: 6000,
    reorderLevel: 3,
    defaultSupplierId: supplier.id,
    openingStock: { locationId: location.id, quantity: 10 },
  });
  return { warehouse, location, customer, supplier, product };
}
