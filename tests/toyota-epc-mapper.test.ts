import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mapToyotaMake,
  mapToyotaModel,
  mapToyotaCatalogToVariant,
  mapToyotaCatalogueRecord,
  mapToyotaSection,
  mapToyotaFigure,
  mapToyotaSupersessionEdges,
  mapToyotaVin,
  catalogVariantId,
} from "../src/integrations/catalogues/toyota-epc/mapper";
import {
  ToyotaModel,
  ToyotaCatalog,
  ToyotaSection,
  ToyotaFigure,
  ToyotaPartNumberHistory,
  ToyotaVinMatch,
} from "../src/integrations/catalogues/toyota-epc/types";
import { normalizeNumber } from "../src/domain/models";
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, "fixtures/toyota-epc", name), "utf8"))
    .data as T;
test("Toyota make/model mapping produces a stable, deterministic hierarchy", () => {
  const model = fixture<ToyotaModel>("model-corolla.json");
  const a = mapToyotaModel(model);
  const b = mapToyotaModel(model);
  assert.equal(a.make.name, "Toyota");
  assert.equal(a.model.name, "COROLLA");
  assert.equal(a.model.makeId, a.make.id);
  assert.equal(
    a.model.id,
    b.model.id,
    "mapping the same input twice must be idempotent",
  );
});
test("a catalog maps to a vehicle variant without inventing an engine/transmission", () => {
  const catalog = fixture<ToyotaCatalog>("catalog.json");
  const variant = mapToyotaCatalogToVariant(catalog, "model-id");
  assert.equal(variant.chassis, catalog.chassis_codes.join(", "));
  assert.equal(variant.market, "EU");
  // The catalog summary carries no engine/transmission field at all — the
  // mapper must leave these blank rather than guessing, per AGENTS.md's
  // "never invent" rule. Real per-part fitment (see mapToyotaFigure) is
  // where engine actually comes from.
  assert.equal(variant.engine, "");
  assert.equal(variant.transmission, "");
});
test("a section maps to a catalogue category using only its code and name", () => {
  const section = fixture<ToyotaSection>("section-1104.json");
  const category = mapToyotaSection(section, "catalogue-id");
  assert.equal(category.name, "CYLINDER HEAD");
  assert.equal(category.catalogueId, "catalogue-id");
});
test("a figure maps hotspots to callouts with pixel rects distinct from OEM numbers", () => {
  const figure = fixture<ToyotaFigure>("figure.json");
  const mapped = mapToyotaFigure(figure, "variant-id", "category-id");
  assert.ok(mapped.callouts.length > 0);
  const resolved = mapped.callouts.filter((c) => c.resolved);
  assert.ok(
    resolved.length > 0,
    "fixture should contain at least one resolved hotspot",
  );
  for (const callout of mapped.callouts) {
    assert.ok(callout.rect, "every Toyota callout carries a pixel rect");
    assert.equal(typeof callout.rect!.x1, "number");
    // The callout's own display/number is the diagram reference (a PNC
    // label like "11101"), never conflated with the OEM part_number.
    assert.notEqual(callout.display, undefined);
  }
  for (const part of mapped.parts) {
    const numbers = mapped.numbers.filter((n) => n.partId === part.id);
    for (const n of numbers) {
      assert.notEqual(
        n.original,
        mapped.callouts.find((c) => c.partIds.includes(part.id))?.display,
        "OEM number must never equal the diagram callout label",
      );
      assert.equal(n.type, "OEM_OE");
    }
  }
  // Diagram image is never exposed as a live URL — imageStorageAllowed is
  // false for this provider (providerPolicy.ts) until licensing is
  // resolved; canDisplayImage() must reject it.
  assert.equal(mapped.diagram.image.url, "");
  assert.equal(mapped.diagram.image.rights, "EXTERNAL_REFERENCE");
});
test("an unresolved hotspot (standard fastener) produces a callout with no linked part", () => {
  const figure = fixture<ToyotaFigure>("figure.json");
  const synthetic: ToyotaFigure = {
    ...figure,
    hotspots: [
      {
        ...figure.hotspots[0],
        resolved: false,
        pnc: "99999Z",
        label: "99999Z",
      },
    ],
  };
  const mapped = mapToyotaFigure(synthetic, "variant-id", "category-id");
  assert.equal(mapped.callouts.length, 1);
  assert.deepEqual(mapped.callouts[0].partIds, []);
  assert.equal(
    mapped.parts.length,
    0,
    "no part is fabricated for an unresolved hotspot",
  );
});
test("two source rows sharing the same part_number+suffix under one PNC still get distinct number ids — caught live on a real 22-row PNC", () => {
  const figure = fixture<ToyotaFigure>("figure.json");
  const pnc = figure.hotspots[0].pnc;
  const base = figure.parts.find((p) => p.pnc === pnc)!;
  const synthetic: ToyotaFigure = {
    ...figure,
    parts: [
      base,
      {
        ...base,
        part_id: base.part_id + 1,
        unverified: { ...base.unverified, dest_code: "02" },
      },
    ],
  };
  const mapped = mapToyotaFigure(synthetic, "variant-id", "category-id");
  const ids = mapped.numbers
    .filter((n) => n.partId === mapped.parts[0]?.id)
    .map((n) => n.id);
  assert.equal(ids.length, 2);
  assert.notEqual(
    ids[0],
    ids[1],
    "React would drop/duplicate one row with a colliding key",
  );
});
test("part-number history maps only chain/superseded_by edges to supersessions, not substitutes", () => {
  const history = fixture<ToyotaPartNumberHistory>("part-number-history.json");
  const edges = mapToyotaSupersessionEdges(history, "EU");
  assert.ok(edges.length > 0);
  assert.equal(edges[0].from, "1111515100");
  assert.equal(edges[0].to, "11115F3010");
  const regionKeys = Object.keys(history.by_region);
  assert.ok(regionKeys.includes("EU"));
});
test("supersession lookup for an unlisted region returns no edges rather than guessing", () => {
  const history = fixture<ToyotaPartNumberHistory>("part-number-history.json");
  assert.deepEqual(mapToyotaSupersessionEdges(history, "ZZ"), []);
});
test("VIN mapping deduplicates the source's own repeated match rows", () => {
  const matches = fixture<ToyotaVinMatch[]>("vin.json");
  const raw = matches.length;
  const result = mapToyotaVin("JTDKB20U903100000", matches);
  assert.equal(result.supported, true);
  assert.ok(
    result.matches.length <= raw,
    "deduplication must never increase the match count",
  );
  assert.ok(result.matches.length >= 1);
  assert.equal(result.matches[0].chassis, "NHW20");
});
test("Toyota part-number formats normalize to the same key as OEM number search elsewhere", () => {
  assert.equal(normalizeNumber("90915-20004"), normalizeNumber("9091520004"));
  assert.equal(normalizeNumber("90915-20004"), normalizeNumber("90915 20004"));
  // Distinct real numbers must not collapse into each other.
  assert.notEqual(
    normalizeNumber("90915-20004"),
    normalizeNumber("90915-20005"),
  );
});
test("make/model/variant/catalogue mapping matches the CatalogueDiagram -> DiagramCallout -> CataloguePart -> PartNumber[] chain used elsewhere", () => {
  const model = fixture<ToyotaModel>("model-corolla.json");
  const catalog = fixture<ToyotaCatalog>("catalog.json");
  const { make, model: mappedModel } = mapToyotaModel(model);
  const variant = mapToyotaCatalogToVariant(catalog, mappedModel.id);
  const catalogueRecord = mapToyotaCatalogueRecord(catalog, variant.id);
  const figure = fixture<ToyotaFigure>("figure.json");
  const section = fixture<ToyotaSection>("section-1104.json");
  const category = mapToyotaSection(section, catalogueRecord.id);
  const mapped = mapToyotaFigure(figure, variant.id, category.id);
  assert.equal(make.name, "Toyota");
  assert.equal(mapped.diagram.categoryId, category.id);
  assert.equal(mapped.diagram.variantId, variant.id);
  assert.ok(mapped.callouts.every((c) => c.diagramId === mapped.diagram.id));
});
test("VehicleModel.id and VehicleVariant.id use the exact strings ToyotaEpcProvider.browse() round-trips through filters.model/filters.variant", () => {
  // These ids are not arbitrary — a merged vehicle picker's <select
  // value={model.id}> feeds straight back into filters.model, and
  // ToyotaEpcProvider.browse() resolves that directly into
  // getModel(region, filters.model) and matches filters.variant against
  // `${region}/${catalog_code}`. If either id format drifts from what
  // browse() expects, picking a Toyota model/variant in the UI silently
  // resolves nothing.
  const model = fixture<ToyotaModel>("model-corolla.json");
  const { model: mappedModel } = mapToyotaModel(model);
  assert.equal(mappedModel.id, model.slug);
  const catalog = fixture<ToyotaCatalog>("catalog.json");
  assert.equal(
    catalogVariantId(catalog),
    `${catalog.region}/${catalog.catalog_code}`,
  );
  const section = fixture<ToyotaSection>("section-1104.json");
  const category = mapToyotaSection(section, "catalogue-id");
  assert.equal(
    category.id,
    section.section_code,
    "filters.category must round-trip through Category.id the same way",
  );
});
