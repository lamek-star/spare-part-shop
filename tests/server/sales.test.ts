import test from "node:test";
import assert from "node:assert/strict";
import { makeApp, seedBasics, type TestApp } from "./helpers";
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
const integrity = (t: TestApp) => t.container.repos.inventory.verifyIntegrity();
const stock = async (t: TestApp, productId: string) => {
  const rows = await t.app.inventory.stockFor(t.actors.OWNER, productId);
  return {
    onHand: rows.reduce((n, r) => n + r.onHand, 0),
    reserved: rows.reduce((n, r) => n + r.reserved, 0),
    available: rows.reduce((n, r) => n + r.available, 0),
  };
};
/** enquiry -> issued quotation for `qty` units of the seeded product. */
async function quoted(t: TestApp, qty = 4) {
  const base = await seedBasics(t);
  const s = t.actors.SALES;
  await t.app.sales.addEnquiryItem(s, {
    oemNumber: "OIL-001",
    partName: "Oil filter",
    quantity: qty,
    vehicleDescription: "Corolla",
  });
  const draft = (await t.app.sales.currentEnquiry(s))!;
  await t.app.sales.submitEnquiry(s, draft.id, {
    customerId: base.customer.id,
    contactName: "Buyer",
  });
  const quote = await t.app.sales.createQuotationFromEnquiry(s, draft.id);
  return { ...base, enquiryId: draft.id, quote };
}

test("enquiry cart: duplicates merge, drafts are per user, submit needs a contact", async () => {
  const t = await makeApp();
  try {
    const s = t.actors.SALES;
    await t.app.sales.addEnquiryItem(s, {
      oemNumber: "15690-65010",
      partName: "Valve",
      quantity: 1,
      vehicleDescription: "Carina",
    });
    const e = await t.app.sales.addEnquiryItem(s, {
      oemNumber: "1569065010",
      partName: "Valve",
      quantity: 2,
      vehicleDescription: "Carina",
    });
    assert.equal(e.items.length, 1, "same part in another format merges");
    assert.equal(e.items[0].quantity, 3);
    const other = await t.app.sales.addEnquiryItem(t.actors.ADMIN, {
      oemNumber: "X1",
      quantity: 1,
    });
    assert.notEqual(other.id, e.id, "each user has their own draft");
    assert.equal(
      await code(t.app.sales.submitEnquiry(s, e.id, {})),
      "VALIDATION",
    );
    assert.equal(
      await code(t.app.sales.addEnquiryItem(s, { oemNumber: "", quantity: 1 })),
      "VALIDATION",
    );
    const submitted = await t.app.sales.submitEnquiry(s, e.id, {
      contactName: "Walk-in",
      contactEmail: "w@x.test",
    });
    assert.equal(submitted.status, "SUBMITTED");
    assert.match(submitted.number, /^ENQ-\d{4}-\d{6}$/);
    assert.equal(
      await code(t.app.sales.submitEnquiry(s, e.id, { contactName: "Again" })),
      "CONFLICT",
    );
    assert.equal(
      await t.app.sales.currentEnquiry(s),
      null,
      "submitting closes the cart",
    );
  } finally {
    await t.cleanup();
  }
});

test("enquiry persists across sessions (it is in the database, not the browser)", async () => {
  const t = await makeApp();
  try {
    await t.app.sales.addEnquiryItem(t.actors.SALES, {
      oemNumber: "90915-10009",
      partName: "Oil filter",
      quantity: 2,
    });
    await t.container.close();
    const { createContainer } =
      await import("../../src/server/standalone/container");
    const { createApp } = await import("../../src/server/domain/app");
    const again = await createContainer({ dataDir: t.dir });
    const app2 = createApp(again);
    const draft = await app2.sales.currentEnquiry(t.actors.SALES);
    assert.equal(draft?.items[0].oemNumber, "90915-10009");
    await again.close();
  } finally {
    await t.cleanup();
  }
});

test("enquiry -> quotation carries customer and lines, pre-prices from a matching product, and marks the enquiry QUOTED", async () => {
  const t = await makeApp();
  try {
    const { quote, customer, enquiryId, product } = await quoted(t, 4);
    assert.equal(quote.status, "DRAFT");
    assert.equal(quote.customerId, customer.id);
    assert.equal(quote.enquiryId, enquiryId);
    assert.equal(quote.lines.length, 1);
    assert.equal(quote.lines[0].productId, product.id);
    assert.equal(quote.lines[0].quantity, 4);
    assert.equal(quote.lines[0].unitPriceMinor, 10000);
    // 4 x 100.00 = 400.00, 5% tax = 20.00
    assert.deepEqual(
      [quote.subtotalMinor, quote.taxMinor, quote.totalMinor],
      [40000, 2000, 42000],
    );
    assert.equal(
      (await t.app.sales.getEnquiry(t.actors.SALES, enquiryId)).status,
      "QUOTED",
    );
    assert.equal(
      await code(
        t.app.sales.createQuotationFromEnquiry(t.actors.SALES, enquiryId, {}),
      ),
      "OK",
      "an enquiry may be re-quoted",
    );
  } finally {
    await t.cleanup();
  }
});

