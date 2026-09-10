import test from "node:test";
import assert from "node:assert/strict";
import { ReferenceRepository } from "../src/catalogue/repository";
import { referenceSeed } from "../src/catalogue/seed";
import {
  parseCsv,
  mapRecord,
  providerExtensions,
  safeSourceUrl,
  withProviderRetry,
} from "../src/catalogue/providers";
import {
  csvFields,
  ColumnMapping,
  canDisplayImage,
} from "../src/catalogue/models";
import { createDemoAdapter } from "../src/adapters/demo";
import { validateImageMetadata } from "../src/catalogue/assets";
const mapping: ColumnMapping = Object.fromEntries(csvFields.map((k) => [k, k]));
const header = csvFields.join(",");
const csv = (
  num = "DEMO-TEST-1",
  description = "Sample component",
  recordId = "record-1",
) =>
  header +
  "\n" +
  [
    recordId,
    "Demo",
    num,
    "OEM_OE",
    description,
    "Mitsubishi",
    "Lancer Evolution IX",
    "CT9A",
    "2.0",
    "4G63",
    "2005",
    "2007",
    "Lighting",
    "Example",
    "",
    "Example",
    "Demo",
  ].join(",");
test("reference/company separation and explicit adoption retain source and do not create stock", () => {
  const reference = new ReferenceRepository();
  const company = createDemoAdapter();
  const before = company.snapshot().parts.length;
  reference.stage(csv(), mapping, "Owner", true);
  assert.equal(company.snapshot().parts.length, before);
  company.catalogue.adopt(reference.detail("reference-1"), {
    sku: "OUR-LENS",
    supplierId: "contact-1",
    warehouseId: "wh-1",
    cost: 20,
    price: 40,
    reorder: 5,
    currency: "AED",
  });
  const product = company.snapshot().parts.find((p) => p.sku === "OUR-LENS")!;
  assert.equal(product.preferredCataloguePartId, "reference-1");
  assert.equal(product.referenceProvenance?.sourceProvider, "original-demo");
  assert.equal(
    company.inventory
      .list()
      .filter((x) => x.partId === product.id)
      .reduce((n, x) => n + x.onHand, 0),
    0,
  );
  assert.equal(company.catalogue.search("DEMO OE HL 1")[0].id, product.id);
  assert.throws(() =>
    company.catalogue.adopt(reference.detail("reference-1"), {
      sku: "DUP",
      supplierId: "contact-1",
      warehouseId: "wh-1",
      cost: 20,
      price: 40,
      reorder: 5,
      currency: "AED",
    }),
  );
});
test("CSV parses escaped quotes and quoted newlines and maps different headers", () => {
  const input =
    'brand,num,desc,make,model,start,end\r\nDemo,ABC-1,"A ""quoted""\ncomponent",Mitsubishi,Evo,2005,2007';
  const parsed = parseCsv(input);
  assert.equal(parsed.rows[0][2], 'A "quoted"\ncomponent');
  const mapped = mapRecord(parsed.headers, parsed.rows[0], {
    manufacturer: "brand",
    part_number: "num",
    description: "desc",
    vehicle_make: "make",
    vehicle_model: "model",
    year_from: "start",
    year_to: "end",
  });
  assert.equal(mapped.errors.length, 0);
  assert.equal(mapped.record.number, "ABC-1");
  assert.throws(() => parseCsv("a,a\n1,2"));
  assert.throws(() => parseCsv('a\n"broken'));
});
test("stage review publish is idempotent and source updates never touch company fields", () => {
  const r = new ReferenceRepository();
  const first = r.stage(csv(), mapping, "Owner", true);
  assert.equal(r.search("DEMO-TEST-1").total, 0);
  r.publish(first.batch.id, "Owner");
  assert.equal(r.search("DEMO TEST 1").total, 1);
  const id = r.search("DEMO-TEST-1").items[0].part.id;
  const company = createDemoAdapter();
  company.catalogue.adopt(r.detail(id), {
    sku: "LOCAL-1",
    supplierId: "contact-1",
    warehouseId: "wh-1",
    cost: 99,
    price: 150,
    reorder: 8,
    currency: "AED",
  });
  const original = JSON.stringify(company.snapshot());
  r.publish(first.batch.id, "Owner");
  assert.equal(r.search("DEMO-TEST-1").total, 1);
  const update = r.stage(
    csv("DEMO-TEST-1", "Updated source description"),
    mapping,
    "Owner",
    true,
  );
  assert.equal(update.records.items[0].duplicate, "EXISTING");
  r.publish(update.batch.id, "Owner");
  assert.equal(r.detail(id).part.description, "Updated source description");
  assert.equal(JSON.stringify(company.snapshot()), original);
  assert.equal(r.detail(id).part.provenance.importBatchId, update.batch.id);
});
test("multiple numbers share a source component without deduplication by description", () => {
  const r = new ReferenceRepository();
  const text = csv() + "\n" + csv("DEMO-SECOND-2").split("\n")[1];
  const b = r.stage(text, mapping, "Owner", true);
  r.publish(b.batch.id, "Owner");
  const p = r.search("DEMO-TEST-1").items[0];
  assert.equal(p.numbers.length, 2);
  assert.equal(r.search("DEMO-SECOND-2").items[0].part.id, p.part.id);
  const different = r.stage(
    csv("DEMO-THIRD", "Sample component", "record-2"),
    mapping,
    "Owner",
    true,
  );
  r.publish(different.batch.id, "Owner");
  assert.equal(r.search("Sample component").total, 2);
});
test("invalid values, formula fields and unsafe source URLs are rejected", () => {
  const r = new ReferenceRepository();
  const b = r.stage(csv("=1+1"), mapping, "Owner", true);
  assert.ok(b.records.items[0].errors.length);
  assert.throws(() => r.publish(b.batch.id, "Owner"));
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://127.0.0.1/a",
    "https://user:pass@example.com",
    "https://localhost",
    "https://10.1.2.3",
  ])
    assert.equal(safeSourceUrl(url), false);
  assert.equal(safeSourceUrl("https://supplier.example.com/catalogue"), true);
  assert.throws(() => parseCsv("a".repeat(2_000_001)));
  assert.throws(() => parseCsv("a\n" + Array(1002).fill("1").join("\n")));
});
test("duplicates, cancelled batches and retries are explicit", () => {
  const r = new ReferenceRepository();
  const text = csv() + "\n" + csv().split("\n")[1];
  const b = r.stage(text, mapping, "Administrator", true);
  assert.equal(b.batch.duplicates, 1);
  r.publish(b.batch.id, "Administrator");
  assert.equal(r.search("DEMO-TEST-1").total, 1);
  const malformed = r.stage('a\n"bad', {}, "Owner", true);
  assert.equal(malformed.batch.status, "FAILED");
  assert.equal(r.retry(malformed.batch.id, "Owner").batch.attempts, 2);
  r.cancel(malformed.batch.id, "Owner");
  assert.throws(() => r.publish(malformed.batch.id, "Owner"));
});
test("stale staging cannot overwrite a subsequently published update", () => {
  const r = new ReferenceRepository();
  const one = r.stage(csv(), mapping, "Owner", true);
  const two = r.stage(
    csv("DEMO-TEST-1", "Other description"),
    mapping,
    "Owner",
    true,
  );
  r.publish(one.batch.id, "Owner");
  assert.throws(
    () => r.publish(two.batch.id, "Owner"),
    /changed since staging/,
  );
  r.retry(two.batch.id, "Owner");
  r.publish(two.batch.id, "Owner");
});
test("image rights suppress URLs without breaking diagrams and metadata validation rejects malformed assets", () => {
  const r = new ReferenceRepository();
  r.imageRights(
    "image-demo-headlamp",
    "LICENSE_UNKNOWN",
    "Rights under review",
    "Owner",
  );
  const diagram = r.diagram("demo-headlamp");
  assert.equal(canDisplayImage(diagram.diagram.image), false);
  assert.equal(diagram.diagram.image.url, "");
  assert.equal(diagram.callouts.length, 3);
  assert.throws(() =>
    validateImageMetadata({
      mime: "image/svg+xml",
      size: 200,
      width: 100,
      height: 100,
      rights: "COMPANY_OWNED",
    }),
  );
  assert.throws(() =>
    validateImageMetadata({
      mime: "image/png",
      size: 200,
      width: 10000,
      height: 100,
      rights: "COMPANY_OWNED",
    }),
  );
});
test("permission boundaries protect staging publishing and rights commands", () => {
  const r = new ReferenceRepository();
  assert.throws(
    () => r.stage(csv(), mapping, "Sales", true),
    /Permission denied/,
  );
  assert.throws(() => r.overview("Storekeeper"), /Permission denied/);
  assert.throws(() =>
    r.imageRights(
      "image-demo-headlamp",
      "COMPANY_OWNED",
      "Forged permission",
      "Sales",
    ),
  );
  assert.throws(() => r.stage(csv(), mapping, "Owner", false));
  assert.equal(r.search("DEMO-OE-HL-1").total, 1);
});
test("explicit cross references support reverse navigation and reject cycles", () => {
  const r = new ReferenceRepository();
  r.addCrossReference(
    "ref-oe-1",
    "ref-alt-1",
    "SUPERSEDED_BY",
    "Prior number",
    "Owner",
  );
  assert.equal(r.detail("reference-1").crossReferences.length, 2);
  assert.throws(
    () =>
      r.addCrossReference(
        "ref-alt-1",
        "ref-oe-1",
        "SUPERSEDED_BY",
        "Cycle",
        "Owner",
      ),
    /Circular/,
  );
});
test("pagination bounds responses and vehicle filters cannot infer fitment by numbers", () => {
  const state = referenceSeed();
  for (let i = 0; i < 100; i++)
    state.parts.push({ ...state.parts[0], id: "extra-" + i });
  const r = new ReferenceRepository(state);
  assert.equal(r.search("", 1, 500).items.length, 50);
  assert.equal(r.search("", 2, 20).items.length, 20);
  assert.equal(r.search("", 1, 20, "variant-ct9a").total, 3);
  assert.equal(r.search("", 1, 20, "", "", "1990").total, 0);
});
test("disabled feeds fail closed and permitted transport retries are bounded", async () => {
  await assert.rejects(() => providerExtensions.nengun.read(""), /disabled/);
  let calls = 0;
  const delays: number[] = [];
  const result = await withProviderRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("temporary");
      return "ok";
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(result, "ok");
  assert.deepEqual(delays, [250, 500]);
});

test("in-batch conflicting identities require explicit exclusion", () => {
  const r = new ReferenceRepository();
  const text =
    csv() +
    "\n" +
    csv("DEMO-TEST-2", "Contradicting description").split("\n")[1];
  const b = r.stage(text, mapping, "Owner", true);
  assert.equal(b.records.items[0].duplicate, "CONFLICT");
  assert.equal(b.records.items[1].duplicate, "CONFLICT");
  assert.throws(() => r.publish(b.batch.id, "Owner"));
});
