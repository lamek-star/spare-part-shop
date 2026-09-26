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

test("purchasing: create, confirm, receive partially then fully; stock rises only on receipt", async () => {
  const t = await makeApp();
  try {
    const { product, supplier, location } = await seedBasics(t);
    const inv = t.actors.INVENTORY;
    const po = await t.app.purchasing.create(inv, {
      supplierId: supplier.id,
      locationId: location.id,
      taxBp: 500,
      lines: [{ productId: product.id, quantity: 20, unitCostMinor: 5500 }],
    });
    assert.equal(po.status, "DRAFT");
    assert.deepEqual(
      [po.subtotalMinor, po.taxMinor, po.totalMinor],
      [110000, 5500, 115500],
    );
    assert.equal(
      await code(t.app.purchasing.receive(inv, po.id, {})),
      "CONFLICT",
      "a draft cannot receive goods",
    );
    await t.app.purchasing.confirm(inv, po.id);
    assert.equal(
      await code(t.app.purchasing.update(inv, po.id, { notes: "late" })),
      "CONFLICT",
    );
    const half = await t.app.purchasing.receive(inv, po.id, {
      lines: [{ lineId: po.lines[0].id, quantity: 12 }],
    });
    assert.equal(half.status, "PARTIALLY_RECEIVED");
    assert.equal(
      (await t.app.inventory.stockFor(inv, product.id))[0].onHand,
      22,
    );
    assert.equal(
      await code(
        t.app.purchasing.receive(inv, po.id, {
          lines: [{ lineId: po.lines[0].id, quantity: 9 }],
        }),
      ),
      "VALIDATION",
    );
    const done = await t.app.purchasing.receive(inv, po.id, {});
    assert.equal(done.status, "RECEIVED");
    assert.equal(
      (await t.app.inventory.stockFor(inv, product.id))[0].onHand,
      30,
    );
    assert.equal((await t.app.purchasing.close(inv, po.id)).status, "CLOSED");
    assert.equal(await code(t.app.purchasing.cancel(inv, po.id)), "CONFLICT");
    assert.deepEqual(await t.container.repos.inventory.verifyIntegrity(), []);
    const receipts = await t.container.repos.purchasing.receiptsForOrder(po.id);
    assert.equal(receipts.length, 2);
    assert.equal(
      receipts.flatMap((r) => r.lines).reduce((n, l) => n + l.quantity, 0),
      20,
    );
  } finally {
    await t.cleanup();
  }
});

test("purchasing: permissions and cancellation rules", async () => {
  const t = await makeApp();
  try {
    const { product, supplier, location } = await seedBasics(t);
    const spec = {
      supplierId: supplier.id,
      locationId: location.id,
      lines: [{ productId: product.id, quantity: 1, unitCostMinor: 100 }],
    };
    assert.equal(
      await code(t.app.purchasing.create(t.actors.SALES, spec)),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.purchasing.create(t.actors.VIEWER, spec)),
      "FORBIDDEN",
    );
    const po = await t.app.purchasing.create(t.actors.ADMIN, spec);
    await t.app.purchasing.confirm(t.actors.ADMIN, po.id);
    await t.app.purchasing.receive(t.actors.ADMIN, po.id, {});
    assert.equal(
      await code(t.app.purchasing.cancel(t.actors.ADMIN, po.id)),
      "CONFLICT",
      "received goods cannot be cancelled",
    );
    const po2 = await t.app.purchasing.create(t.actors.ADMIN, spec);
    assert.equal(
      (await t.app.purchasing.cancel(t.actors.ADMIN, po2.id)).status,
      "CANCELLED",
    );
    assert.equal(
      await code(
        t.app.purchasing.create(t.actors.ADMIN, { ...spec, lines: [] }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.purchasing.create(t.actors.ADMIN, {
          ...spec,
          supplierId: "nope",
        }),
      ),
      "NOT_FOUND",
    );
  } finally {
    await t.cleanup();
  }
});