test("quotation totals are exact with discounts and tax, and never trust client totals", async () => {
  const t = await makeApp();
  try {
    const { customer } = await seedBasics(t);
    const q = await t.app.sales.createQuotation(t.actors.SALES, {
      customerId: customer.id,
      taxBp: 500,
      lines: [
        {
          description: "Gasket",
          quantity: 3,
          unitPriceMinor: 1999,
          lineTotalMinor: 1,
        },
        {
          description: "Bolt",
          quantity: 1,
          unitPriceMinor: 5,
          discountBp: 1000,
        },
        {
          description: "Hose",
          quantity: 2,
          unitPriceMinor: 3333,
          discountBp: 1250,
        },
      ],
    });
    // 3*19.99=59.97 ; 0.05*0.9=0.045->0.05 ; 2*33.33*0.875=58.3275->58.33
    assert.deepEqual(
      q.lines.map((l) => l.lineTotalMinor),
      [5997, 5, 5833],
    );
    assert.equal(q.subtotalMinor, 11835);
    assert.equal(q.taxMinor, 592); // 5% of 118.35 = 5.9175 -> 5.92
    assert.equal(q.totalMinor, 12427);
    const edited = await t.app.sales.updateQuotation(t.actors.SALES, q.id, {
      lines: [{ description: "Only", quantity: 1, unitPriceMinor: 100 }],
      taxBp: 0,
    });
    assert.deepEqual(
      [edited.subtotalMinor, edited.taxMinor, edited.totalMinor],
      [100, 0, 100],
    );
  } finally {
    await t.cleanup();
  }
});

