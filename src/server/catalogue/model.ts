/**
 * Reference-catalogue types. Type-only, safe to import from the browser.
 * Reference data (what the manufacturer says a part is and fits) is kept
 * strictly apart from the shop's own products: nothing here has a shop
 * price, cost, supplier or stock quantity.
 */
export type StatusClass = "ACTIVE" | "ENDED" | "SUPERSEDED" | "UNKNOWN";
export type Verification = "UNVERIFIED" | "SOURCE_VERIFIED" | "MANUALLY_VERIFIED" | "DISPUTED";
export type ImageRights =
  | "EXTERNAL_REFERENCE"
  | "LICENSE_UNKNOWN"
  | "LICENSED_FOR_INTERNAL_USE"
  | "LICENSED_FOR_DISPLAY"
  | "COMPANY_OWNED"
  | "MANUFACTURER_AUTHORIZED"
  | "DO_NOT_REPUBLISH";
export const imageRightsValues: ImageRights[] = [
  "EXTERNAL_REFERENCE",
  "LICENSE_UNKNOWN",
  "LICENSED_FOR_INTERNAL_USE",
  "LICENSED_FOR_DISPLAY",
  "COMPANY_OWNED",
  "MANUFACTURER_AUTHORIZED",
  "DO_NOT_REPUBLISH",
];
/** Rights under which this app will show a locally stored image. */
export const displayableRights: ImageRights[] = [
  "LICENSED_FOR_INTERNAL_USE",
  "LICENSED_FOR_DISPLAY",
  "COMPANY_OWNED",
  "MANUFACTURER_AUTHORIZED",
];
export const relationTypes = [
  "SUPERSEDES",
  "SUPERSEDED_BY",
  "REPLACEMENT",
  "INTERCHANGE",
  "ALTERNATIVE",
  "EQUIVALENT",
  "CROSS_REFERENCE",
] as const;
export type RelationType = (typeof relationTypes)[number];

export interface CatalogueSource {
  id: string;
  providerKey: string;
  name: string;
  type: string;
  url: string;
  manufacturer: string;
  market: string;
  licenseStatus: string;
  redistributionStatus: string;
  imageUsageStatus: ImageRights;
  feedAvailability: string;
  notes: string;
  priority: number;
  active: boolean;
  lastChecked: string | null;
}

export interface LinkedProduct {
  productId: string;
  sku: string;
  name: string;
  available: number | null;
}
export interface PartSummary {
  id: string;
  manufacturer: string;
  oemNumber: string;
  description: string;
  pnc: string;
  status: string;
  statusClass: StatusClass;
  vehicles: string[];
  drawingCount: number;
  linkedProducts: LinkedProduct[];
}
export interface FitmentView {
  id: string;
  vehicleId: string;
  make: string;
  model: string;
  generation: string;
  chassis: string;
  frame: string;
  body: string;
  transmission: string;
  engines: string[];
  engineText: string;
  productionFrom: string | null;
  productionTo: string | null;
  market: string;
  position: string;
  notes: string;
  catalogue: string;
  section: string;
  attributes: { code: string; meaning?: string; attribute?: string }[];
}
export interface RelationView {
  id: string;
  relation: RelationType;
  relatedNumber: string;
  relatedPartId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string;
  /** "out": this part → related; "in": related → this part. */
  direction: "out" | "in";
}
export interface FactView {
  id: string;
  source: string;
  sourceKey: string;
  description: string;
  status: string;
  priceUsdMinor: number | null;
  priceJpy: number | null;
  notes: string;
  observedAt: string;
}
export interface SourceRecordView {
  id: string;
  source: string;
  sourceKey: string;
  externalId: string;
  sourceUrl: string;
  catalogueCode: string;
  market: string;
  importJobId: string | null;
  importedAt: string;
  sourceUpdatedAt: string | null;
}
export interface DrawingRef {
  drawingId: string;
  code: string;
  title: string;
  callout: string;
  catalogue: string;
  section: string;
  hasImage: boolean;
}
export interface PartDetail {
  id: string;
  manufacturer: string;
  oemNumber: string;
  description: string;
  pnc: string;
  partGroup: string;
  status: string;
  statusClass: StatusClass;
  notes: string;
  verification: Verification;
  version: number;
  createdAt: string;
  updatedAt: string;
  fitments: FitmentView[];
  catalogues: { id: string; code: string; name: string; source: string; market: string }[];
  drawings: DrawingRef[];
  relations: RelationView[];
  facts: FactView[];
  sources: SourceRecordView[];
  /** Reference/source prices are informational only, never shop prices. */
  linkedProducts: LinkedProduct[];
}
export interface CalloutView {
  id: string;
  label: string;
  sequence: number;
  rect: { x1: number; y1: number; x2: number; y2: number } | null;
  space: "PIXEL" | "PERCENT";
  resolved: boolean;
  notes: string;
  parts: { id: string; oemNumber: string; description: string; quantity: number | null; statusClass: StatusClass }[];
}
export interface DrawingDetail {
  id: string;
  code: string;
  title: string;
  revision: string;
  notes: string;
  source: string;
  sourceKey: string;
  catalogues: string[];
  assetId: string | null;
  width: number | null;
  height: number | null;
  rights: ImageRights;
  rightsEvidence: string;
  /** True only when bytes are stored locally AND the rights allow display. */
  imageAvailable: boolean;
  sourceImageUrl: string;
  callouts: CalloutView[];
}
export interface CatalogueSearchQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  manufacturer?: string;
  model?: string;
  chassis?: string;
  engine?: string;
  year?: number;
  market?: string;
  section?: string;
  status?: StatusClass;
  hasDrawing?: boolean;
}
export interface BrowseFilters {
  manufacturer?: string;
  model?: string;
  chassis?: string;
}
export interface BrowseResult {
  manufacturers: { id: string; name: string; parts: number }[];
  models: { id: string; manufacturerId: string; name: string }[];
  vehicles: {
    id: string;
    modelId: string;
    label: string;
    chassis: string;
    market: string;
    productionFrom: string | null;
    productionTo: string | null;
  }[];
  engines: string[];
  markets: string[];
  sections: { id: string; catalogueId: string; code: string; name: string }[];
}

