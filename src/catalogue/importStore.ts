import {
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeNumber } from "../domain/models";
import { toyotaEpcEnabled } from "../integrations/catalogues/toyota-epc/config";
import type {
  FigureImport,
  IntraForgeOEMPart,
} from "../integrations/catalogues/intraforge-storage/client";

/**
 * File-backed store for the admin catalogue warm-up/import feature —
 * same "development-only single-process store" pattern as
 * src/catalogue/server.ts and src/auth/store.ts (mkdir/write-temp/rename,
 * a global cache invalidated by the file's own mtime). This is local to
 * *this* app: job history and the offline-readiness index are this app's
 * own operational records, distinct from the actual catalogue data, which
 * lives in IntraForge (see docs/CATALOGUE_STORAGE.md) and is reached only
 * through src/integrations/catalogues/intraforge-storage/client.ts.
 */
export type ImportItemResult =
  | "IMPORTED"
  | "ALREADY_AVAILABLE"
  | "NOT_FOUND"
  | "PROVIDER_ERROR"
  | "RESTRICTED"
  | "INVALID_INPUT";

export interface ImportJobItem {
  part_number: string;
  normalized_part_number: string;
  result: ImportItemResult;
  message: string;
  provider: string;
  created_at: string;
}

export type ImportJobStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

export interface ImportJob {
  job_id: string;
  created_by: string;
  started_at: string;
  finished_at: string | null;
  input_count: number;
  imported_count: number;
  already_available_count: number;
  not_found_count: number;
  error_count: number;
  status: ImportJobStatus;
  use_provider: boolean;
  batch_size: number;
  delay_ms: number;
  cancel_requested: boolean;
  items: ImportJobItem[];
}

/**
 * A real record this app has actually observed from IntraForge (via a
 * cache hit or a just-completed import) — never fabricated. Backs the
 * "offline readiness" dashboard. There is no listing/count endpoint on
 * the IntraForge side (see docs/CATALOGUE_STORAGE.md's Data model —
 * `catalogue_storage` exposes search/import only), so this index is
 * this app's own bounded observation log rather than a live query
 * against IntraForge's full table — see offlineReadiness() below.
 */
export interface OfflineIndexEntry {
  normalized_part_number: string;
  part_number: string;
  manufacturer: string;
  diagram_code: string | null;
  has_callout: boolean;
  has_hotspot: boolean;
  license_status: string | null;
  provider: string;
  last_seen_at: string;
}

interface ImportState {
  schema: 1;
  jobs: ImportJob[];
  offlineIndex: Record<string, OfflineIndexEntry>;
}

const globals = globalThis as typeof globalThis & {
  __importState?: ImportState;
  __importStamp?: number;
};

/** A directory of its own, distinct from server.ts's `.catalogue-data`/
 * `.catalogue-test-data` (used by ReferenceRepository and shared by many
 * other test files) — sharing that directory made this store's tests
 * race with concurrently-running test files' own recursive rmSync/mkdir
 * calls on the same path, occasionally wiping a background import job's
 * state file mid-write and leaving it stuck RUNNING. */
function dataDir(): string {
  return process.env.CATALOGUE_TEST_MODE === "1"
    ? join(process.cwd(), ".catalogue-import-test-data")
    : join(process.cwd(), ".catalogue-import-data");
}
function stateFile(): string {
  return join(dataDir(), "import-jobs-v1.json");
}
function emptyState(): ImportState {
  return { schema: 1, jobs: [], offlineIndex: {} };
}
function persist(state: ImportState) {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = stateFile();
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(state));
  renameSync(temporary, file);
  globals.__importStamp = statSync(file).mtimeMs;
}
function load(): ImportState {
  const file = stateFile();
  const stamp = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (!globals.__importState || globals.__importStamp !== stamp) {
    const parsed = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as ImportState)
      : undefined;
    globals.__importState = parsed?.schema === 1 ? parsed : emptyState();
    globals.__importStamp = stamp;
  }
  return globals.__importState;
}
/** Test-only: force the in-memory cache to reload from disk on next read. */
export function resetImportStoreCache() {
  globals.__importState = undefined;
  globals.__importStamp = undefined;
}