test("quotation lifecycle: issue needs prices, only drafts edit, transitions are enforced", async () => {
  const t = await makeApp();
  try {
    const { customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const q = await t.app.sales.createQuotation(s, {
      customerId: customer.id,
      lines: [{ description: "Unpriced part", quantity: 1, unitPriceMinor: 0 }],
    });
    assert.equal(
      await code(t.app.sales.issueQuotation(s, q.id)),
      "VALIDATION",
      "every line must be priced before issuing",
    );
    await t.app.sales.updateQuotation(s, q.id, {
      lines: [
        { description: "Priced part", quantity: 1, unitPriceMinor: 5000 },
      ],
    });
    assert.equal(
      await code(t.app.sales.acceptQuotation(s, q.id)),
      "CONFLICT",
      "cannot accept a draft",
    );
    const issued = await t.app.sales.issueQuotation(s, q.id);
    assert.equal(issued.status, "ISSUED");
    assert.ok(issued.issuedAt);
    assert.equal(
      await code(t.app.sales.updateQuotation(s, q.id, { notes: "late edit" })),
      "CONFLICT",
    );
    assert.equal(await code(t.app.sales.issueQuotation(s, q.id)), "CONFLICT");
    assert.equal(
      (await t.app.sales.rejectQuotation(s, q.id)).status,
      "REJECTED",
    );
    assert.equal(await code(t.app.sales.acceptQuotation(s, q.id)), "CONFLICT");
    const c = await t.app.sales.createQuotation(s, {
      customerId: customer.id,
      lines: [{ description: "X", quantity: 1, unitPriceMinor: 100 }],
    });
    assert.equal(
      (await t.app.sales.cancelQuotation(s, c.id)).status,
      "CANCELLED",
    );
    assert.equal(
      await code(t.app.sales.convertToOrder(s, c.id)),
      "CONFLICT",
      "a cancelled quotation cannot become an order",
    );
  } finally {
    await t.cleanup();
  }
});

test("an expired quotation cannot be accepted", async () => {
  const t = await makeApp();
  try {
    const { customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const q = await t.app.sales.createQuotation(s, {
      customerId: customer.id,
      lines: [{ description: "X", quantity: 1, unitPriceMinor: 100 }],
    });
    await t.app.sales.issueQuotation(s, q.id);
    await t.container.db.write((h) =>
      h.run("UPDATE quotations SET valid_until = '2000-01-01' WHERE id = ?", [
        q.id,
      ]),
    );
    assert.equal(await code(t.app.sales.acceptQuotation(s, q.id)), "CONFLICT");
    assert.equal((await t.app.sales.getQuotation(s, q.id)).status, "EXPIRED");
    assert.equal(await code(t.app.sales.convertToOrder(s, q.id)), "CONFLICT");
  } finally {
    await t.cleanup();
  }
});

test("quote -> order reserves stock; the order is traceable back to quote and enquiry; conversion is idempotent", async () => {
  const t = await makeApp();
  try {
    const { quote, product, enquiryId } = await quoted(t, 4);
    const s = t.actors.SALES;
    await t.app.sales.issueQuotation(s, quote.id);
    await t.app.sales.acceptQuotation(s, quote.id);
    const order = await t.app.sales.convertToOrder(s, quote.id);
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.quotationId, quote.id);
    assert.equal(order.enquiryId, enquiryId);
    assert.equal(order.totalMinor, quote.totalMinor);
    assert.deepEqual(await stock(t, product.id), {
      onHand: 10,
      reserved: 4,
      available: 6,
    });
    const again = await t.app.sales.convertToOrder(s, quote.id);
    assert.equal(again.id, order.id);
    assert.deepEqual(
      await stock(t, product.id),
      { onHand: 10, reserved: 4, available: 6 },
      "no double reservation",
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("order shortfall: rejected by default, or backordered and reserved later", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const lines = [
      { productId: product.id, quantity: 15, unitPriceMinor: 10000 },
    ];
    assert.equal(
      await code(
        t.app.sales.createOrder(s, { customerId: customer.id, lines }),
      ),
      "INSUFFICIENT_STOCK",
    );
    assert.deepEqual(
      await stock(t, product.id),
      { onHand: 10, reserved: 0, available: 10 },
      "a refused order leaves no partial reservation",
    );
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines,
      shortfall: "backorder",
    });
    assert.deepEqual(await stock(t, product.id), {
      onHand: 10,
      reserved: 0,
      available: 10,
    });
    await t.app.inventory.receive(t.actors.INVENTORY, {
      productId: product.id,
      locationId: (await t.container.repos.masterData.listLocations())[0].id,
      quantity: 5,
    });
    await t.app.sales.reserveShortfall(s, order.id);
    assert.deepEqual(await stock(t, product.id), {
      onHand: 15,
      reserved: 15,
      available: 0,
    });
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("fulfilment deducts stock; partial fulfilment is tracked; a delivered order cannot be cancelled", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 6, unitPriceMinor: 10000 }],
    });
    const partial = await t.app.sales.fulfillOrder(s, order.id, {
      lines: [{ lineId: order.lines[0].id, quantity: 2 }],
    });
    assert.equal(partial.status, "PARTIALLY_FULFILLED");
    assert.deepEqual(await stock(t, product.id), {
      onHand: 8,
      reserved: 4,
      available: 4,
    });
    assert.equal(
      await code(
        t.app.sales.fulfillOrder(s, order.id, {
          lines: [{ lineId: order.lines[0].id, quantity: 5 }],
        }),
      ),
      "VALIDATION",
    );
    assert.equal(await code(t.app.sales.cancelOrder(s, order.id)), "CONFLICT");
    const done = await t.app.sales.fulfillOrder(s, order.id, {});
    assert.equal(done.status, "FULFILLED");
    assert.deepEqual(await stock(t, product.id), {
      onHand: 4,
      reserved: 0,
      available: 4,
    });
    const sales = await t.app.inventory.movements(t.actors.OWNER, {
      productId: product.id,
    });
    assert.equal(
      sales.items
        .filter((m) => m.type === "SALE")
        .reduce((n, m) => n + m.quantity, 0),
      -6,
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("cancelling an order before delivery releases every reservation", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 7, unitPriceMinor: 10000 }],
    });
    assert.deepEqual(await stock(t, product.id), {
      onHand: 10,
      reserved: 7,
      available: 3,
    });
    const cancelled = await t.app.sales.cancelOrder(s, order.id, {
      reason: "Customer changed mind",
    });
    assert.equal(cancelled.status, "CANCELLED");
    assert.deepEqual(await stock(t, product.id), {
      onHand: 10,
      reserved: 0,
      available: 10,
    });
    assert.equal(
      await code(t.app.sales.fulfillOrder(s, order.id, {})),
      "CONFLICT",
    );
    assert.equal(
      await code(t.app.sales.invoiceOrder(s, order.id, {})),
      "CONFLICT",
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("order -> invoice bills only what was delivered; payments are partial then full; totals stay exact", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 4, unitPriceMinor: 10000 }],
    });
    assert.equal(
      await code(t.app.sales.invoiceOrder(s, order.id, {})),
      "CONFLICT",
      "nothing delivered yet",
    );
    await t.app.sales.fulfillOrder(s, order.id, {
      lines: [{ lineId: order.lines[0].id, quantity: 3 }],
    });
    const inv1 = await t.app.sales.invoiceOrder(s, order.id, {});
    assert.equal(inv1.lines[0].quantity, 3);
    assert.deepEqual(
      [inv1.subtotalMinor, inv1.taxMinor, inv1.totalMinor],
      [30000, 1500, 31500],
    );
    assert.equal(inv1.status, "ISSUED");
    assert.equal(inv1.salesOrderId, order.id);
    assert.equal(
      await code(t.app.sales.invoiceOrder(s, order.id, {})),
      "CONFLICT",
      "already billed",
    );
    const p1 = await t.app.sales.recordPayment(s, inv1.id, {
      amountMinor: 10000,
      method: "CASH",
    });
    assert.equal(p1.invoice.status, "PARTIALLY_PAID");
    assert.equal(p1.invoice.balanceMinor, 21500);
    assert.equal(
      await code(
        t.app.sales.recordPayment(s, inv1.id, {
          amountMinor: 21501,
          method: "CARD",
        }),
      ),
      "VALIDATION",
      "cannot overpay",
    );
    assert.equal(
      await code(
        t.app.sales.recordPayment(s, inv1.id, {
          amountMinor: 0,
          method: "CARD",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.sales.recordPayment(s, inv1.id, {
          amountMinor: 100,
          method: "BITCOIN",
        }),
      ),
      "VALIDATION",
    );
    const p2 = await t.app.sales.recordPayment(s, inv1.id, {
      amountMinor: 21500,
      method: "BANK_TRANSFER",
      reference: "TT-991",
    });
    assert.equal(p2.invoice.status, "PAID");
    assert.equal(p2.invoice.balanceMinor, 0);
    assert.equal(
      await code(
        t.app.sales.recordPayment(s, inv1.id, {
          amountMinor: 1,
          method: "CASH",
        }),
      ),
      "CONFLICT",
    );
    const { payments } = await t.app.sales.getInvoice(s, inv1.id);
    assert.equal(
      payments.reduce((n, p) => n + p.amountMinor, 0),
      inv1.totalMinor,
      "sum of payments equals the invoice total",
    );
    // the rest is delivered and billed on a second invoice; the order then closes as INVOICED
    await t.app.sales.fulfillOrder(s, order.id, {});
    const inv2 = await t.app.sales.invoiceOrder(s, order.id, {});
    assert.equal(inv2.lines[0].quantity, 1);
    assert.equal((await t.app.sales.getOrder(s, order.id)).status, "INVOICED");
    assert.notEqual(inv1.number, inv2.number);
    await assert.rejects(
      t.container.db.write((h) =>
        h.run("UPDATE payments SET amount_minor = 1"),
      ),
      /immutable/,
    );
    await assert.rejects(
      t.container.db.write((h) => h.run("DELETE FROM payments")),
      /immutable/,
    );
  } finally {
    await t.cleanup();
  }
});

