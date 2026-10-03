import type {
  BrowseFilters,
  BrowseResult,
  CatalogueSearchQuery,
  CatalogueSource,
  CatalogueStats,
  DrawingDetail,
  ImageRights,
  ImportJob,
  ImportRow,
  PartDetail,
  PartSummary,
  RelationType,
  RowStatus,
  Verification,
} from "../catalogue/model";
import type { Page } from "../domain/types";

/**
 * Where reference-catalogue data is stored and queried. The standalone
 * implementation is normalized SQLite; a later IntraForge implementation
 * (its catalogue_storage / internal API) replaces it behind this same
 * interface. Importers only ever write through CatalogueWriter, so any
 * provider of records — CSV, an offline package, a controlled online
 * lookup — feeds the same normalized model.
 */
export interface CatalogueWriter {
  ensureSource(
    providerKey: string,
    defaults?: Partial<Omit<CatalogueSource, "id" | "providerKey">>,
  ): Promise<CatalogueSource>;
  ensureManufacturer(name: string): Promise<string>;
  ensureModel(manufacturerId: string, name: string): Promise<string>;
  ensureVehicle(v: {
    modelId: string;
    generation?: string;
    chassis?: string;
    frame?: string;
    body?: string;
    transmission?: string;
    drivetrain?: string;
    engine?: string;
    market?: string;
    productionFrom?: string | null;
    productionTo?: string | null;
    notes?: string;
  }): Promise<string>;
  ensureCatalogue(c: {
    sourceId: string;
    code: string;
    name: string;
    vehicleId?: string | null;
    market?: string;
    productionFrom?: string | null;
    productionTo?: string | null;
  }): Promise<string>;
  ensureSection(
    catalogueId: string,
    code: string,
    name: string,
  ): Promise<string>;
  upsertPart(p: {
    manufacturerId: string;
    oemNumber: string;
    pnc?: string;
    partGroup?: string;
    notes?: string;
  }): Promise<{ id: string; created: boolean; changed: boolean }>;
  /** Adds one source's statement about a part without overwriting another
   * source's; returns whether it was new or changed. */
  recordFact(f: {
    partId: string;
    sourceId: string;
    sourceRecordId?: string | null;
    description: string;
    status: string;
    priceUsdMinor?: number | null;
    priceJpy?: number | null;
    notes?: string;
    observedAt: string;
  }): Promise<{ created: boolean; changed: boolean }>;
  upsertFitment(f: {
    partId: string;
    vehicleId: string;
    catalogueId?: string | null;
    sectionId?: string | null;
    productionFrom?: string | null;
    productionTo?: string | null;
    market?: string;
    engine?: string;
    engineCodes?: string[];
    transmission?: string;
    position?: string;
    notes?: string;
    attributes?: unknown;
    sourceRecordId?: string | null;
  }): Promise<{ id: string; created: boolean }>;
  upsertRelation(r: {
    partId: string;
    relation: RelationType;
    relatedNumber: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    notes?: string;
    sourceRecordId?: string | null;
  }): Promise<{ created: boolean }>;
  ensureDrawing(d: {
    sourceId: string;
    code: string;
    title?: string;
    revision?: string;
    notes?: string;
  }): Promise<{ id: string; created: boolean }>;
  linkCatalogueDrawing(
    catalogueId: string,
    drawingId: string,
    sectionId?: string | null,
  ): Promise<void>;
  ensureCallout(c: {
    drawingId: string;
    label: string;
    sequence?: number;
    rect?: { x1: number; y1: number; x2: number; y2: number } | null;
    space?: "PIXEL" | "PERCENT";
    resolved?: boolean;
    keyType?: string;
    notes?: string;
  }): Promise<string>;
  linkCalloutPart(
    calloutId: string,
    partId: string,
    quantity?: number | null,
  ): Promise<"created" | "updated" | "unchanged">;
  recordSourceRecord(r: {
    sourceId: string;
    externalId: string;
    entityType: string;
    entityId: string;
    sourceUrl?: string;
    catalogueCode?: string;
    market?: string;
    importJobId?: string | null;
    sourceUpdatedAt?: string | null;
    payload?: unknown;
  }): Promise<string>;
  saveAsset(a: {
    fileId?: string | null;
    kind: "DIAGRAM" | "REFERENCE_IMAGE";
    providerKey: string;
    sourceUrl?: string;
    mime?: string;
    width?: number | null;
    height?: number | null;
    checksum?: string;
    rights: ImageRights;
    rightsEvidence?: string;
    importJobId?: string | null;
  }): Promise<string>;
  attachAssetToDrawing(drawingId: string, assetId: string): Promise<void>;
  /** Chooses the displayed description/status from the recorded facts by
   * source priority, then oldest observation — deterministic. */
  recomputeDisplay(partId: string): Promise<void>;
  refreshSearch(partId: string): Promise<void>;
  /** Links relation rows whose related number now exists as a part. */
  linkPendingRelations(): Promise<void>;
  // read probes used to classify staged rows without writing
  findPart(
    manufacturerName: string,
    oemNormalized: string,
  ): Promise<{ id: string; description: string } | null>;
  factExists(
    partId: string,
    sourceKey: string,
    description: string,
  ): Promise<boolean>;
}