test("reports and dashboard are computed from persisted rows and respect permissions", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 4, unitPriceMinor: 10000 }],
    });
    const invoice = await t.app.sales.sellNow(s, order.id);
    await t.app.sales.recordPayment(s, invoice.id, {
      amountMinor: 20000,
      method: "CASH",
    });
    const q = await t.app.sales.createQuotation(s, {
      customerId: customer.id,
      lines: [{ description: "x", quantity: 1, unitPriceMinor: 100 }],
    });
    await t.app.sales.issueQuotation(s, q.id);

    const owner = t.actors.OWNER;
    const d = await t.app.reports.dashboard(owner);
    assert.equal(d.products, 1);
    assert.equal(d.inventoryValueMinor, 6 * 6000, "6 on hand x 60.00 cost");
    assert.equal(d.outstandingInvoices, 1);
    assert.equal(d.outstandingBalanceMinor, 42000 - 20000);
    assert.equal(d.salesThisMonthMinor, 42000);
    assert.equal(d.paymentsThisMonthMinor, 20000);
    assert.equal(d.openQuotations, 1);
    assert.equal(d.lowStockProducts, 0);

    const valuation = await t.app.reports.inventoryValuation(owner);
    assert.deepEqual(
      valuation.map((v) => [v.sku, v.onHand, v.valueMinor]),
      [["OIL-001", 6, 36000]],
    );
    const outstanding = await t.app.reports.outstandingInvoices(owner);
    assert.equal(outstanding[0].balanceMinor, 22000);
    assert.equal(outstanding[0].customerName, "Acme Garage");
    const byProduct = await t.app.reports.salesByProduct(owner, {});
    assert.deepEqual(
      [byProduct[0].sku, byProduct[0].quantity, byProduct[0].totalMinor],
      ["OIL-001", 4, 40000],
    );
    const byPeriod = await t.app.reports.salesByPeriod(owner, {});
    assert.equal(byPeriod[0].totalMinor, 42000);
    assert.equal(byPeriod[0].paidMinor, 20000);
    const activity = await t.app.reports.customerActivity(owner, {});
    assert.deepEqual(
      [activity[0].name, activity[0].balanceMinor],
      ["Acme Garage", 22000],
    );
    assert.equal(
      (await t.app.reports.quotationConversion(owner, {})).issued,
      1,
    );
    assert.equal((await t.app.reports.stockOnHand(owner))[0].available, 6);

    // role-based visibility
    const salesView = await t.app.reports.dashboard(s);
    assert.equal(
      salesView.inventoryValueMinor,
      null,
      "sales must not see inventory value (built from cost)",
    );
    assert.equal(salesView.salesThisMonthMinor, 42000);
    const invView = await t.app.reports.dashboard(t.actors.INVENTORY);
    assert.equal(invView.salesThisMonthMinor, null);
    assert.equal(invView.outstandingBalanceMinor, null);
    assert.equal(await code(t.app.reports.inventoryValuation(s)), "FORBIDDEN");
    assert.equal(
      await code(t.app.reports.salesByPeriod(t.actors.INVENTORY, {})),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.reports.stockOnHand(t.actors.VIEWER)),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.reports.salesByPeriod(owner, { from: "not-a-date" })),
      "VALIDATION",
    );
  } finally {
    await t.cleanup();
  }
});

test("dashboard on an empty database reports zeros, not fake business figures", async () => {
  const t = await makeApp();
  try {
    const d = await t.app.reports.dashboard(t.actors.OWNER);
    assert.deepEqual(
      [
        d.products,
        d.lowStockProducts,
        d.inventoryValueMinor,
        d.openEnquiries,
        d.openQuotations,
        d.openOrders,
        d.outstandingInvoices,
        d.outstandingBalanceMinor,
        d.salesThisMonthMinor,
        d.paymentsThisMonthMinor,
      ],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    assert.deepEqual(
      await t.app.reports.inventoryValuation(t.actors.OWNER),
      [],
    );
  } finally {
    await t.cleanup();
  }
});

test("settings are configuration: the shop name is data, never hard-coded", async () => {
  const t = await makeApp();
  try {
    const cfg = await t.app.settings.get(t.actors.SALES);
    assert.equal(cfg.shopName, "");
    const next = await t.app.settings.update(t.actors.OWNER, {
      shopName: "Gulf Auto Parts",
      defaultTaxBp: 0,
      quotationTerms: "Payment within 14 days.",
    });
    assert.equal(next.shopName, "Gulf Auto Parts");
    assert.equal((await t.app.settings.get(t.actors.VIEWER)).defaultTaxBp, 0);
    assert.equal(
      await code(t.app.settings.update(t.actors.SALES, { shopName: "x" })),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.settings.update(t.actors.OWNER, { currency: "dirham" })),
      "VALIDATION",
    );
    assert.equal(
      await code(t.app.settings.update(t.actors.OWNER, { defaultTaxBp: -1 })),
      "VALIDATION",
    );
    // new quotations pick the configured tax and terms up
    const { customer } = await seedBasics(t);
    const q = await t.app.sales.createQuotation(t.actors.SALES, {
      customerId: customer.id,
      lines: [{ description: "x", quantity: 1, unitPriceMinor: 1000 }],
    });
    assert.equal(q.taxBp, 0);
    assert.equal(q.terms, "Payment within 14 days.");
  } finally {
    await t.cleanup();
  }
});
