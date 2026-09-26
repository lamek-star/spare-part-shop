import { normalizeNumber } from "../domain/models";
import { toyotaEpcEnabled } from "../integrations/catalogues/toyota-epc/config";
import { catalogueStorageEnabled } from "../integrations/catalogues/intraforge-storage/config";
import {
  searchOemPart,
  importFigure,
  type IntraForgeOEMPart,
} from "../integrations/catalogues/intraforge-storage/client";
import {
  resolveToyotaOemPart,
  type ResolvedToyotaPart,
} from "../integrations/catalogues/intraforge-storage/toyotaResolver";
import {
  createImportJob,
  getImportJob,
  appendImportItem,
  updateImportJob,
  isCancelRequested,
  recordOfflineIndex,
  recordFigureInIndex,
  ImportJob,
  ImportJobItem,
} from "./importStore";
import {
  ImportLine,
  MAX_IMPORT_ITEMS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELAY_MS,
} from "./importParsing";
export type { ImportLine } from "./importParsing";
export {
  parseImportLines,
  importLinesFromCsv,
  MAX_IMPORT_ITEMS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELAY_MS,
} from "./importParsing";

/**
 * Orchestrates the controlled admin warm-up/import: takes an explicit,
 * operator-supplied list of OEM part numbers and resolves each one
 * through the exact same single-part path the ordinary search cache-miss
 * already uses (searchOemPart / resolveToyotaOemPart / importOemPart —
 * see src/app/api/catalogue/route.ts's "oem-search" action and
 * docs/CATALOGUE_STORAGE.md). This is deliberately NOT a new bulk-fetch
 * code path — it is the same one-part-at-a-time resolution, run
 * sequentially (never in parallel) over a bounded, explicit list, with a
 * delay between requests and a longer cooldown every `batchSize` items.
 * Nothing here calls providerPolicy.ts's assertBulkSyncAllowed /
 * catalogue/sync.ts's whole-catalogue sync path — that governs a
 * different store (this app's own ReferenceCatalogue) and stays
 * unreachable exactly as it was; see providerPolicy.ts.
 *
 * The pure line/CSV parsing helpers live in importParsing.ts (no node:fs
 * import) so the admin UI component can import them directly without
 * dragging this file's server-only importStore.ts dependency into the
 * browser bundle — Turbopack refuses to chunk `node:fs` for the client.
 */
const MAX_BATCH_SIZE = 25;
const MAX_DELAY_MS = 10_000;
const MIN_DELAY_MS = 200;

/** Persists the resolved figure (every part number on it) in IntraForge
 * and returns the stored record for the number that was asked for. */
export async function persistResolvedFigure(
  resolved: ResolvedToyotaPart,
): Promise<IntraForgeOEMPart> {
  await importFigure(resolved.figure);
  recordFigureInIndex(resolved.figure);
  const part = await searchOemPart(resolved.partNumber);
  if (!part)
    throw new Error("figure was stored but the part could not be read back.");
  recordOfflineIndex(part);
  return part;
}
const figureRows = (r: ResolvedToyotaPart) =>
  new Set(
    r.figure.figure_data.groups.flatMap((g) =>
      g.rows.map((row) => normalizeNumber(row.part_number)),
    ),
  ).size;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function now() {
  return new Date().toISOString();
}

export interface StartImportOptions {
  lines: ImportLine[];
  createdBy: string;
  /** Whether a cache miss may resolve through the Toyota EPC provider.
   * false = cache-only warm-up check, never touches the network. */
  useProvider: boolean;
  batchSize?: number;
  delayMs?: number;
}

/** Creates the job record (status PENDING → RUNNING) and starts
 * processing in the background; returns immediately so the admin UI can
 * poll job status/progress rather than holding the request open for
 * however long the whole list takes. */
