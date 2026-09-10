import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/adapters/seed";
import { createDemoAdapter } from "../src/adapters/demo";
import { mergeNengunCatalogue, rows } from "../src/data/nengun-headlamp";
test("Nengun import preserves existing operations and is idempotent", () => {
  const initial = seed();
  initial.parts[0].notes = "Keep my edit";
  const s = mergeNengunCatalogue(initial);
  assert.equal(rows.length, 38);
  assert.equal(s.parts.length, initial.parts.length + 38);
  assert.deepEqual(s.movements, initial.movements);
  assert.deepEqual(s.orders, initial.orders);
  assert.equal(s.parts[0].notes, "Keep my edit");
  assert.deepEqual(mergeNengunCatalogue(s), s);
});
test("source numbers, diagram codes, currency and images remain distinct", () => {
  const s = mergeNengunCatalogue(seed());
  const a = createDemoAdapter(s);
  const p = a.catalogue.search("8301 a619")[0];
  assert.equal(p.catalogueSource?.priceJpy, 166452);
  assert.equal(p.catalogueSource?.diagramCode, "80030AL");
  assert.equal(p.price, 0);
  assert.equal(p.pricingPending, true);
  assert.equal(p.images[0], "/catalogue/mitsubishi-headlamp.png");
  assert.equal(
    s.numbers.filter(
      (n) =>
        n.verification === "Supplier listed" &&
        ["OEM_OE", "REPLACEMENT"].includes(n.type),
    ).length,
    47,
  );
  assert.equal(
    s.numbers.find((n) => n.partId === p.id && n.display === "80030AL")?.type,
    "CATALOGUE",
  );
  assert.equal(s.compatibility.filter((c) => c.partId === p.id).length, 20);
});
test("replacement references resolve and discontinued prices stay unquoted", () => {
  const s = mergeNengunCatalogue(seed());
  for (const n of s.numbers.filter(
    (n) => n.verification === "Supplier listed" && n.supersededBy,
  ))
    assert.ok(s.numbers.some((target) => target.id === n.supersededBy));
  assert.equal(
    s.parts.find((p) => p.sku === "MIT-8301A620")?.catalogueSource?.priceJpy,
    null,
  );
  assert.equal(
    s.parts.find((p) => p.sku === "MIT-8301A620")?.status,
    "Inactive",
  );
});
