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
const integrity = (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.container.repos.inventory.verifyIntegrity();

test("opening stock is a movement, and on-hand equals the sum of movements", async () => {
  const t = await makeApp();
  try {
    const { product, location } = await seedBasics(t);
    const stock = await t.app.inventory.stockFor(t.actors.OWNER, product.id);
    assert.deepEqual(
      stock.map((s) => [s.onHand, s.reserved, s.available]),
      [[10, 0, 10]],
    );
    const moves = await t.app.inventory.movements(t.actors.OWNER, {
      productId: product.id,
    });
    assert.equal(moves.total, 1);
    assert.equal(moves.items[0].type, "OPENING_BALANCE");
    assert.equal(moves.items[0].quantity, 10);
    assert.equal(moves.items[0].locationId, location.id);
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("receiving, adjusting and history stay consistent; impossible stock is refused", async () => {
  const t = await makeApp();
  try {
    const { product, location } = await seedBasics(t);
    const o = t.actors.OWNER;
    await t.app.inventory.receive(o, {
      productId: product.id,
      locationId: location.id,
      quantity: 5,
    });
    await t.app.inventory.adjust(o, {
      productId: product.id,
      locationId: location.id,
      delta: -3,
      reason: "Damaged in handling",
    });
    assert.equal((await t.app.inventory.stockFor(o, product.id))[0].onHand, 12);
    assert.equal(
      await code(
        t.app.inventory.adjust(o, {
          productId: product.id,
          locationId: location.id,
          delta: -13,
          reason: "too many",
        }),
      ),
      "INSUFFICIENT_STOCK",
    );
    assert.equal(
      await code(
        t.app.inventory.adjust(o, {
          productId: product.id,
          locationId: location.id,
          delta: -1,
          reason: "",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.inventory.adjust(o, {
          productId: product.id,
          locationId: location.id,
          delta: 0,
          reason: "x",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.inventory.receive(o, {
          productId: product.id,
          locationId: location.id,
          quantity: 0,
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.inventory.receive(o, {
          productId: product.id,
          locationId: location.id,
          quantity: 1.5,
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      (await t.app.inventory.stockFor(o, product.id))[0].onHand,
      12,
      "failed operations changed nothing",
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("stock movements are immutable at the database level", async () => {
  const t = await makeApp();
  try {
    await seedBasics(t);
    await assert.rejects(
      t.container.db.write((h) =>
        h.run("UPDATE stock_movements SET quantity = 999"),
      ),
      /immutable/,
    );
    await assert.rejects(
      t.container.db.write((h) => h.run("DELETE FROM stock_movements")),
      /immutable/,
    );
    await assert.rejects(
      t.container.db.write((h) =>
        h.run("UPDATE stock_balances SET on_hand = -1"),
      ),
      /CHECK/,
    );
  } finally {
    await t.cleanup();
  }
});

test("transfers move stock between locations atomically and keep history", async () => {
  const t = await makeApp();
  try {
    const { product, location, warehouse } = await seedBasics(t);
    const o = t.actors.OWNER;
    const shelf = await t.app.masterData.createLocation(o, warehouse.id, {
      rack: "A",
      shelf: "2",
      bin: "07",
    });
    assert.equal(shelf.code, "A-2-07");
    await t.app.inventory.transfer(o, {
      productId: product.id,
      fromLocationId: location.id,
      toLocationId: shelf.id,
      quantity: 4,
    });
    const stock = await t.app.inventory.stockFor(o, product.id);
    assert.equal(stock.find((s) => s.locationId === location.id)!.onHand, 6);
    assert.equal(stock.find((s) => s.locationId === shelf.id)!.onHand, 4);
    const moves = (
      await t.app.inventory.movements(o, { productId: product.id })
    ).items.filter((m) => m.type.startsWith("TRANSFER"));
    assert.deepEqual(
      moves.map((m) => m.quantity).sort((a, b) => a - b),
      [-4, 4],
    );
    assert.equal(
      await code(
        t.app.inventory.transfer(o, {
          productId: product.id,
          fromLocationId: location.id,
          toLocationId: shelf.id,
          quantity: 7,
        }),
      ),
      "INSUFFICIENT_STOCK",
    );
    assert.equal(
      await code(
        t.app.inventory.transfer(o, {
          productId: product.id,
          fromLocationId: shelf.id,
          toLocationId: shelf.id,
          quantity: 1,
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.masterData.createLocation(o, warehouse.id, {
          rack: "A",
          shelf: "2",
          bin: "07",
        }),
      ),
      "CONFLICT",
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("reservations reduce availability, cannot oversell, and reserved stock cannot be transferred or adjusted away", async () => {
  const t = await makeApp();
  try {
    const { product, location, customer } = await seedBasics(t);
    const o = t.actors.OWNER;
    const quote = await t.app.sales.createQuotation(o, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 8, unitPriceMinor: 10000 }],
    });
    await t.app.sales.issueQuotation(o, quote.id);
    await t.app.sales.acceptQuotation(o, quote.id);
    await t.app.sales.convertToOrder(o, quote.id);
    const b = (await t.app.inventory.stockFor(o, product.id))[0];
    assert.deepEqual([b.onHand, b.reserved, b.available], [10, 8, 2]);
    assert.equal(
      await code(
        t.app.inventory.transfer(o, {
          productId: product.id,
          fromLocationId: location.id,
          toLocationId:
            location.id === "x"
              ? "y"
              : (
                  await t.app.masterData.createLocation(
                    o,
                    (await t.app.masterData.listWarehouses(o)).warehouses[0].id,
                    { code: "B1" },
                  )
                ).id,
          quantity: 3,
        }),
      ),
      "INSUFFICIENT_STOCK",
    );
    assert.equal(
      await code(
        t.app.inventory.adjust(o, {
          productId: product.id,
          locationId: location.id,
          delta: -5,
          reason: "shrinkage",
        }),
      ),
      "INSUFFICIENT_STOCK",
    );
    const second = await t.app.sales
      .createOrder(o, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 3, unitPriceMinor: 10000 }],
      })
      .catch((e) => e);
    assert.equal((second as AppError).code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("concurrent sales cannot oversell the last units", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const o = t.actors.OWNER;
    const tries = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        t.app.sales.createOrder(o, {
          customerId: customer.id,
          lines: [
            { productId: product.id, quantity: 4, unitPriceMinor: 10000 },
          ],
        }),
      ),
    );
    assert.equal(
      tries.filter((x) => x.status === "fulfilled").length,
      2,
      "10 units / 4 each = exactly 2 orders",
    );
    assert.equal(tries.filter((x) => x.status === "rejected").length, 4);
    const b = (await t.app.inventory.stockFor(o, product.id))[0];
    assert.equal(b.reserved, 8);
    assert.equal(b.available, 2);
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("a product's stock can span locations; a reservation takes from several", async () => {
  const t = await makeApp();
  try {
    const { product, location, warehouse, customer } = await seedBasics(t);
    const o = t.actors.OWNER;
    const second = await t.app.masterData.createLocation(o, warehouse.id, {
      code: "OVERFLOW",
    });
    await t.app.inventory.transfer(o, {
      productId: product.id,
      fromLocationId: location.id,
      toLocationId: second.id,
      quantity: 6,
    });
    const order = await t.app.sales.createOrder(o, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 8, unitPriceMinor: 10000 }],
    });
    const held = await t.container.repos.inventory.activeReservations(
      "SALES_ORDER_LINE",
      order.lines[0].id,
    );
    assert.equal(held.length, 2);
    assert.equal(
      held.reduce((n, r) => n + r.quantity, 0),
      8,
    );
    await t.app.sales.fulfillOrder(o, order.id, {});
    const stock = await t.app.inventory.stockFor(o, product.id);
    assert.equal(
      stock.reduce((n, s) => n + s.onHand, 0),
      2,
    );
    assert.equal(
      stock.reduce((n, s) => n + s.reserved, 0),
      0,
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});
