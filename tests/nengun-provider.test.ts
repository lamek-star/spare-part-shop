import test from "node:test";
import assert from "node:assert/strict";
import {
  mapNengunDiagramPage,
  NENGUN_SOURCE_ID,
} from "../src/integrations/catalogues/nengun/mapper";
import { NengunProvider } from "../src/integrations/catalogues/nengun/provider";
import { nengunImportMode } from "../src/integrations/catalogues/nengun/config";
import { NengunDiagramPage } from "../src/integrations/catalogues/nengun/types";
import { canDisplayImage } from "../src/catalogue/models";
/**
 * Synthetic fixture shaped like the structure described for nengun.com's
 * OEM catalogue (manufacturer -> vehicle -> diagram -> callout rows).
 * Values are invented for testing, not copied from any live page.
 */
const fixture: NengunDiagramPage = {
  vehicle: {
    manufacturer: "Test Motors",
    model: "Example GT",
    generation: "IX (fixture)",
    chassisCode: "TM9A",
    engine: "2.0 turbo (fixture)",
    engineCode: "4G00",
    grade: "GSR",
    productionFrom: "2005-01",
    productionTo: "2007-12",
    market: "JDM",
  },
  diagram: {
    diagramGroup: "Body electrical",
    diagramCode: "80030AL",
    diagramTitle: "Headlamp assembly",
    diagramImageUrl: "https://example-source.test/diagrams/80030al.png",
    category: "Electrical",
    subcategory: "Lighting",
  },
  rows: [
    {
      calloutNumber: "74004",
      oemPartNumber: "MB123456",
      description: "Headlamp unit, right",
      quantity: 1,
      applicability: "GSR grade only",
      position: "Front right",
      priceStatus: "quoted",
      priceJpy: 45000,
      sourceRecordId: "row-74004",
    },
    {
      calloutNumber: "74018B",
      oemPartNumber: "MB123457",
      description: "Headlamp bracket",
      quantity: 2,
      priceStatus: "discontinued",
      supersededByOemNumber: "MB999999",
      sourceRecordId: "row-74018b",
    },
    {
      // No distinct OEM number on this row — must not be invented.
      calloutNumber: "74182H",
      description: "Mounting clip (reference only)",
      quantity: 4,
      sourceRecordId: "row-74182h",
    },
  ],
  sourceUrl: "https://example-source.test/oem/parts/000000/fixture",
  retrievedAt: "2026-09-12T00:00:00.000Z",
};
test("Nengun mapper produces vehicle hierarchy from a diagram page", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  assert.equal(mapped.makes.length, 1);
  assert.equal(mapped.makes[0].name, "Test Motors");
  assert.equal(mapped.models[0].name, "Example GT");
  assert.equal(mapped.models[0].makeId, mapped.makes[0].id);
  assert.equal(mapped.variants[0].modelId, mapped.models[0].id);
  assert.equal(mapped.variants[0].chassis, "TM9A");
  assert.equal(mapped.variants[0].yearFrom, 2005);
  assert.equal(mapped.variants[0].yearTo, 2007);
  assert.equal(mapped.variants[0].grade, "GSR");
  assert.equal(mapped.variants[0].bodyType, "");
});
test("Nengun mapper produces diagram metadata without copying source artwork", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  const diagram = mapped.diagrams[0];
  assert.equal(diagram.code, "80030AL");
  assert.equal(diagram.title, "Headlamp assembly");
  assert.equal(diagram.image.url, "");
  assert.equal(diagram.image.rights, "EXTERNAL_REFERENCE");
  assert.equal(canDisplayImage(diagram.image), false);
  assert.match(diagram.image.attribution, /example-source\.test/);
});
test("callout numbers are parsed as diagram references, distinct from OEM numbers", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  assert.equal(mapped.callouts.length, 3);
  const c1 = mapped.callouts.find((c) => c.display === "74004")!;
  assert.equal(c1.quantity, 1);
  assert.equal(c1.normalized, "74004");
  const part1 = mapped.parts.find((p) => p.id === c1.partIds[0])!;
  assert.equal(part1.position, "Front right");
  const numbers1 = mapped.numbers.filter((n) => n.partId === part1.id);
  assert.equal(numbers1.length, 1);
  assert.equal(numbers1[0].original, "MB123456");
  assert.equal(numbers1[0].type, "OEM_OE");
  // The callout display value never equals the OEM number for this row —
  // they are genuinely different identifiers, not aliases of one field.
  assert.notEqual(c1.display, numbers1[0].original);
});
test("a callout row with no distinct OEM number produces no fabricated number", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  const c3 = mapped.callouts.find((c) => c.display === "74182H")!;
  const part3 = mapped.parts.find((p) => p.id === c3.partIds[0])!;
  const numbers3 = mapped.numbers.filter((n) => n.partId === part3.id);
  assert.equal(numbers3.length, 0);
  assert.equal(part3.description, "Mounting clip (reference only)");
});
test("supersession/replacement references are preserved as REPLACEMENT numbers", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  const c2 = mapped.callouts.find((c) => c.display === "74018B")!;
  const part2 = mapped.parts.find((p) => p.id === c2.partIds[0])!;
  const numbers2 = mapped.numbers.filter((n) => n.partId === part2.id);
  const replacement = numbers2.find((n) => n.type === "REPLACEMENT");
  assert.equal(replacement?.original, "MB999999");
  assert.equal(part2.status, "Inactive");
});
test("every mapped record preserves Nengun provenance", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  for (const group of [
    mapped.makes,
    mapped.models,
    mapped.variants,
    mapped.catalogues,
    mapped.categories,
    mapped.diagrams,
    mapped.callouts,
    mapped.parts,
    mapped.numbers,
    mapped.fitments,
  ])
    for (const record of group as {
      provenance: { sourceProvider: string };
    }[]) {
      assert.equal(record.provenance.sourceProvider, NENGUN_SOURCE_ID);
    }
  assert.equal(mapped.parts[0].provenance.sourceUrl, fixture.sourceUrl);
  assert.equal(mapped.parts[0].provenance.verification, "UNVERIFIED");
  assert.equal(mapped.parts[0].provenance.licenseStatus, "PERMISSION_REQUIRED");
});
test("mapping the same page twice produces stable identifiers (idempotent, duplicate-safe)", () => {
  const first = mapNengunDiagramPage(fixture, "batch-1");
  const second = mapNengunDiagramPage(fixture, "batch-2");
  assert.equal(first.parts[0].id, second.parts[0].id);
  assert.equal(first.variants[0].id, second.variants[0].id);
  assert.equal(first.callouts[0].id, second.callouts[0].id);
});
test("catalogue parts carry no commercial fields, keeping reference separate from company data", () => {
  const mapped = mapNengunDiagramPage(fixture, "batch-1");
  for (const part of mapped.parts) {
    assert.equal("cost" in part, false);
    assert.equal("price" in part, false);
    assert.equal("sku" in part, false);
    assert.equal("images" in part, false);
  }
});
test("the Nengun provider is disabled in reference_only mode", async () => {
  delete process.env.NENGUN_IMPORT_MODE;
  assert.equal(nengunImportMode(), "reference_only");
  const provider = new NengunProvider();
  await assert.rejects(
    () => provider.searchParts("74004", 1),
    /reference_only/,
  );
  await assert.rejects(() => provider.getPart("any"), /reference_only/);
  await assert.rejects(() => provider.browse({}), /reference_only/);
  await assert.rejects(() => provider.getDiagram("any"), /reference_only/);
});
test("the Nengun provider still refuses when licensed_import is set without a transport", async () => {
  process.env.NENGUN_IMPORT_MODE = "licensed_import";
  try {
    assert.equal(nengunImportMode(), "licensed_import");
    const provider = new NengunProvider();
    await assert.rejects(
      () => provider.getDiagram("any"),
      /no authorized transport/,
    );
  } finally {
    delete process.env.NENGUN_IMPORT_MODE;
  }
});
