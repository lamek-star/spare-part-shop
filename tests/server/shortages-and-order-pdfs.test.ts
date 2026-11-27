import test from "node:test";
import assert from "node:assert/strict";
import { suggestedQuantity } from "../../src/server/domain/purchasing";
import { makeApp, seedBasics } from "./helpers";

// The PDF writer puts each text run in as hex (<48656C6C6F> Tj): look for it that way.
const shows = (pdf: Uint8Array, s: string) =>
  Buffer.from(pdf).toString("latin1").toUpperCase().includes(Buffer.from(s, "latin1").toString("hex").toUpperCase());

test("the suggested quantity reaches twice the reorder level, counting what is already on order", () => {
  assert.equal(suggestedQuantity({ available: 4, reorderLevel: 6, minimumLevel: 2, onOrder: 0 }), 8);
  assert.equal(suggestedQuantity({ available: 4, reorderLevel: 6, minimumLevel: 2, onOrder: 8 }), 0);
  assert.equal(suggestedQuantity({ available: 0, reorderLevel: 0, minimumLevel: 3, onOrder: 0 }), 6);
  assert.equal(suggestedQuantity({ available: -2, reorderLevel: 0, minimumLevel: 0, onOrder: 0 }), 1);
});

test("Order what needs ordering: one draft per supplier, no supplier listed apart, nothing ordered twice", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    const { product, supplier, location } = await seedBasics(t);
    // 10 on hand, reorder level 12: needs ordering, from its default supplier at the supplier's cost.
    await t.app.products.update(o, product.id, { reorderLevel: 12 });
    const loose = await t.app.products.create(o, { sku: "BRK-9", name: "Brake pad", reorderLevel: 2 });

    const plan = await t.app.purchasing.shortagePlan(o);
    assert.equal(plan.groups.length, 1);
    assert.equal(plan.groups[0].supplierName, supplier.name);
    assert.deepEqual(
      plan.groups[0].lines.map((l) => [l.sku, l.available, l.quantity, l.unitCostMinor]),
      [["OIL-001", 10, 14, 6000]],
    );
    assert.deepEqual(plan.noSupplier.map((l) => l.productId), [loose.id]);

    await assert.rejects(
      () => t.app.purchasing.orderShortages(t.actors.SALES, { locationId: location.id }),
      /may not perform/,
    );
    const made = await t.app.purchasing.orderShortages(o, { locationId: location.id });
    assert.equal(made.orders.length, 1);
    assert.equal(made.orders[0].status, "DRAFT");
    assert.equal(made.orders[0].supplierId, supplier.id);
    assert.deepEqual(made.orders[0].lines.map((l) => [l.quantity, l.unitCostMinor]), [[14, 6000]]);

    // Already on order now: not ordered again.
    const again = await t.app.purchasing.shortagePlan(o);
    assert.equal(again.groups.length, 0);
    assert.deepEqual(again.covered.map((l) => [l.sku, l.onOrder]), [["OIL-001", 14]]);
    await assert.rejects(
      () => t.app.purchasing.orderShortages(o, { locationId: location.id }),
      /Nothing to order/,
    );
  } finally {
    await t.cleanup();
  }
});

test("purchase order and sales order PDFs: the supplier or customer, the lines, and who may print them", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    const { product, supplier, customer, location } = await seedBasics(t);
    const po = await t.app.purchasing.create(o, {
      supplierId: supplier.id,
      locationId: location.id,
      lines: [{ productId: product.id, quantity: 5, unitCostMinor: 6000 }],
    });
    const poPdf = await t.app.documents.purchaseOrderPdf(o, po.id);
    assert.ok(Buffer.from(poPdf.bytes).toString("latin1").startsWith("%PDF"));
    assert.equal(poPdf.fileName, `${po.number}.pdf`);
    for (const s of ["PURCHASE ORDER", "SUPPLIER", supplier.name, "OIL-001", "Unit cost"])
      assert.ok(shows(poPdf.bytes, s), `purchase order PDF shows ${s}`);

    const order = await t.app.sales.createOrder(o, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 2, unitPriceMinor: 10000 }],
    });
    const soPdf = await t.app.documents.salesOrderPdf(o, order.id);
    for (const s of ["SALES ORDER", "CUSTOMER", customer.name, "OIL-001"])
      assert.ok(shows(soPdf.bytes, s), `sales order PDF shows ${s}`);

    // A viewer may not print a purchase order (no purchasing access).
    await assert.rejects(() => t.app.documents.purchaseOrderPdf(t.actors.VIEWER, po.id), /may not perform/);
  } finally {
    await t.cleanup();
  }
});