test("voiding an unpaid invoice re-opens billing; a paid one cannot be voided", async () => {
  const t = await makeApp();
  try {
    const { product, customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 2, unitPriceMinor: 10000 }],
    });
    const inv = await t.app.sales.sellNow(s, order.id);
    assert.equal((await t.app.sales.getOrder(s, order.id)).status, "INVOICED");
    await t.app.sales.recordPayment(s, inv.id, {
      amountMinor: 1000,
      method: "CASH",
    });
    assert.equal(
      await code(t.app.sales.voidInvoice(s, inv.id, { reason: "typo" })),
      "CONFLICT",
    );
    const order2 = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 10000 }],
    });
    const inv2 = await t.app.sales.sellNow(s, order2.id);
    const voided = await t.app.sales.voidInvoice(s, inv2.id, {
      reason: "Wrong customer",
    });
    assert.equal(voided.status, "VOID");
    assert.equal(
      (await t.app.sales.getOrder(s, order2.id)).status,
      "FULFILLED",
    );
    const rebill = await t.app.sales.invoiceOrder(s, order2.id, {});
    assert.equal(rebill.totalMinor, inv2.totalMinor);
    assert.equal(
      await code(
        t.app.sales.recordPayment(s, inv2.id, {
          amountMinor: 1,
          method: "CASH",
        }),
      ),
      "CONFLICT",
      "no payments on a void invoice",
    );
  } finally {
    await t.cleanup();
  }
});

