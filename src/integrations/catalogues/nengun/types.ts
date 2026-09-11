/**
 * Raw shapes as observed/described for nengun.com's OEM parts catalogue.
 * Contained entirely to this integration — nothing outside this folder
 * should import or depend on these types. A parser/transport translates
 * them into the generic catalogue model (see mapper.ts).
 *
 * Field presence reflects what is actually described in the source review
 * (docs/catalogues/NENGUN_SOURCE_REVIEW.md) and the historical import
 * record (docs/NENGUN_IMPORT.md), not an assumption that every field
 * exists on every page. Optional fields are genuinely optional.
 */
export interface NengunVehicleContext {
  manufacturer: string;
  model: string;
  generation?: string;
  chassisCode?: string;
  engine?: string;
  engineCode?: string;
  grade?: string;
  productionFrom?: string;
  productionTo?: string;
  market?: string;
}
export interface NengunDiagramReference {
  diagramGroup?: string;
  diagramCode: string;
  diagramTitle: string;
  /** URL to the source's diagram artwork. Never fetched/copied automatically — see mapper.ts image handling. */
  diagramImageUrl?: string;
  category?: string;
  subcategory?: string;
}
/**
 * One row of a Nengun OEM parts table. `calloutNumber` is the diagram
 * reference printed next to the exploded-view drawing (e.g. "74004"). It
 * is NOT automatically the same as `oemPartNumber` — the two are kept as
 * distinct fields end to end. A row without a distinct OEM number is still
 * valid; the mapper must not synthesize one from the callout.
 */
export interface NengunPartRow {
  calloutNumber: string;
  oemPartNumber?: string;
  description?: string;
  quantity?: number;
  applicability?: string;
  color?: string;
  position?: string;
  supersededByCalloutNumber?: string;
  supersededByOemNumber?: string;
  priceStatus?: "quoted" | "unquoted" | "discontinued" | "replaced";
  priceJpy?: number;
  sourceRecordId?: string;
}
export interface NengunDiagramPage {
  vehicle: NengunVehicleContext;
  diagram: NengunDiagramReference;
  rows: NengunPartRow[];
  sourceUrl: string;
  retrievedAt: string;
}
