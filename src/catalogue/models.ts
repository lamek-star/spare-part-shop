import type { NumberType } from "../domain/models";
export type Verification =
  | "UNVERIFIED"
  | "SOURCE_VERIFIED"
  | "MANUALLY_VERIFIED"
  | "LICENSED_DATA"
  | "DISPUTED";
export type ImageRights =
  | "EXTERNAL_REFERENCE"
  | "LICENSE_UNKNOWN"
  | "LICENSED_FOR_INTERNAL_USE"
  | "LICENSED_FOR_DISPLAY"
  | "COMPANY_OWNED"
  | "MANUFACTURER_AUTHORIZED"
  | "DO_NOT_REPUBLISH";
export interface Provenance {
  sourceProvider: string;
  sourceRecordId: string;
  sourceUrl: string;
  sourceCatalogue: string;
  retrievedAt: string;
  importBatchId: string;
  verification: Verification;
  licenseStatus: string;
}
export interface CatalogueSource {
  id: string;
  providerKey: string;
  name: string;
  type:
    | "MANUFACTURER"
    | "LICENSED_PROVIDER"
    | "SUPPLIER"
    | "API"
    | "CSV"
    | "XML"
    | "JSON"
    | "MANUAL"
    | "WEB_REFERENCE"
    | "OTHER";
  url: string;
  manufacturer: string;
  market: string;
  licenseStatus: string;
  redistributionStatus: string;
  imageUsageStatus: ImageRights;
  feedAvailability: string;
  lastChecked: string;
  notes: string;
  active: boolean;
}
export interface VehicleMake {
  provenance?: Provenance;
  id: string;
  name: string;
}
export interface VehicleModel {
  provenance?: Provenance;
  id: string;
  makeId: string;
  name: string;
}
export interface VehicleVariant {
  id: string;
  modelId: string;
  chassis: string;
  generation: string;
  yearFrom: number;
  yearTo: number;
  engine: string;
  engineCode: string;
  transmission: string;
  drivetrain: string;
  market: string;
  bodyType: string;
  notes: string;
  provenance: Provenance;
}
export interface Catalogue {
  id: string;
  sourceId: string;
  variantId: string;
  name: string;
  provenance: Provenance;
}
export interface Category {
  id: string;
  catalogueId: string;
  parentId?: string;
  name: string;
  provenance: Provenance;
}
export interface CatalogueImage {
  rightsEvidence?: string;
  rightsReviewedAt?: string;
  id: string;
  url: string;
  rights: ImageRights;
  mime: string;
  width: number;
  height: number;
  size: number;
  attribution: string;
  provenance: Provenance;
}
export interface CatalogueDiagram {
  id: string;
  catalogueId: string;
  sourceId: string;
  variantId: string;
  categoryId: string;
  title: string;
  code: string;
  image: CatalogueImage;
  revision: string;
  notes: string;
  provenance: Provenance;
}
export interface DiagramCallout {
  id: string;
  diagramId: string;
  display: string;
  normalized: string;
  partIds: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sequence: number;
  notes: string;
  provenance: Provenance;
}
export interface CataloguePart {
  id: string;
  manufacturer: string;
  description: string;
  catalogueDescription: string;
  categoryId: string;
  catalogueId: string;
  status: string;
  notes: string;
  version: number;
  provenance: Provenance;
}
export interface ReferenceNumber {
  id: string;
  partId: string;
  original: string;
  normalized: string;
  type: NumberType;
  manufacturer: string;
  supplier?: string;
  market: string;
  primary: boolean;
  active: boolean;
  notes: string;
  provenance: Provenance;
}
export interface CrossReference {
  id: string;
  sourceNumberId: string;
  targetNumberId: string;
  type:
    | "EQUIVALENT"
    | "CROSS_REFERENCE"
    | "SUPERSEDES"
    | "SUPERSEDED_BY"
    | "REPLACEMENT"
    | "ALTERNATIVE"
    | "INTERCHANGE";
  confidence: string;
  notes: string;
  provenance: Provenance;
}
export interface ReferenceFitment {
  id: string;
  partId: string;
  variantId: string;
  yearFrom: number;
  yearTo: number;
  engine: string;
  engineCode: string;
  chassis: string;
  transmission: string;
  market: string;
  position: string;
  notes: string;
  provenance: Provenance;
}
export const csvFields = [
  "source_record_id",
  "manufacturer",
  "part_number",
  "part_number_type",
  "description",
  "vehicle_make",
  "vehicle_model",
  "chassis",
  "engine",
  "engine_code",
  "year_from",
  "year_to",
  "category",
  "source",
  "source_url",
  "catalogue",
  "market",
] as const;
export type CsvField = (typeof csvFields)[number];
export type ColumnMapping = Partial<Record<CsvField, string>>;
export interface ImportRecord {
  sourceRecordId: string;
  manufacturer: string;
  number: string;
  numberType: NumberType;
  description: string;
  make: string;
  model: string;
  chassis: string;
  engine: string;
  engineCode: string;
  yearFrom: number;
  yearTo: number;
  category: string;
  sourceUrl: string;
  catalogue: string;
  market: string;
}
export interface StagedRecord {
  id: string;
  row: number;
  record: ImportRecord;
  identity: string;
  errors: string[];
  warnings: string[];
  duplicate: "NONE" | "EXISTING" | "IN_BATCH" | "CONFLICT";
  excluded: boolean;
  existingVersion?: number;
}
export type BatchStatus =
  | "PENDING"
  | "FETCHING"
  | "PARSING"
  | "VALIDATING"
  | "REVIEW_REQUIRED"
  | "PUBLISHING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";
export interface ImportBatch {
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt?: string;
  status: BatchStatus;
  discovered: number;
  valid: number;
  rejected: number;
  duplicates: number;
  warnings: string[];
  errors: string[];
  created: number;
  updated: number;
  records: StagedRecord[];
  csv: string;
  mapping: ColumnMapping;
  attempts: number;
  history: { at: string; status: BatchStatus }[];
}
export interface ReferenceState {
  schema: 1;
  sources: CatalogueSource[];
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
  crossReferences: CrossReference[];
  batches: ImportBatch[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReferenceHit {
  part: CataloguePart;
  numbers: ReferenceNumber[];
}
export interface ReferenceDetail extends ReferenceHit {
  fitments: (ReferenceFitment & { vehicle: string })[];
  crossReferences: (CrossReference & {
    source: string;
    target: string;
    targetPartId: string;
  })[];
  diagrams: CatalogueDiagram[];
  source: CatalogueSource;
}
export interface BrowseOptions {
  makes: VehicleMake[];
  models: VehicleModel[];
  variants: VehicleVariant[];
  categories: Category[];
  diagrams: CatalogueDiagram[];
}
export interface DiagramDetail {
  diagram: CatalogueDiagram;
  callouts: DiagramCallout[];
  parts: ReferenceHit[];
}
export interface AdminOverview {
  sources: CatalogueSource[];
  batches: Omit<ImportBatch, "records" | "csv">[];
  statistics: Record<string, number>;
  images: CatalogueImage[];
}
export const canDisplayImage = (image: CatalogueImage) =>
  ["COMPANY_OWNED", "LICENSED_FOR_DISPLAY", "MANUFACTURER_AUTHORIZED"].includes(
    image.rights,
  );
export const isCatalogueAdmin = (role: string) =>
  ["Owner", "Administrator"].includes(role);
