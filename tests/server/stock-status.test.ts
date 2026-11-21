import test from "node:test";
import assert from "node:assert/strict";
import { makeApp, seedBasics } from "./helpers";
import { AppError } from "../../src/server/kernel/errors";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError
      ? e.code
      : `UNEXPECTED:${(e as Error).message}`;
  }
};

test("a part number entered with a new product is stored, searchable and listed; the product takes the shop's currency", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    await t.app.settings.update(o, { currency: "NKF" });
    const p = await t.app.products.create(o, {
      sku: "BRK-1",
      name: "Brake pads",
      manufacturer: "Toyota",
      priceMinor: 200,
      partNumber: "04465-33450",
    });
    assert.equal(p.currency, "NKF", "priced in the shop's currency, not AED");
    const detail = await t.app.products.detail(o, p.id);
    const oem = detail.numbers.find((n) => n.type === "OEM_OE");
    assert.equal(oem?.display, "04465-33450");
    assert.equal(oem?.brand, "Toyota");
    // Found by the number typed any way, and shown beside the SKU in the list.
    const found = await t.app.products.list(o, { q: "0446533450" });
    assert.deepEqual(
      found.items.map((i) => [i.sku, i.partNumber]),
      [["BRK-1", "04465-33450"]],
    );
    // No part number: nothing extra stored, the list shows none.
    const plain = await t.app.products.create(o, {
      sku: "BRK-2",
      name: "Plain",
      priceMinor: 1,
    });
    assert.equal(
      (await t.app.products.detail(o, plain.id)).numbers.filter(
        (n) => n.type !== "INTERNAL_SKU",
      ).length,
      0,
    );
    assert.equal(
      (await t.app.products.list(o, { q: "BRK-2" })).items[0].partNumber,
      "",
    );
    // A currency named by the caller is kept; a part number with no letters or digits is refused.
    assert.equal(
      (
        await t.app.products.create(o, {
          sku: "BRK-3",
          name: "Euro",
          priceMinor: 1,
          currency: "EUR",
        })
      ).currency,
      "EUR",
    );
    assert.equal(
      await code(
        t.app.products.create(o, {
          sku: "BRK-4",
          name: "Bad",
          priceMinor: 1,
          partNumber: "--",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      (await t.app.products.list(o, { q: "BRK-4" })).total,
      0,
      "a refused product is not half-created",
    );
  } finally {
    await t.cleanup();
  }
});

test("the minimum stock level cannot be above the reorder level", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    assert.equal(
      await code(
        t.app.products.create(o, {
          sku: "M1",
          name: "M",
          priceMinor: 1,
          minimumLevel: 5,
          reorderLevel: 3,
        }),
      ),
      "VALIDATION",
    );
    const p = await t.app.products.create(o, {
      sku: "M2",
      name: "M",
      priceMinor: 1,
      minimumLevel: 2,
      reorderLevel: 3,
    });
    assert.equal(p.minimumLevel, 2);
    assert.equal(
      await code(t.app.products.update(o, p.id, { minimumLevel: 4 })),
      "VALIDATION",
    );
    // A minimum without a reorder level is fine (red only, no amber).
    assert.equal(
      (
        await t.app.products.update(o, p.id, {
          reorderLevel: 0,
          minimumLevel: 4,
        })
      ).minimumLevel,
      4,
    );
  } finally {
    await t.cleanup();
  }
});

test("stock status: red at/below the minimum or none left, amber at/below reorder, green above; counts, filter, permission", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    const { location } = await seedBasics(t); // OIL-001: 10 on hand, reorder 3 -> green
    const make = (
      sku: string,
      qty: number,
      minimumLevel: number,
      reorderLevel: number,
      status = "ACTIVE",
    ) =>
      t.app.products.create(o, {
        sku,
        name: sku,
        priceMinor: 1,
        minimumLevel,
        reorderLevel,
        status,
        ...(qty
          ? { openingStock: { locationId: location.id, quantity: qty } }
          : {}),
      });
    await make("A-RED-MIN", 2, 2, 5); // at the minimum
    await make("B-RED-NONE", 0, 0, 0); // none left, no levels set
    await make("C-AMBER", 4, 2, 5);
    await make("D-GREEN", 20, 2, 5);
    await make("E-INACTIVE", 0, 0, 0, "INACTIVE"); // not counted

    const all = await t.app.reports.stockStatus(o, {});
    assert.deepEqual(all.counts, { RED: 2, AMBER: 1, GREEN: 2 });
    assert.deepEqual(
      all.items.map((i) => [i.sku, i.level]),
      [
        ["B-RED-NONE", "RED"],
        ["A-RED-MIN", "RED"],
        ["C-AMBER", "AMBER"],
        ["OIL-001", "GREEN"],
        ["D-GREEN", "GREEN"],
      ],
      "worst first, then fewest available",
    );
    const amber = await t.app.reports.stockStatus(o, { level: "AMBER" });
    assert.deepEqual(
      amber.items.map((i) => [
        i.sku,
        i.available,
        i.minimumLevel,
        i.reorderLevel,
      ]),
      [["C-AMBER", 4, 2, 5]],
    );
    assert.equal(
      (await t.app.reports.stockStatus(o, { limit: 1 })).items.length,
      1,
    );
    assert.equal(
      await code(t.app.reports.stockStatus(o, { level: "PURPLE" })),
      "VALIDATION",
    );
    assert.equal(
      await code(t.app.reports.stockStatus(t.actors.VIEWER, {})),
      "FORBIDDEN",
    );
  } finally {
    await t.cleanup();
  }
});
