import { createHash } from "node:crypto";
import { normalizeNumber } from "../../../domain/models";
import {
  VehicleMake,
  VehicleModel,
  VehicleVariant,
  Catalogue,
  Category,
  CatalogueDiagram,
  DiagramCallout,
  CataloguePart,
  ReferenceNumber,
  ReferenceFitment,
  CrossReference,
  VinLookupResult,
  Provenance,
} from "../../../catalogue/models";
import {
  ToyotaCatalog,
  ToyotaCatalogSummary,
  ToyotaFigure,
  ToyotaModel,
  ToyotaPart,
  ToyotaPartNumberHistory,
  ToyotaSection,
  ToyotaVinMatch,
} from "./types";
export const TOYOTA_EPC_SOURCE_ID = "toyota-epc";
const hashId = (...values: unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
function provenanceFor(
  sourceRecordId: string,
  sourceUrl: string,
  sourceCatalogue: string,
): Provenance {
  return {
    sourceProvider: TOYOTA_EPC_SOURCE_ID,
    sourceRecordId,
    sourceUrl,
    sourceCatalogue,
    retrievedAt: new Date().toISOString(),
    importBatchId: "live-lookup",
    verification: "SOURCE_VERIFIED",
    // Deliberately not "LICENSED_DATA" — see providerPolicy.ts: this
    // provider's redistributionAllowed is "UNKNOWN", not true.
    licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
  };
}
const htmlUrl = (path: string) =>
  `https://toyota-epc.aftermarketcatalog.com${path}`;
export function toyotaMakeId(): string {
  return hashId("toyota-epc-make", "toyota");
}
export function mapToyotaMake(): VehicleMake {
  return {
    id: toyotaMakeId(),
    name: "Toyota",
    provenance: provenanceFor("toyota", htmlUrl("/"), "toyota-epc"),
  };
}
export function mapToyotaModel(model: ToyotaModel): {
  make: VehicleMake;
  model: VehicleModel;
} {
  const make = mapToyotaMake();
  return {
    make,
    model: {
      // Deliberately the bare slug, not a hash: `ToyotaEpcProvider.browse()`
      // resolves `filters.model` straight into `getModel(region, slug)`, so
      // this id must equal that slug exactly for the merged vehicle picker's
      // <select value={model.id}> to round-trip correctly. Safe while the
      // app only ever uses one region (EU, hardcoded) — see the "single
      // region" note in SPARE_PARTS_CATALOG_ARCHITECTURE.md.
      id: model.slug,
      makeId: make.id,
      name: model.name,
      provenance: provenanceFor(
        `${model.region}/${model.slug}`,
        htmlUrl(`/catalog/${model.region}/${model.slug}`),
        "toyota-epc",
      ),
    },
  };
}
export function catalogVariantId(catalog: {
  region: string;
  catalog_code: string;
}): string {
  // "region/catalog_code", not a hash: ToyotaEpcProvider.browse() matches
  // filters.variant against exactly this string when resolving which
  // catalogue was picked — see the note on mapToyotaModel's id above.
  return `${catalog.region}/${catalog.catalog_code}`;
}
export function mapToyotaCatalogToVariant(
  catalog: ToyotaCatalog | ToyotaCatalogSummary,
  modelId: string,
): VehicleVariant {
  const [yearFrom, yearTo] = [
    parseYear(catalog.production.from),
    parseYear(catalog.production.to) || parseYear(catalog.production.from),
  ];
  return {
    id: catalogVariantId(catalog),
    modelId,
    chassis: catalog.chassis_codes.join(", "),
    generation: catalog.model_name.trim(),
    yearFrom,
    yearTo: catalog.production.current ? 0 : yearTo,
    engine: "",
    engineCode: "",
    transmission: "",
    drivetrain: "",
    market: catalog.region,
    bodyType: "",
    notes: `Toyota EPC catalogue ${catalog.catalog_code} (${catalog.dataset_code ?? "?"}).`,
    provenance: provenanceFor(
      `${catalog.region}/${catalog.catalog_code}`,
      htmlUrl(`/vehicle/${catalog.region}/${catalog.catalog_code}`),
      catalog.catalog_code,
    ),
  };
}
export function mapToyotaCatalogueRecord(
  catalog: ToyotaCatalogSummary,
  variantId: string,
): Catalogue {
  return {
    id: hashId("toyota-epc-catalogue", catalog.region, catalog.catalog_code),
    sourceId: TOYOTA_EPC_SOURCE_ID,
    variantId,
    name: `${catalog.model_family} — ${catalog.catalog_code} (${catalog.region})`,
    provenance: provenanceFor(
      catalog.catalog_code,
      htmlUrl(`/vehicle/${catalog.region}/${catalog.catalog_code}`),
      catalog.catalog_code,
    ),
  };
}
/**
 * A lightweight `CatalogueDiagram` built from a section's `primary_figure`
 * key alone (no figure fetch), so `browse()` can list "open this diagram"
 * entries for a category without one extra API call per section. Opening
 * it calls `getDiagram`, which fetches the real figure (hotspots, parts).
 */
export function mapToyotaSectionDiagramStub(
  section: {
    section_code: string;
    name: string;
    primary_figure: string | null;
  },
  region: string,
  catalogCode: string,
  catalogueId: string,
  variantId: string,
  categoryId: string,
): CatalogueDiagram | undefined {
  if (!section.primary_figure) return undefined;
  const provenance = provenanceFor(section.primary_figure, "", catalogCode);
  return {
    id: `${region}/${catalogCode}/${section.primary_figure}`,
    catalogueId,
    sourceId: TOYOTA_EPC_SOURCE_ID,
    variantId,
    categoryId,
    title: section.name,
    code: section.primary_figure,
    image: {
      id: hashId(
        "toyota-epc-image",
        region,
        catalogCode,
        section.primary_figure,
      ),
      url: "",
      rights: "EXTERNAL_REFERENCE",
      mime: "image/png",
      width: 0,
      height: 0,
      size: 0,
      attribution: `Source illustration: ${htmlUrl(`/vehicle/${region}/${catalogCode}`)} — Toyota EPC aggregator, not displayed pending redistribution permission.`,
      provenance,
    },
    revision: "1",
    notes: "Open to load the real hotspot rectangles and parts list.",
    provenance,
  };
}
export function mapToyotaSection(
  section: Pick<ToyotaSection, "section_code" | "name">,
  catalogueId: string,
): Category {
  return {
    // The bare section code, not a hash — see the id-format note on
    // mapToyotaModel above: ToyotaEpcProvider.browse() compares
    // filters.category against section.section_code directly, so this id
    // must equal that code exactly for the category <select> to round-trip.
    // Categories are only ever compared within one browse() response
    // (rebuilt fresh per catalogue), so reusing a code across unrelated
    // catalogues (e.g. "1104" in many different vehicles) is safe.
    id: section.section_code,
    catalogueId,
    name: section.name,
    provenance: provenanceFor(section.section_code, "", catalogueId),
  };
}
/**
 * Maps one `figures/{key}` response (image, hotspots, and every part line
 * on those hotspots, all in one call) into diagram + callout + part +
 * number records. `resolved: false` hotspots (standard fasteners with no
 * parts list behind them) still produce a `DiagramCallout` — with an
 * empty `partIds` — so the UI can show "no part behind this callout"
 * rather than nothing, matching what the source actually recorded.
 */
export function mapToyotaFigure(
  figure: ToyotaFigure,
  variantId: string,
  categoryId: string,
): {
  diagram: CatalogueDiagram;
  callouts: DiagramCallout[];
  parts: CataloguePart[];
  numbers: ReferenceNumber[];
  fitments: ReferenceFitment[];
} {
  const catalogueId = hashId(
    "toyota-epc-catalogue",
    figure.catalog.region,
    figure.catalog.catalog_code,
  );
  const diagramId = hashId(
    "toyota-epc-diagram",
    figure.catalog.region,
    figure.catalog.catalog_code,
    figure.figure_key,
  );
  const diagramProvenance = provenanceFor(
    figure.figure_key,
    htmlUrl(`/vehicle/${figure.catalog.region}/${figure.catalog.catalog_code}`),
    figure.catalog.catalog_code,
  );
  const diagram: CatalogueDiagram = {
    id: diagramId,
    catalogueId,
    sourceId: TOYOTA_EPC_SOURCE_ID,
    variantId,
    categoryId,
    title: figure.figure_key,
    code: figure.figure_key,
    image: {
      id: hashId("toyota-epc-image", diagramId),
      // EXTERNAL_REFERENCE never satisfies canDisplayImage(): imageStorageAllowed
      // is false for this provider (providerPolicy.ts), so the illustration is
      // never fetched, cached or shown — only its provenance is recorded.
      url: "",
      rights: "EXTERNAL_REFERENCE",
      mime: "image/png",
      width: 0,
      height: 0,
      size: figure.image.source_bytes,
      attribution: `Source illustration: ${htmlUrl(figure.image.url)} — Toyota EPC aggregator (aftermarketcatalog.com), not displayed pending redistribution permission.`,
      provenance: diagramProvenance,
    },
    revision: "1",
    notes:
      "Toyota EPC figure — hotspot rectangles are in the source image's native pixel space (see DiagramCallout.rect).",
    provenance: diagramProvenance,
  };
  const partsByPnc = new Map<string, ToyotaPart[]>();
  for (const part of figure.parts) {
    const list = partsByPnc.get(part.pnc) ?? [];
    list.push(part);
    partsByPnc.set(part.pnc, list);
  }
  const callouts: DiagramCallout[] = [];
  const parts: CataloguePart[] = [];
  const numbers: ReferenceNumber[] = [];
  const fitments: ReferenceFitment[] = [];
  figure.hotspots.forEach((hotspot, sequence) => {
    const partId = hashId(
      "toyota-epc-part",
      figure.catalog.region,
      hotspot.pnc,
    );
    const hotspotParts = partsByPnc.get(hotspot.pnc) ?? [];
    callouts.push({
      id: hashId("toyota-epc-callout", diagramId, hotspot.seq, hotspot.label),
      diagramId,
      display: hotspot.label,
      normalized: normalizeNumber(hotspot.label),
      partIds: hotspot.resolved ? [partId] : [],
      rect: { ...hotspot.rect },
      resolved: hotspot.resolved,
      keyType: hotspot.key_type,
      sequence,
      notes: hotspot.resolved
        ? "Diagram callout reference — not itself an OEM part number; see the linked part's numbers."
        : "Standard fastener/generic hotspot — the source catalogue lists no separate part for it.",
      provenance: provenanceFor(hotspot.label, "", figure.catalog.catalog_code),
    });
    if (!hotspot.resolved || parts.some((p) => p.id === partId)) return;
    parts.push({
      id: partId,
      manufacturer: "Toyota",
      description: hotspot.name,
      catalogueDescription: hotspot.name,
      categoryId,
      catalogueId,
      status: "Active",
      notes: `Part group (PNC) ${hotspot.pnc} — ${hotspotParts.length} part number(s) recorded across production changes.`,
      version: 1,
      provenance: provenanceFor(hotspot.pnc, "", figure.catalog.catalog_code),
    });
    for (const p of hotspotParts) {
      const numberProvenance = provenanceFor(
        String(p.part_id),
        htmlUrl(p.links.self ?? ""),
        figure.catalog.catalog_code,
      );
      numbers.push({
        // Keyed by the source's own row id (p.part_id), not just
        // part_number+suffix: the same number can legitimately recur
        // across multiple fitment-differentiated rows under one PNC (seen
        // live on a real cylinder-head PNC with 22 rows) — using only the
        // number would collide two distinct rows onto one React key.
        id: hashId("toyota-epc-number", partId, p.part_id),
        partId,
        original: p.part_number_display,
        normalized: normalizeNumber(p.part_number),
        type: "OEM_OE",
        manufacturer: "Toyota",
        market: p.region,
        primary: p.is_current,
        active: p.is_current,
        applicability: fitmentSummary(p),
        notes: p.has_remarks
          ? "Source catalogue records remarks against this part (not exposed by this API)."
          : "",
        provenance: numberProvenance,
      });
      fitments.push({
        id: hashId("toyota-epc-fitment", partId, p.part_id),
        partId,
        variantId,
        yearFrom: parseYear(p.valid.from),
        yearTo: parseYear(p.valid.to),
        engine:
          p.fitment.find((f) => f.attribute?.startsWith("ENGINE"))?.meaning ??
          "",
        engineCode:
          p.fitment.find((f) => f.attribute?.startsWith("ENGINE"))?.code ?? "",
        chassis: figure.catalog.catalog_code,
        transmission: "",
        market: p.region,
        position: "",
        notes: p.model_period ? `Model period ${p.model_period}.` : "",
        attributes: p.fitment.map((f) => ({
          code: f.code,
          meaning: f.meaning ?? undefined,
          attribute: f.attribute ?? undefined,
        })),
        provenance: numberProvenance,
      });
    }
  });
  return { diagram, callouts, parts, numbers, fitments };
}
function fitmentSummary(part: ToyotaPart): string | undefined {
  const from = part.valid.from,
    to = part.valid.to;
  if (!from && !to) return undefined;
  return `Production ${from ?? "?"}–${to ?? "current"}`;
}
function parseYear(value: string | null): number {
  const year = Number((value ?? "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 && year < 2100 ? year : 0;
}
/**
 * Maps a `part-numbers/{n}/history` response into `SUPERSEDES` cross
 * references. Only the `chain`/`superseded_by` edges become
 * supersessions; `substitutes` are mapped separately by the caller as
 * `ALTERNATIVE` (they are not the same relationship — see the real
 * fixture in tests/fixtures/toyota-epc/part-number-history.json, where a
 * part with no supersession still has three unrelated substitutes).
 * Returns edges only — the caller resolves them to actual `ReferenceNumber`
 * ids it already holds, since this function has no numbers to link to.
 */
export function mapToyotaSupersessionEdges(
  history: ToyotaPartNumberHistory,
  region: string,
): { from: string; to: string; effective: string | null }[] {
  const regional = history.by_region[region];
  if (!regional) return [];
  const seen = new Set<string>();
  const edges: { from: string; to: string; effective: string | null }[] = [];
  for (const edge of [...regional.chain, ...regional.superseded_by]) {
    const key = `${edge.old_part}>${edge.new_part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      from: edge.old_part,
      to: edge.new_part,
      effective: edge.effective,
    });
  }
  return edges;
}
export function mapToyotaVin(
  vin: string,
  matches: ToyotaVinMatch[],
): VinLookupResult {
  const seen = new Set<string>();
  const deduped: ToyotaVinMatch[] = [];
  for (const match of matches) {
    const key = `${match.region}/${match.catalog_code}/${match.production.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return {
    vin,
    supported: true,
    provider: TOYOTA_EPC_SOURCE_ID,
    matches: deduped.map((m) => ({
      catalogueId: hashId("toyota-epc-catalogue", m.region, m.catalog_code),
      vehicle: `${m.model_name} (${m.model_code})`,
      chassis: m.chassis,
      productionFrom: m.production.from ?? undefined,
      productionTo: m.production.to ?? undefined,
    })),
  };
}
export function mapToyotaCrossReference(
  edge: { from: string; to: string; effective: string | null },
  sourceNumberId: string,
  targetNumberId: string,
): CrossReference {
  return {
    id: hashId("toyota-epc-xref", sourceNumberId, targetNumberId),
    sourceNumberId,
    targetNumberId,
    type: "SUPERSEDED_BY",
    confidence: "Source-recorded supersession",
    notes: edge.effective ? `Effective ${edge.effective}.` : "",
    provenance: provenanceFor(`${edge.from}>${edge.to}`, "", "toyota-epc"),
  };
}