// ---------- import ----------
export const catalogueFields = [
  "oem_number",
  "description",
  "manufacturer",
  "pnc",
  "part_group",
  "status",
  "vehicle_make",
  "vehicle",
  "generation",
  "chassis",
  "frame",
  "body",
  "engine",
  "transmission",
  "production_from",
  "production_to",
  "market",
  "category",
  "catalogue",
  "figures",
  "callout",
  "supersedes",
  "superseded_by",
  "price_usd",
  "price_jpy",
  "source",
  "source_url",
  "source_record_id",
  "notes",
] as const;
export type CatalogueField = (typeof catalogueFields)[number];
export type ColumnMapping = Partial<Record<CatalogueField, string>>;
export const requiredCatalogueFields: CatalogueField[] = ["oem_number", "manufacturer"];

/** One normalized row, ready to import (independent of the CSV's shape). */
export interface CatalogueRecord {
  oemNumber: string;
  description: string;
  manufacturer: string;
  pnc: string;
  partGroup: string;
  status: string;
  make: string;
  model: string;
  generation: string;
  chassis: string[];
  frame: string;
  body: string;
  engines: string[];
  engineText: string;
  transmission: string;
  productionFrom: string | null;
  productionTo: string | null;
  market: string;
  category: string;
  catalogue: string;
  figures: string[];
  callout: string;
  supersedes: string[];
  supersededBy: string[];
  priceUsdMinor: number | null;
  priceJpy: number | null;
  source: string;
  sourceUrl: string;
  sourceRecordId: string;
  notes: string;
}
export type ImportKind = "CSV" | "PACKAGE" | "PROVIDER_LOOKUP";
export type ImportStatus =
  | "PENDING"
  | "REVIEW_REQUIRED"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_WARNINGS"
  | "FAILED"
  | "CANCELLED";
export type RowStatus = "VALID" | "INVALID" | "DUPLICATE" | "CONFLICT" | "EXCLUDED" | "IMPORTED" | "UPDATED" | "UNCHANGED";
export interface ImportJob {
  id: string;
  kind: ImportKind;
  providerKey: string;
  sourceLabel: string;
  status: ImportStatus;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  discovered: number;
  valid: number;
  invalid: number;
  duplicates: number;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  warnings: number;
  errors: number;
  message: string;
  cancelRequested: boolean;
  attempts: number;
  mapping: ColumnMapping | null;
  manifest: Record<string, unknown> | null;
  sourceChecksum: string | null;
}
export interface ImportRow {
  id: string;
  rowNumber: number;
  status: RowStatus;
  action: "CREATE" | "UPDATE" | "NONE";
  identity: string;
  errors: string[];
  warnings: string[];
  record: CatalogueRecord | Record<string, unknown>;
}
export interface DetectedColumns {
  headers: string[];
  suggestedMapping: ColumnMapping;
  sample: string[][];
  rowCount: number;
  unmappedRequired: CatalogueField[];
}
export interface CatalogueStats {
  manufacturers: number;
  parts: number;
  vehicles: number;
  fitments: number;
  drawings: number;
  drawingsWithImages: number;
  callouts: number;
  relations: number;
  sources: number;
  importJobs: number;
}
