import test from "node:test";
import assert from "node:assert/strict";
import { makeHttpApp, type HttpApp, type Client } from "./http-helpers";
import { PdfDocument, textWidth, wrapText } from "../../src/server/documents/pdf";

/** Text drawn on the PDF, decoded from the hex strings the writer emits. */
function pdfText(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString("latin1");
  return [...s.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("\n");
}
function assertWellFormed(bytes: Uint8Array) {
  const s = Buffer.from(bytes).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(startxref, startxref + 4), "xref");
  const size = Number(/xref\n0 (\d+)/.exec(s.slice(startxref))![1]);
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, size - 1);
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`));
}

async function sale(t: HttpApp) {
  const owner = await t.as("OWNER");
  await owner.put("/settings", { shopName: "Gulf Auto Parts LLC", address: "Warehouse 4, Al Quoz, Dubai", phone: "+971 4 000 0000", email: "sales@gulf.test", taxRegistration: "TRN 100200300", defaultTaxBp: 500 });
  const wh = (await owner.post("/warehouses", { name: "Main" })).data;
  const loc = ((await owner.get("/warehouses")).data.locations as { id: string; warehouseId: string }[]).find((l) => l.warehouseId === wh.id)!;
  const cust = (await owner.post("/customers", { name: "Acme Garage", email: "a@acme.test", billingAddress: "Industrial Area 3, Sharjah", taxNumber: "TRN 999" })).data;
  const prod = (await owner.post("/products", { sku: "OIL-001", name: "Oil filter", priceMinor: 12345, costMinor: 6000, openingStock: { locationId: loc.id, quantity: 50 } })).data;
  const sales = await t.as("SALES");
  const q = (await sales.post("/quotations", { customerId: cust.id, notes: "Prices valid for the period stated.", terms: "Payment within 30 days.", lines: [{ productId: prod.id, description: "Oil filter – genuine", quantity: 3, unitPriceMinor: 12345, discountBp: 1000 }, { description: "Custom line with a very long description that must wrap across several lines in the table without overflowing into the totals column", quantity: 1, unitPriceMinor: 999 }] })).data;
  return { owner, sales, q, cust, prod };
}

test("the PDF writer produces a structurally valid file and measures text", () => {
  const doc = new PdfDocument("Test");
  doc.text(50, 50, "Hello (world) \\ é – €", { size: 12, bold: true });
  doc.addPage();
  doc.rect(10, 10, 100, 20, [0.9, 0.9, 0.9]);
  doc.line(10, 40, 200, 40);
  const bytes = doc.build();
  assertWellFormed(bytes);
  assert.equal(Buffer.from(bytes).toString("latin1").match(/\/Type \/Page /g)!.length, 2);
  assert.match(pdfText(bytes), /Hello \(world\) \\ \xe9 \x96 \x80/);
  assert.ok(textWidth("iiii", 10) < textWidth("WWWW", 10));
  assert.ok(textWidth("abc", 10, true) > textWidth("abc", 10));
  const lines = wrapText("alpha beta gamma delta epsilon", textWidth("gamma delta", 10) + 1, 10);
  assert.deepEqual(lines, ["alpha beta", "gamma delta", "epsilon"]);
  assert.ok(wrapText("Supercalifragilisticexpialidocious".repeat(3), 80, 10).every((l) => textWidth(l, 10) <= 80.01), "long words are split, never overflow");
});

test("a quotation PDF carries the shop, customer, lines and totals, and is stored through FileStorage", async () => {
  const t = await makeHttpApp();
  try {
    const { sales, q } = await sale(t);
    const res = await sales.get(`/quotations/${q.id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-disposition")!, new RegExp(`inline; filename="${q.number}.pdf"`));
    assertWellFormed(res.raw);
    const text = pdfText(res.raw);
    for (const expected of ["Gulf Auto Parts LLC", "Warehouse 4, Al Quoz, Dubai", "TRN 100200300", "QUOTATION", q.number, "Acme Garage", "Industrial Area 3, Sharjah", "OIL-001", "Oil filter \x96 genuine", "123.45", "less 10%", "Payment within 30 days."])
      assert.ok(text.includes(expected), `missing "${expected}" in:\n${text}`);
    assert.ok(text.includes(`AED ${(q.subtotalMinor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`), "subtotal");
    assert.ok(text.includes(`AED ${(q.totalMinor / 100).toFixed(2)}`), "total");
    // stored once, replaced (not accumulated) on regeneration
    await sales.get(`/quotations/${q.id}/pdf`);
    const files = await t.container.repos.files.listFor("quotation", q.id, "QUOTATION_PDF");
    assert.equal(files.length, 1);
    const stored = await t.container.repos.files.get(files[0].id);
    assert.equal(stored!.file.mime, "application/pdf");
    // and downloadable by id under the same permission
    assert.equal((await sales.get(`/files/${files[0].id}`)).status, 200);
    assert.equal((await t.as("INVENTORY").then((c: Client) => c.get(`/files/${files[0].id}`))).status, 403, "inventory staff cannot read quotations");
    assert.equal((await t.as("VIEWER").then((c: Client) => c.get(`/quotations/${q.id}/pdf`))).status, 403);
    assert.equal((await sales.get("/quotations/nope/pdf")).status, 404);
  } finally {
    await t.cleanup();
  }
});

test("a long quotation paginates and numbers its pages", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    const cust = (await owner.post("/customers", { name: "Bulk Buyer" })).data;
    const lines = Array.from({ length: 70 }, (_, i) => ({ description: `Line item number ${i + 1}`, quantity: 1, unitPriceMinor: 100 + i }));
    const q = (await owner.post("/quotations", { customerId: cust.id, lines })).data;
    const res = await owner.get(`/quotations/${q.id}/pdf`);
    assertWellFormed(res.raw);
    const pages = Buffer.from(res.raw).toString("latin1").match(/\/Type \/Page /g)!.length;
    assert.ok(pages >= 2);
    const text = pdfText(res.raw);
    assert.ok(text.includes(`page 1 of ${pages}`) && text.includes(`page ${pages} of ${pages}`));
    assert.ok(text.includes("Line item number 70"));
  } finally {
    await t.cleanup();
  }
});

test("an invoice PDF shows payments and the balance due", async () => {
  const t = await makeHttpApp();
  try {
    const { sales, q } = await sale(t);
    await sales.post(`/quotations/${q.id}/issue`);
    await sales.post(`/quotations/${q.id}/accept`);
    const order = (await sales.post(`/quotations/${q.id}/order`, { shortfall: "backorder" })).data;
    await sales.post(`/orders/${order.id}/fulfil`, {});
    const inv = (await sales.post(`/orders/${order.id}/invoice`, {})).data;
    await sales.post(`/invoices/${inv.id}/payments`, { amountMinor: 5000, method: "CASH", reference: "RCPT-77" });
    const res = await sales.get(`/invoices/${inv.id}/pdf`);
    assert.equal(res.status, 200);
    assertWellFormed(res.raw);
    const text = pdfText(res.raw);
    for (const expected of ["TAX INVOICE", inv.number, "Balance due", "PAYMENTS RECEIVED", "CASH  ref RCPT-77", "AED 50.00", "Acme Garage"]) assert.ok(text.includes(expected), `missing "${expected}"`);
    assert.ok(text.includes(`AED ${((inv.totalMinor - 5000) / 100).toFixed(2)}`), "balance due");
    assert.equal((await t.as("INVENTORY").then((c: Client) => c.get(`/invoices/${inv.id}/pdf`))).status, 403);
  } finally {
    await t.cleanup();
  }
});