export function createImportJob(input: {
  createdBy: string;
  inputCount: number;
  useProvider: boolean;
  batchSize: number;
  delayMs: number;
}): ImportJob {
  const state = load();
  const job: ImportJob = {
    job_id: randomUUID(),
    created_by: input.createdBy,
    started_at: new Date().toISOString(),
    finished_at: null,
    input_count: input.inputCount,
    imported_count: 0,
    already_available_count: 0,
    not_found_count: 0,
    error_count: 0,
    status: "PENDING",
    use_provider: input.useProvider,
    batch_size: input.batchSize,
    delay_ms: input.delayMs,
    cancel_requested: false,
    items: [],
  };
  state.jobs.unshift(job);
  persist(state);
  return job;
}
export function getImportJob(id: string): ImportJob | undefined {
  return load().jobs.find((j) => j.job_id === id);
}
export function listImportJobs(limit = 50): ImportJob[] {
  return load().jobs.slice(0, limit);
}
export function updateImportJob(id: string, patch: Partial<ImportJob>) {
  const state = load();
  const job = state.jobs.find((j) => j.job_id === id);
  if (!job) return;
  Object.assign(job, patch);
  persist(state);
}
export function appendImportItem(id: string, item: ImportJobItem) {
  const state = load();
  const job = state.jobs.find((j) => j.job_id === id);
  if (!job) return;
  job.items.push(item);
  if (item.result === "IMPORTED") job.imported_count++;
  else if (item.result === "ALREADY_AVAILABLE") job.already_available_count++;
  else if (item.result === "NOT_FOUND") job.not_found_count++;
  else job.error_count++; // PROVIDER_ERROR, RESTRICTED, INVALID_INPUT
  persist(state);
}
/** Returns false if the job doesn't exist or has already finished. */
export function requestCancelImportJob(id: string): boolean {
  const state = load();
  const job = state.jobs.find((j) => j.job_id === id);
  if (!job || (job.status !== "PENDING" && job.status !== "RUNNING"))
    return false;
  job.cancel_requested = true;
  persist(state);
  return true;
}
export function isCancelRequested(id: string): boolean {
  return load().jobs.find((j) => j.job_id === id)?.cancel_requested ?? false;
}

export function indexEntryFromPart(part: IntraForgeOEMPart): OfflineIndexEntry {
  const dp = part.diagram_parts[0];
  return {
    normalized_part_number: part.normalized_part_number,
    part_number: part.part_number,
    manufacturer: part.manufacturer,
    diagram_code: dp?.diagram.diagram_code ?? null,
    has_callout: Boolean(dp?.callout),
    has_hotspot: Boolean(
      dp &&
      dp.x !== null &&
      dp.y !== null &&
      dp.width !== null &&
      dp.height !== null,
    ),
    license_status: dp?.diagram.license_status ?? null,
    provider: dp?.diagram.provider ?? "",
    last_seen_at: new Date().toISOString(),
  };
}
export function recordOfflineIndex(part: IntraForgeOEMPart) {
  const state = load();
  state.offlineIndex[part.normalized_part_number] = indexEntryFromPart(part);
  persist(state);
}

/** Records every distinct number on a just-persisted figure — they were
 * all stored, so all of them are offline-ready, not only the one that was
 * asked for. */
export function recordFigureInIndex(figure: FigureImport) {
  const state = load();
  const now = new Date().toISOString();
  for (const group of figure.figure_data.groups) {
    for (const row of group.rows) {
      const key = normalizeNumber(row.part_number);
      if (!key) continue;
      state.offlineIndex[key] = {
        normalized_part_number: key,
        part_number: row.part_number,
        manufacturer: figure.manufacturer,
        diagram_code: figure.diagram_code || null,
        has_callout: Boolean(group.callout),
        has_hotspot: group.rect !== null,
        license_status: "EXTERNAL_REFERENCE_ONLY",
        provider: figure.provider,
        last_seen_at: now,
      };
    }
  }
  persist(state);
}

export interface OfflineReadiness {
  cachedParts: number;
  cachedDiagrams: number;
  cachedCallouts: number;
  partsWithHotspot: number;
  lastImportAt: string | null;
  providerEnabled: boolean;
  offlineReadyRecords: number;
}
/**
 * Real counts derived from this app's own observation log
 * (`offlineIndex`, populated whenever a search or import actually sees a
 * part from IntraForge) — not a live count against IntraForge's full
 * table, since no such endpoint exists yet (see the interface doc
 * comment above). Every number here is something this app has actually
 * seen, never estimated.
 */
export function offlineReadiness(): OfflineReadiness {
  const state = load();
  const entries = Object.values(state.offlineIndex);
  const diagrams = new Set(
    entries.filter((e) => e.diagram_code).map((e) => e.diagram_code),
  );
  const lastImportAt =
    state.jobs
      .map((j) => j.finished_at)
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1) ?? null;
  return {
    cachedParts: entries.length,
    cachedDiagrams: diagrams.size,
    cachedCallouts: entries.filter((e) => e.has_callout).length,
    partsWithHotspot: entries.filter((e) => e.has_hotspot).length,
    lastImportAt,
    providerEnabled: toyotaEpcEnabled(),
    offlineReadyRecords: entries.length,
  };
}
