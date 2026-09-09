import test from "node:test";
import assert from "node:assert/strict";
import { createDemoAdapter } from "../src/adapters/demo";
import { seed } from "../src/adapters/seed";
import { Order, normalizeNumber, totals } from "../src/domain/models";
const makeOrder = (kind: "Purchase" | "Sale", id: string): Order => ({
  id,
  number: id,
  kind,
  contactId: kind === "Purchase" ? "contact-1" : "contact-6",
  warehouseId: "wh-1",
  date: new Date().toISOString(),
  status: "Draft",
  payment: "Unpaid",
  lines: [
    {
      partId: "part-1",
      quantity: 10,
      price: 45,
      processed: 0,
      returned: 0,
      discount: 0,
    },
  ],
  taxRate: 5,
  notes: "",
});
test("normalization preserves meaningful characters and matches formatting variants", () => {
  assert.equal(normalizeNumber("04465 0k290"), "044650K290");
  assert.equal(normalizeNumber("04465-0K290"), "044650K290");
  assert.notEqual(normalizeNumber("A/B"), normalizeNumber("AB"));
  const a = createDemoAdapter();
  assert.equal(a.catalogue.search("044650K290")[0].id, "part-1");
  assert.equal(a.snapshot().numbers[1].display, "04465-0K290");
});
test("full purchase, partial receipt, sale, invoice, payment and return lifecycle", () => {
  const a = createDemoAdapter();
  a.purchasing.create(makeOrder("Purchase", "po-test"));
  a.purchasing.confirm("po-test");
  a.purchasing.receive("po-test", [4]);
  assert.equal(a.snapshot().orders[0].status, "Partially Received");
  assert.equal(
    a.inventory
      .list()
      .find((x) => x.partId === "part-1" && x.warehouseId === "wh-1")!.onHand,
    4,
  );
  a.purchasing.receive("po-test", [6]);
  a.purchasing.close("po-test");
  a.sales.create(makeOrder("Sale", "so-test"));
  a.sales.confirm("so-test");
  assert.equal(
    a.inventory
      .list()
      .find((x) => x.partId === "part-1" && x.warehouseId === "wh-1")!.reserved,
    10,
  );
  a.sales.fulfill("so-test");
  a.sales.invoice("so-test");
  a.sales.pay("so-test");
  assert.equal(a.snapshot().orders[0].payment, "Paid");
  assert.equal(
    a.inventory
      .list()
      .find((x) => x.partId === "part-1" && x.warehouseId === "wh-1")!.onHand,
    0,
  );
  a.sales.returnItems("so-test", [2]);
  assert.equal(
    a.inventory
      .list()
      .find((x) => x.partId === "part-1" && x.warehouseId === "wh-1")!.onHand,
    2,
  );
  assert.throws(() => a.sales.returnItems("so-test", [9]));
  assert.throws(() => a.sales.fulfill("so-test"));
});
test("invalid receipt is atomic and does not append movements", () => {
  const a = createDemoAdapter();
  a.purchasing.create(makeOrder("Purchase", "p"));
  a.purchasing.confirm("p");
  const before = JSON.stringify(a.snapshot());
  assert.throws(() => a.purchasing.receive("p", [11]));
  assert.equal(JSON.stringify(a.snapshot()), before);
  assert.throws(() => a.purchasing.receive("p", [-1]));
  assert.throws(() => a.purchasing.receive("p", [NaN]));
});
test("transfers conserve stock and cannot spend reservations", () => {
  const a = createDemoAdapter();
  const before = a.inventory
    .list()
    .filter((x) => x.partId === "part-2")
    .reduce((n, x) => n + x.onHand, 0);
  a.inventory.transfer("part-2", "wh-1", "wh-2", 3, "Rebalance");
  assert.equal(
    a.inventory
      .list()
      .filter((x) => x.partId === "part-2")
      .reduce((n, x) => n + x.onHand, 0),
    before,
  );
  assert.throws(() => a.inventory.transfer("part-2", "wh-1", "wh-1", 2, ""));
  assert.throws(() => a.inventory.transfer("part-2", "wh-1", "wh-2", 999, ""));
  const o = makeOrder("Sale", "reserved");
  o.lines[0].partId = "part-2";
  a.sales.create(o);
  a.sales.confirm(o.id);
  assert.throws(() =>
    a.inventory.adjust("part-2", "wh-1", -10, "Bad adjustment"),
  );
});
test("supersession rejects circular chains without changing state", () => {
  const a = createDemoAdapter();
  const before = JSON.stringify(a.snapshot());
  assert.throws(() => a.catalogue.supersede("num-0-oe", "num-old"));
  assert.equal(JSON.stringify(a.snapshot()), before);
  assert.throws(() => a.catalogue.supersede("num-0-oe", "num-0-oe"));
});
test("duplicate OEM references are permitted across brands", () => {
  const a = createDemoAdapter();
  const n = a.snapshot().numbers[1];
  a.catalogue.addNumber({
    ...n,
    id: "duplicate-oe",
    partId: "part-2",
    brand: "Other brand",
  });
  assert.equal(a.catalogue.search(n.display).length, 2);
});
test("failed persistence does not publish uncommitted state", () => {
  const a = createDemoAdapter(seed(), () => {
    throw new Error("Quota exceeded");
  });
  const before = JSON.stringify(a.snapshot());
  assert.throws(() => a.inventory.adjust("part-2", "wh-1", 1, "Test"));
  assert.equal(JSON.stringify(a.snapshot()), before);
});
test("discount and tax totals round to currency precision", () => {
  const o = makeOrder("Sale", "total");
  o.lines = [
    {
      partId: "part-1",
      quantity: 3,
      price: 19.99,
      discount: 10,
      processed: 0,
      returned: 0,
    },
  ];
  assert.deepEqual(totals(o), { subtotal: 53.97, tax: 2.7, total: 56.67 });
});