export async function startImportJob(
  options: StartImportOptions,
): Promise<ImportJob> {
  if (!catalogueStorageEnabled())
    throw new Error(
      "Catalogue storage is not configured (INTRAFORGE_CATALOGUE_BEARER_TOKEN/INTRAFORGE_ISSUER). No import can run.",
    );
  if (options.lines.length === 0)
    throw new Error("No part numbers were provided.");
  if (options.lines.length > MAX_IMPORT_ITEMS)
    throw new Error(
      `Refusing to start: ${options.lines.length} part numbers exceeds the ${MAX_IMPORT_ITEMS}-item controlled-import limit. Split into smaller batches — this is a deliberate, non-configurable guard against uncontrolled bulk scraping.`,
    );
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
  );
  const delayMs = Math.max(
    MIN_DELAY_MS,
    Math.min(options.delayMs ?? DEFAULT_DELAY_MS, MAX_DELAY_MS),
  );
  const job = createImportJob({
    createdBy: options.createdBy,
    inputCount: options.lines.length,
    useProvider: options.useProvider,
    batchSize,
    delayMs,
  });
  void runImportJob(
    job.job_id,
    options.lines,
    options.useProvider,
    batchSize,
    delayMs,
  );
  return job;
}

async function processLine(
  jobId: string,
  line: ImportLine,
  useProvider: boolean,
): Promise<{ item: ImportJobItem; usedNetwork: boolean }> {
  const raw = (line.part_number || "").trim();
  const normalized = normalizeNumber(raw);
  const base = {
    part_number: raw,
    normalized_part_number: normalized,
    created_at: now(),
  };
  if (!raw || !normalized || !/^[A-Z0-9]+$/.test(normalized)) {
    return {
      item: {
        ...base,
        result: "INVALID_INPUT",
        message: "Not a recognizable OEM part number.",
        provider: "",
      },
      usedNetwork: false,
    };
  }
  let existing;
  try {
    existing = await searchOemPart(raw);
  } catch (e) {
    return {
      item: {
        ...base,
        result: "PROVIDER_ERROR",
        message: `Catalogue lookup failed: ${e instanceof Error ? e.message : "unknown error"}`,
        provider: "intraforge-storage",
      },
      usedNetwork: true,
    };
  }
  if (existing) {
    recordOfflineIndex(existing);
    const provider =
      existing.diagram_parts[0]?.diagram.provider || "intraforge-storage";
    const needsFigure =
      existing.diagram_parts.length > 0 &&
      existing.diagram_parts.every((dp) => dp.diagram.has_figure === false);
    // Naming a vehicle catalogue asks for that vehicle's drawing even when
    // the number is cached against another one.
    const wantsCatalogue = Boolean(line.catalogue);
    if (
      (!needsFigure && !wantsCatalogue) ||
      !useProvider ||
      !toyotaEpcEnabled()
    ) {
      return {
        item: {
          ...base,
          result: "ALREADY_AVAILABLE",
          message: needsFigure
            ? "Already present in the IntraForge catalogue (single record — its full figure was not attached because provider lookup is off)."
            : "Already present in the IntraForge catalogue.",
          provider,
        },
        usedNetwork: true,
      };
    }
    // Cached before figures existed: attach the whole drawing's parts
    // list once, without touching the record's own identity.
    try {
      const resolved = await resolveToyotaOemPart(raw, line.catalogue);
      if (resolved) {
        await persistResolvedFigure(resolved);
        return {
          item: {
            ...base,
            result: "IMPORTED",
            message: `Already cached; ${line.catalogue ? `the drawing from catalogue ${line.catalogue}` : "its full figure"} (${figureRows(resolved)} part numbers) was added.`,
            provider: "toyota-epc",
          },
          usedNetwork: true,
        };
      }
    } catch (e) {
      return {
        item: {
          ...base,
          result: "ALREADY_AVAILABLE",
          message: `Already present; attaching its figure failed: ${e instanceof Error ? e.message : "unknown error"}`,
          provider,
        },
        usedNetwork: true,
      };
    }
    return {
      item: {
        ...base,
        result: "ALREADY_AVAILABLE",
        message:
          "Already present in the IntraForge catalogue (no figure found at the provider).",
        provider,
      },
      usedNetwork: true,
    };
  }
  if (!useProvider) {
    return {
      item: {
        ...base,
        result: "RESTRICTED",
        message: "Not cached, and provider lookup is disabled for this job.",
        provider: "",
      },
      usedNetwork: false,
    };
  }
  if (!toyotaEpcEnabled()) {
    return {
      item: {
        ...base,
        result: "RESTRICTED",
        message:
          'Not cached, and the Toyota EPC provider is disabled (TOYOTA_EPC_ENABLED is not "true").',
        provider: "toyota-epc",
      },
      usedNetwork: false,
    };
  }
  let resolved;
  try {
    resolved = await resolveToyotaOemPart(raw, line.catalogue);
  } catch (e) {
    return {
      item: {
        ...base,
        result: "PROVIDER_ERROR",
        message: `Toyota EPC resolution failed: ${e instanceof Error ? e.message : "unknown error"}`,
        provider: "toyota-epc",
      },
      usedNetwork: true,
    };
  }
  if (!resolved) {
    return {
      item: {
        ...base,
        result: "NOT_FOUND",
        message: "No matching part found via the Toyota EPC provider.",
        provider: "toyota-epc",
      },
      usedNetwork: true,
    };
  }
  try {
    await persistResolvedFigure(resolved);
  } catch (e) {
    return {
      item: {
        ...base,
        result: "PROVIDER_ERROR",
        message: `Resolved via Toyota EPC but failed to persist: ${e instanceof Error ? e.message : "unknown error"}`,
        provider: "toyota-epc",
      },
      usedNetwork: true,
    };
  }
  return {
    item: {
      ...base,
      result: "IMPORTED",
      message: `Resolved via Toyota EPC; its figure (${figureRows(resolved)} part numbers) was cached in IntraForge.`,
      provider: "toyota-epc",
    },
    usedNetwork: true,
  };
}