export interface CatalogueRepository {
  writer(): CatalogueWriter;
  /** Runs `fn` as an isolated step inside the current transaction: if it
   * throws, everything it wrote is undone and the error is rethrown, while
   * the surrounding transaction carries on. */
  attempt<T>(fn: () => Promise<T>): Promise<T>;

  // ----- queries -----
  search(q: CatalogueSearchQuery): Promise<Page<PartSummary>>;
  getPart(id: string): Promise<PartDetail | null>;
  findPartIdsByOem(oemNormalized: string): Promise<string[]>;
  getDrawing(id: string): Promise<DrawingDetail | null>;
  browse(filters: BrowseFilters): Promise<BrowseResult>;
  stats(): Promise<CatalogueStats>;

  // ----- governance -----
  listSources(): Promise<CatalogueSource[]>;
  saveSource(
    s: Partial<CatalogueSource> & { providerKey: string; name: string },
  ): Promise<CatalogueSource>;
  setVerification(partId: string, v: Verification): Promise<void>;
  getAsset(id: string): Promise<{
    id: string;
    fileId: string | null;
    mime: string;
    rights: ImageRights;
    sourceUrl: string;
  } | null>;
  setAssetRights(
    assetId: string,
    rights: ImageRights,
    evidence: string,
  ): Promise<boolean>;
  listAssets(
    page: number,
    pageSize: number,
  ): Promise<
    Page<{
      id: string;
      drawingCode: string;
      rights: ImageRights;
      hasFile: boolean;
      sourceUrl: string;
      rightsEvidence: string;
    }>
  >;

  // ----- import jobs -----
  createJob(
    j: Partial<ImportJob> & { kind: ImportJob["kind"]; providerKey: string },
  ): Promise<ImportJob>;
  getJob(id: string): Promise<ImportJob | null>;
  listJobs(limit: number): Promise<ImportJob[]>;
  updateJob(id: string, patch: Partial<ImportJob>): Promise<void>;
  requestCancel(id: string): Promise<boolean>;
  insertRows(jobId: string, rows: Omit<ImportRow, "id">[]): Promise<void>;
  listRows(
    jobId: string,
    opts: { status?: RowStatus; page: number; pageSize: number },
  ): Promise<Page<ImportRow>>;
  nextRows(jobId: string, limit: number): Promise<ImportRow[]>;
  setRowStatus(
    rowId: string,
    status: RowStatus,
    warnings?: string[],
  ): Promise<void>;
  setRowExcluded(
    jobId: string,
    rowId: string,
    excluded: boolean,
  ): Promise<boolean>;
  countRows(jobId: string): Promise<Record<RowStatus, number>>;
  /** All persisted rows removed once a job is old enough to not need them. */
  purgeRows(jobId: string): Promise<void>;
}