test("management renames preserve demo relationships", () => {
  const a = createDemoAdapter();
  const branch = a.snapshot().branches[0];
  a.management.saveBranch({ ...branch, name: "Sharjah Central" });
  assert.equal(a.snapshot().warehouses[0].branch, "Sharjah Central");
  const role = a.snapshot().roles[0];
  a.management.saveRole({ ...role, name: "Business owner" });
  assert.equal(a.snapshot().users[0].role, "Business owner");
});
test("compatibility validates references and duplicate links", () => {
  const a = createDemoAdapter();
  assert.throws(() =>
    a.compatibility.link({
      id: "bad",
      partId: "missing",
      vehicleId: "v1",
      notes: "",
      source: "Demo",
    }),
  );
  assert.throws(() =>
    a.compatibility.link({ ...a.snapshot().compatibility[0], id: "dup" }),
  );
  a.compatibility.saveVehicle({
    id: "new-vehicle",
    make: "Demo",
    model: "Example",
    variant: "Test",
    from: 2020,
    to: 2026,
    engine: "Demo",
    engineCode: "DEMO",
    transmission: "Manual",
  });
  a.compatibility.link({
    id: "new-link",
    partId: "part-1",
    vehicleId: "new-vehicle",
    notes: "Unverified",
    source: "Demo",
  });
  assert.equal(
    a.snapshot().compatibility.filter((c) => c.partId === "part-1").length,
    3,
  );
});
test("a failed second receipt line rolls back the whole receipt", () => {
  const a = createDemoAdapter();
  const o = makeOrder("Purchase", "multi");
  o.lines.push({ ...o.lines[0], partId: "part-2", quantity: 2 });
  a.purchasing.create(o);
  a.purchasing.confirm(o.id);
  const before = JSON.stringify(a.snapshot());
  assert.throws(() => a.purchasing.receive(o.id, [5, 3]));
  assert.equal(JSON.stringify(a.snapshot()), before);
});