async function runImportJob(
  jobId: string,
  lines: ImportLine[],
  useProvider: boolean,
  batchSize: number,
  delayMs: number,
) {
  updateImportJob(jobId, { status: "RUNNING" });
  let cancelled = false;
  for (let i = 0; i < lines.length; i++) {
    if (isCancelRequested(jobId)) {
      cancelled = true;
      break;
    }
    const { item, usedNetwork } = await processLine(
      jobId,
      lines[i],
      useProvider,
    );
    appendImportItem(jobId, item);
    const isLast = i === lines.length - 1;
    if (!isLast && !isCancelRequested(jobId)) {
      const cooldown = (i + 1) % batchSize === 0;
      if (cooldown) await sleep(delayMs * 2);
      else if (usedNetwork) await sleep(delayMs);
    }
  }
  const job = getImportJob(jobId);
  const status: ImportJob["status"] = cancelled
    ? "CANCELLED"
    : !job || job.error_count === 0
      ? job && job.not_found_count === 0
        ? "COMPLETED"
        : job && job.imported_count + job.already_available_count > 0
          ? "PARTIAL"
          : "FAILED"
      : job.imported_count + job.already_available_count > 0
        ? "PARTIAL"
        : "FAILED";
  updateImportJob(jobId, { status, finished_at: now() });
}

/** Starts a fresh job containing only the failed/not-found/restricted
 * items from a prior job — never re-touches items that already
 * succeeded (ALREADY_AVAILABLE/IMPORTED), matching "do not silently
 * overwrite existing valid records". */
export async function retryFailedItems(
  jobId: string,
  createdBy: string,
): Promise<ImportJob> {
  const prior = getImportJob(jobId);
  if (!prior) throw new Error("Import job not found.");
  const retryable = prior.items.filter(
    (i) =>
      i.result === "PROVIDER_ERROR" ||
      i.result === "NOT_FOUND" ||
      i.result === "RESTRICTED",
  );
  if (retryable.length === 0)
    throw new Error(
      "This job has no failed, not-found, or restricted items to retry.",
    );
  return startImportJob({
    lines: retryable.map((i) => ({ part_number: i.part_number })),
    createdBy,
    useProvider: prior.use_provider,
    batchSize: prior.batch_size,
    delayMs: prior.delay_ms,
  });
}
