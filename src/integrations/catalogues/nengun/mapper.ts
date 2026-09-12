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
  Provenance,
} from "../../../catalogue/models";
import { NengunDiagramPage } from "./types";
export const NENGUN_SOURCE_ID = "nengun";
const hashId = (...values: unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
export interface MappedNengunDiagram {
  makes: VehicleMake[];
  models: VehicleModel[];
  variants: VehicleVariant[];
  catalogues: Catalogue[];
  categories: Category[];
  diagrams: CatalogueDiagram[];
  callouts: DiagramCallout[];
  parts: CataloguePart[];
  numbers: ReferenceNumber[];
  fitments: ReferenceFitment[];
}
/**
 * Translates one already-fetched, already-permitted Nengun diagram page
 * into the application's generic reference-catalogue model. Pure function:
 * no network access, no filesystem access. Callout numbers and OEM part
 * numbers are mapped to separate fields throughout — a row with no
 * distinct OEM number produces a DiagramCallout with an empty `numbers`
 * array rather than a fabricated one.
 */
export function mapNengunDiagramPage(
  page: NengunDiagramPage,
  importBatchId: string,
): MappedNengunDiagram {
  const provenance = (sourceRecordId: string): Provenance => ({
    sourceProvider: NENGUN_SOURCE_ID,
    sourceRecordId,
    sourceUrl: page.sourceUrl,
    sourceCatalogue: page.diagram.diagramCode,
    retrievedAt: page.retrievedAt,
    importBatchId,
    verification: "UNVERIFIED",
    licenseStatus: "PERMISSION_REQUIRED",
  });
  const makeId = hashId("nengun-make", page.vehicle.manufacturer);
  const modelId = hashId("nengun-model", makeId, page.vehicle.model);
  const variantId = hashId(
    "nengun-variant",
    modelId,
    page.vehicle.chassisCode ?? "",
    page.vehicle.generation ?? "",
    page.vehicle.engineCode ?? "",
    page.vehicle.grade ?? "",
    page.vehicle.productionFrom ?? "",
    page.vehicle.productionTo ?? "",
    page.vehicle.market ?? "",
  );
  const catalogueId = hashId("nengun-catalogue", NENGUN_SOURCE_ID, variantId);
  const categoryId = hashId(
    "nengun-category",
    catalogueId,
    page.diagram.category ?? "",
    page.diagram.subcategory ?? "",
  );
  const diagramId = hashId(
    "nengun-diagram",
    catalogueId,
    page.diagram.diagramCode,
  );
  const rowProvenance = provenance(diagramId);
  const image = {
    id: hashId("nengun-image", diagramId),
    // EXTERNAL_REFERENCE never satisfies canDisplayImage(), so the URL is
    // withheld at creation time rather than relying on a caller to check
    // rights before rendering — no live hotlink to source artwork ships.
    url: "",
    rights: "EXTERNAL_REFERENCE" as const,
    mime: "",
    width: 0,
    height: 0,
    size: 0,
    attribution: page.diagram.diagramImageUrl
      ? `Source diagram: ${page.diagram.diagramImageUrl} (external reference only, not displayed without confirmed rights).`
      : "No source diagram image reference supplied.",
    provenance: rowProvenance,
  };
  const parts: CataloguePart[] = [];
  const numbers: ReferenceNumber[] = [];
  const callouts: DiagramCallout[] = [];
  const fitments: ReferenceFitment[] = [];
  page.rows.forEach((row, sequence) => {
    const recordId = row.sourceRecordId || `${diagramId}-${row.calloutNumber}`;
    const partId = hashId("nengun-part", diagramId, row.calloutNumber);
    const rp = provenance(recordId);
    parts.push({
      id: partId,
      manufacturer: page.vehicle.manufacturer,
      description: row.description ?? "",
      catalogueDescription: row.description ?? "",
      categoryId,
      catalogueId,
      status: row.priceStatus === "discontinued" ? "Inactive" : "Active",
      position: row.position,
      notes:
        row.applicability ??
        "Reference-only Nengun catalogue row; not independently verified.",
      version: 1,
      provenance: rp,
    });
    callouts.push({
      id: hashId("nengun-callout", diagramId, row.calloutNumber),
      diagramId,
      display: row.calloutNumber,
      normalized: normalizeNumber(row.calloutNumber),
      partIds: [partId],
      quantity: row.quantity,
      sequence,
      notes: "Diagram callout reference — not itself an orderable OEM number.",
      provenance: rp,
    });
    if (row.oemPartNumber)
      numbers.push({
        id: hashId("nengun-number", partId, "OEM_OE", row.oemPartNumber),
        partId,
        original: row.oemPartNumber,
        normalized: normalizeNumber(row.oemPartNumber),
        type: "OEM_OE",
        manufacturer: page.vehicle.manufacturer,
        market: page.vehicle.market ?? "",
        primary: true,
        active: row.priceStatus !== "discontinued",
        notes: "",
        provenance: rp,
      });
    if (row.supersededByOemNumber)
      numbers.push({
        id: hashId(
          "nengun-number",
          partId,
          "REPLACEMENT",
          row.supersededByOemNumber,
        ),
        partId,
        original: row.supersededByOemNumber,
        normalized: normalizeNumber(row.supersededByOemNumber),
        type: "REPLACEMENT",
        manufacturer: page.vehicle.manufacturer,
        market: page.vehicle.market ?? "",
        primary: false,
        active: true,
        notes: "Source-listed replacement reference.",
        provenance: rp,
      });
    fitments.push({
      id: hashId("nengun-fitment", partId, variantId),
      partId,
      variantId,
      yearFrom: parseYear(page.vehicle.productionFrom),
      yearTo: parseYear(page.vehicle.productionTo),
      engine: page.vehicle.engine ?? "",
      engineCode: page.vehicle.engineCode ?? "",
      chassis: page.vehicle.chassisCode ?? "",
      transmission: "",
      market: page.vehicle.market ?? "",
      position: row.position ?? "",
      notes: row.applicability ?? "",
      provenance: rp,
    });
  });
  return {
    makes: [
      {
        id: makeId,
        name: page.vehicle.manufacturer,
        provenance: rowProvenance,
      },
    ],
    models: [
      {
        id: modelId,
        makeId,
        name: page.vehicle.model,
        provenance: rowProvenance,
      },
    ],
    variants: [
      {
        id: variantId,
        modelId,
        chassis: page.vehicle.chassisCode ?? "",
        generation: page.vehicle.generation ?? "",
        yearFrom: parseYear(page.vehicle.productionFrom),
        yearTo: parseYear(page.vehicle.productionTo),
        engine: page.vehicle.engine ?? "",
        engineCode: page.vehicle.engineCode ?? "",
        transmission: "",
        drivetrain: "",
        market: page.vehicle.market ?? "",
        bodyType: "",
        grade: page.vehicle.grade,
        notes: "Source-listed vehicle context; not independently verified.",
        provenance: rowProvenance,
      },
    ],
    catalogues: [
      {
        id: catalogueId,
        sourceId: NENGUN_SOURCE_ID,
        variantId,
        name: `${page.vehicle.manufacturer} ${page.vehicle.model} reference catalogue`,
        provenance: rowProvenance,
      },
    ],
    categories: [
      {
        id: categoryId,
        catalogueId,
        name:
          page.diagram.subcategory || page.diagram.category || "Uncategorized",
        provenance: rowProvenance,
      },
    ],
    diagrams: [
      {
        id: diagramId,
        catalogueId,
        sourceId: NENGUN_SOURCE_ID,
        variantId,
        categoryId,
        title: page.diagram.diagramTitle,
        code: page.diagram.diagramCode,
        image,
        revision: "1",
        notes: "Diagram metadata only; source artwork is not reproduced here.",
        provenance: rowProvenance,
      },
    ],
    callouts,
    parts,
    numbers,
    fitments,
  };
}
function parseYear(value?: string): number {
  const year = Number((value ?? "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 && year < 2100 ? year : 0;
}