test("returns restore stock at the chosen location and cannot exceed what was delivered", async () => {
  const t = await makeApp();
  try {
    const { product, customer, location } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 5, unitPriceMinor: 10000 }],
    });
    assert.equal(
      await code(
        t.app.sales.returnItems(s, order.id, {
          reason: "x",
          lines: [
            { lineId: order.lines[0].id, quantity: 1, locationId: location.id },
          ],
        }),
      ),
      "VALIDATION",
      "nothing delivered yet",
    );
    await t.app.sales.fulfillOrder(s, order.id, {});
    assert.equal((await stock(t, product.id)).onHand, 5);
    const ret = await t.app.sales.returnItems(s, order.id, {
      reason: "Wrong part",
      lines: [
        { lineId: order.lines[0].id, quantity: 2, locationId: location.id },
      ],
    });
    assert.match(ret.number, /^RET-/);
    assert.equal((await stock(t, product.id)).onHand, 7);
    assert.equal(
      await code(
        t.app.sales.returnItems(s, order.id, {
          reason: "again",
          lines: [
            { lineId: order.lines[0].id, quantity: 4, locationId: location.id },
          ],
        }),
      ),
      "VALIDATION",
    );
    assert.deepEqual(await integrity(t), []);
  } finally {
    await t.cleanup();
  }
});

test("special-order lines with no stocked product need no stock and can still be sold", async () => {
  const t = await makeApp();
  try {
    const { customer } = await seedBasics(t);
    const s = t.actors.SALES;
    const order = await t.app.sales.createOrder(s, {
      customerId: customer.id,
      lines: [
        {
          description: "Special-order gasket 11115-15100",
          oemNumber: "11115-15100",
          quantity: 2,
          unitPriceMinor: 4500,
        },
      ],
    });
    const inv = await t.app.sales.sellNow(s, order.id);
    assert.equal(inv.totalMinor, 9450);
  } finally {
    await t.cleanup();
  }
});

test("every step writes an audit event naming the actor", async () => {
  const t = await makeApp();
  try {
    const { quote } = await quoted(t, 2);
    await t.app.sales.issueQuotation(t.actors.SALES, quote.id);
    const events = await t.app.audit.query(t.actors.OWNER, {
      entityType: "quotation",
      entityId: quote.id,
    });
    assert.deepEqual(events.map((e) => e.action).sort(), [
      "quotation.create",
      "quotation.issue",
    ]);
    assert.ok(events.every((e) => e.actorLabel === "SALES User"));
    assert.equal(
      await code(t.app.audit.query(t.actors.SALES, {})),
      "FORBIDDEN",
    );
  } finally {
    await t.cleanup();
  }
});

test("authorization is enforced in the business layer for every role", async () => {
  const t = await makeApp();
  try {
    const { customer, product } = await seedBasics(t);
    const q = {
      customerId: customer.id,
      lines: [{ description: "X", quantity: 1, unitPriceMinor: 100 }],
    };
    assert.equal(
      await code(t.app.sales.createQuotation(t.actors.VIEWER, q)),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.sales.createQuotation(t.actors.INVENTORY, q)),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.sales.createQuotation(t.actors.SALES, q)),
      "OK",
    );
    assert.equal(
      await code(t.app.sales.createOrder(t.actors.VIEWER, q)),
      "FORBIDDEN",
    );
    const order = await t.app.sales.createOrder(t.actors.SALES, {
      ...q,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 100 }],
    });
    const inv = await t.app.sales.sellNow(t.actors.SALES, order.id);
    assert.equal(
      await code(
        t.app.sales.recordPayment(t.actors.INVENTORY, inv.id, {
          amountMinor: 1,
          method: "CASH",
        }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.sales.recordPayment(t.actors.VIEWER, inv.id, {
          amountMinor: 1,
          method: "CASH",
        }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.sales.listInvoices(t.actors.INVENTORY, {})),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.masterData.createCustomer(t.actors.INVENTORY, { name: "X" }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.masterData.createSupplier(t.actors.SALES, { name: "X" }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.inventory.adjust(t.actors.SALES, {
          productId: product.id,
          locationId: "x",
          delta: 1,
          reason: "r",
        }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(t.app.inventory.stockFor(t.actors.VIEWER, product.id)),
      "OK",
    );
  } finally {
    await t.cleanup();
  }
});
