import { createHash } from "node:crypto";
import type { UnitOfWork } from "../providers/uow";
import type { CatalogueWriter } from "../providers/catalogue";
import type { Actor, Page } from "../domain/types";
import type {
  CatalogueField,
  CatalogueRecord,
  ColumnMapping,
  DetectedColumns,
  ImportJob,
  ImportRow,
  RowStatus,
} from "./model";
import { catalogueFields, requiredCatalogueFields } from "./model";
import { CsvError, looksLikeFormula, parseCsv, type CsvLimits, type ParsedCsv } from "./csv";
import { AppError, conflict, notFound, validation } from "../kernel/errors";
import { normalizeNumber, nowIso } from "../kernel/ids";
import { parseMoney } from "../kernel/money";
import { requirePermission } from "../domain/permissions";
import { record as asRecord } from "../domain/validate";

/** Header names people actually use, matched case/space/underscore-insensitively. */
export const columnAliases: Record<CatalogueField, string[]> = {
  oem_number: ["oem_number", "oem", "oem_no", "oem_part_number", "part_number", "part_no", "partnumber", "number", "part"],
  description: ["description", "part_name", "name", "desc", "title"],
  manufacturer: ["manufacturer", "brand", "make_of_part", "maker"],
  pnc: ["pnc", "part_name_code"],
  part_group: ["part_group", "group"],
  status: ["status", "availability", "state"],
  vehicle_make: ["vehicle_make", "make", "car_make"],
  vehicle: ["vehicle", "vehicle_model", "model", "car_model"],
  generation: ["generation", "gen"],
  chassis: ["chassis", "chassis_code", "frame_code", "model_code"],
  frame: ["frame", "frame_range", "vin_range"],
  body: ["body", "body_type"],
  engine: ["engine", "engine_code", "engines"],
  transmission: ["transmission", "gearbox"],
  production_from: ["production_from", "from", "start", "year_from", "production_start"],
  production_to: ["production_to", "to", "end", "year_to", "production_end"],
  market: ["market", "region", "destination"],
  category: ["category", "section", "group_name", "system"],
  catalogue: ["catalogue", "catalog", "catalogue_code", "catalog_code"],
  figures: ["figures", "figure", "drawings", "drawing", "diagram", "diagrams"],
  callout: ["callout", "item_no", "ref_no"],
  supersedes: ["supersedes", "replaces", "previous_number"],
  superseded_by: ["superseded_by", "replaced_by", "replacement", "new_number"],
  price_usd: ["price_usd", "usd", "price_us"],
  price_jpy: ["price_jpy", "jpy", "price_yen"],
  source: ["source", "provider", "data_source"],
  source_url: ["source_url", "url", "link", "source_link"],
  source_record_id: ["source_record_id", "source_id", "record_id", "external_id"],
  notes: ["notes", "note", "remarks", "comment", "comments"],
};
const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function detectColumns(parsed: ParsedCsv): DetectedColumns {
  const suggested: ColumnMapping = {};
  const used = new Set<string>();
  for (const field of catalogueFields) {
    const header = parsed.headers.find((h) => !used.has(h) && columnAliases[field].includes(squash(h)));
    if (header) {
      suggested[field] = header;
      used.add(header);
    }
  }
  return {
    headers: parsed.headers,
    suggestedMapping: suggested,
    sample: parsed.rows.slice(0, 5).map((r) => r.cells),
    rowCount: parsed.rows.length,
    unmappedRequired: requiredCatalogueFields.filter((f) => !suggested[f]),
  };
}

// ---------------- row normalization ----------------
const safeUrl = (value: string) => {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" && !u.username && !u.password && !u.port && u.hostname.includes(".") &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname) &&
      !u.hostname.endsWith(".local") && !u.hostname.endsWith(".internal")
    );
  } catch {
    return false;
  }
};
const DATE = /^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?$/;
export function normalizeDate(input: string): string | null | "INVALID" {
  const v = input.trim();
  if (!v) return null;
  const m = DATE.exec(v);
  if (!m) return "INVALID";
  const y = Number(m[1]);
  if (y < 1900 || y > 2100) return "INVALID";
  if (!m[2]) return String(y);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return "INVALID";
  const mm = String(mo).padStart(2, "0");
  if (!m[3]) return `${y}-${mm}`;
  const d = Number(m[3]);
  if (d < 1 || d > 31) return "INVALID";
  return `${y}-${mm}-${String(d).padStart(2, "0")}`;
}
const splitMulti = (value: string) => [...new Set(value.split(/[;|]/).map((v) => v.trim()).filter(Boolean))].slice(0, 50);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export interface NormalizeOptions {
  defaultManufacturer?: string;
  defaultSource?: string;
  defaultMarket?: string;
}
export function normalizeRow(
  headers: string[],
  cells: string[],
  mapping: ColumnMapping,
  opts: NormalizeOptions = {},
): { record: CatalogueRecord | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cell = (field: CatalogueField) => {
    const i = mapping[field] ? headers.indexOf(mapping[field]!) : -1;
    return i < 0 ? "" : (cells[i] ?? "").trim();
  };
  for (const c of cells) {
    if (CONTROL.test(c)) {
      errors.push("A cell contains a control character.");
      break;
    }
  }
  const formulaCells = cells.filter((c) => looksLikeFormula(c)).length;
  if (formulaCells) warnings.push(`${formulaCells} cell(s) start like a spreadsheet formula; they are stored as plain text and neutralized on export.`);

  const oem = cell("oem_number");
  if (!oem) errors.push("oem_number is required.");
  else if (oem.length > 40 || !/[A-Za-z0-9]/.test(oem)) errors.push("oem_number is not a valid part number.");
  const manufacturer = cell("manufacturer") || opts.defaultManufacturer || "";
  if (!manufacturer) errors.push("manufacturer is required.");
  else if (manufacturer.length > 100) errors.push("manufacturer is too long.");
  const description = cell("description");
  if (!description) warnings.push("No description was supplied.");
  if (description.length > 400) errors.push("description is longer than 400 characters.");

  const fromRaw = normalizeDate(cell("production_from"));
  const toRaw = normalizeDate(cell("production_to"));
  if (fromRaw === "INVALID") errors.push("production_from is not a valid date (use YYYY, YYYY-MM or YYYY-MM-DD).");
  if (toRaw === "INVALID") errors.push("production_to is not a valid date (use YYYY, YYYY-MM or YYYY-MM-DD).");
  const from = fromRaw === "INVALID" ? null : fromRaw;
  const to = toRaw === "INVALID" ? null : toRaw;
  if (from && to && from > to) errors.push("production_from is after production_to.");

  let priceUsdMinor: number | null = null;
  const usd = cell("price_usd");
  if (usd) {
    try {
      priceUsdMinor = parseMoney(usd);
      if (priceUsdMinor < 0) throw new RangeError("negative");
    } catch {
      errors.push("price_usd is not a valid non-negative amount.");
    }
  }
  let priceJpy: number | null = null;
  const jpy = cell("price_jpy");
  if (jpy) {
    if (/^\d{1,12}$/.test(jpy.replace(/,/g, ""))) priceJpy = Number(jpy.replace(/,/g, ""));
    else errors.push("price_jpy is not a valid whole non-negative amount.");
  }
  const sourceUrl = cell("source_url");
  if (!safeUrl(sourceUrl)) errors.push("source_url must be a public HTTPS address without credentials or ports.");
  for (const [field, max] of [["pnc", 40], ["part_group", 100], ["status", 200], ["vehicle", 120], ["category", 120], ["catalogue", 120], ["market", 80], ["notes", 2000], ["source", 100], ["source_record_id", 200]] as const)
    if (cell(field).length > max) errors.push(`${field} is longer than ${max} characters.`);
  if (errors.length) return { record: null, errors: [...new Set(errors)], warnings };

  const engines = splitMulti(cell("engine"));
  return {
    record: {
      oemNumber: oem,
      description,
      manufacturer,
      pnc: cell("pnc"),
      partGroup: cell("part_group"),
      status: cell("status"),
      make: cell("vehicle_make") || manufacturer,
      model: cell("vehicle"),
      generation: cell("generation"),
      chassis: splitMulti(cell("chassis")),
      frame: cell("frame"),
      body: cell("body"),
      engines: engines.map((e) => e.replace(/\s*\(.*\)\s*$/, "").trim()).filter(Boolean),
      engineText: cell("engine"),
      transmission: cell("transmission"),
      productionFrom: from,
      productionTo: to,
      market: cell("market") || opts.defaultMarket || "",
      category: cell("category"),
      catalogue: cell("catalogue"),
      figures: splitMulti(cell("figures")),
      callout: cell("callout"),
      supersedes: splitMulti(cell("supersedes")),
      supersededBy: splitMulti(cell("superseded_by")),
      priceUsdMinor,
      priceJpy,
      source: cell("source") || opts.defaultSource || "csv-import",
      sourceUrl,
      sourceRecordId: cell("source_record_id"),
      notes: cell("notes"),
    },
    errors: [],
    warnings,
  };
}
export const sourceKeyOf = (name: string) => squash(name).replace(/_/g, "-") || "csv-import";
const rowIdentity = (r: CatalogueRecord) =>
  createHash("sha1")
    .update([sourceKeyOf(r.source), normalizeNumber(r.oemNumber), r.manufacturer.toLowerCase(), r.model.toLowerCase(), r.chassis.join("|").toLowerCase(), r.market.toLowerCase(), r.productionFrom, r.productionTo, r.catalogue.toLowerCase()].join("\u0001"))
    .digest("hex")
    .slice(0, 24);

// ---------------- applying a record ----------------
export interface ApplyResult {
  created: boolean;
  changed: boolean;
}
/** Idempotently writes one normalized record and everything hanging off it. */
export async function applyRecord(w: CatalogueWriter, rec: CatalogueRecord, ctx: { importJobId: string | null; observedAt: string; rawRow?: unknown }): Promise<ApplyResult> {
  const sourceKey = sourceKeyOf(rec.source);
  const source = await w.ensureSource(sourceKey, { name: rec.source, type: "CSV", manufacturer: rec.manufacturer });
  const manufacturerId = await w.ensureManufacturer(rec.manufacturer);
  const part = await w.upsertPart({ manufacturerId, oemNumber: rec.oemNumber, pnc: rec.pnc, partGroup: rec.partGroup });
  let changed = part.changed;
  const externalId = rec.sourceRecordId || rowIdentity(rec);
  const sourceRecordId = await w.recordSourceRecord({
    sourceId: source.id, externalId, entityType: "part", entityId: part.id, sourceUrl: rec.sourceUrl, catalogueCode: rec.catalogue,
    market: rec.market, importJobId: ctx.importJobId, payload: ctx.rawRow ?? rec,
  });
  const fact = await w.recordFact({
    partId: part.id, sourceId: source.id, sourceRecordId, description: rec.description, status: rec.status, priceUsdMinor: rec.priceUsdMinor,
    priceJpy: rec.priceJpy, notes: rec.notes, observedAt: ctx.observedAt,
  });
  changed ||= fact.changed;
  if (fact.changed) await w.recomputeDisplay(part.id);

  if (rec.model) {
    const makeId = await w.ensureManufacturer(rec.make);
    const modelId = await w.ensureModel(makeId, rec.model);
    const chassisList = rec.chassis.length ? rec.chassis : [""];
    for (const chassis of chassisList) {
      const vehicleId = await w.ensureVehicle({ modelId, generation: rec.generation, chassis, frame: rec.frame, body: rec.body, transmission: rec.transmission, market: rec.market, productionFrom: rec.productionFrom, productionTo: rec.productionTo });
      const code = rec.catalogue || [rec.model, rec.market].filter(Boolean).join(" ") || rec.model;
      const catalogueId = await w.ensureCatalogue({ sourceId: source.id, code, name: code, vehicleId, market: rec.market, productionFrom: rec.productionFrom, productionTo: rec.productionTo });
      const sectionId = rec.category ? await w.ensureSection(catalogueId, squash(rec.category) || "section", rec.category) : null;
      const fitment = await w.upsertFitment({
        partId: part.id, vehicleId, catalogueId, sectionId, productionFrom: rec.productionFrom, productionTo: rec.productionTo, market: rec.market, engine: rec.engineText,
        engineCodes: rec.engines, transmission: rec.transmission, sourceRecordId,
      });
      changed ||= fitment.created;
      for (const figure of rec.figures) {
        const drawingId = await w.ensureDrawing({ sourceId: source.id, code: figure, title: figure });
        await w.linkCatalogueDrawing(catalogueId, drawingId, sectionId);
        const calloutId = await w.ensureCallout({ drawingId, label: rec.callout || rec.pnc || "", resolved: true });
        await w.linkCalloutPart(calloutId, part.id);
      }
    }
  } else if (rec.figures.length) {
    for (const figure of rec.figures) {
      const drawingId = await w.ensureDrawing({ sourceId: source.id, code: figure, title: figure });
      const calloutId = await w.ensureCallout({ drawingId, label: rec.callout || rec.pnc || "", resolved: true });
      await w.linkCalloutPart(calloutId, part.id);
    }
  }
  for (const number of rec.supersedes) {
    // (evaluate first: `changed ||= call()` would skip the call once changed is true)
    const made = await w.upsertRelation({ partId: part.id, relation: "SUPERSEDES", relatedNumber: number, sourceRecordId });
    changed ||= made.created;
  }
  for (const number of rec.supersededBy) {
    const made = await w.upsertRelation({ partId: part.id, relation: "SUPERSEDED_BY", relatedNumber: number, sourceRecordId });
    changed ||= made.created;
  }
  await w.refreshSearch(part.id);
  return { created: part.created, changed };
}

// ---------------- the service ----------------
export interface StageOptions {
  content: string | Uint8Array;
  fileName: string;
  mapping: ColumnMapping;
  attested: boolean;
  defaultManufacturer?: string;
  defaultSource?: string;
  defaultMarket?: string;
  limits?: Partial<CsvLimits>;
}
const CHUNK = 500;

export class CatalogueImportService {
  constructor(private readonly uow: UnitOfWork) {}

  private parse(content: string | Uint8Array, limits?: Partial<CsvLimits>): ParsedCsv {
    try {
      return parseCsv(content, limits);
    } catch (e) {
      if (e instanceof CsvError) throw validation(e.message);
      if (e instanceof TypeError) throw validation("The file is not valid UTF-8 text. Save it as CSV (UTF-8) and try again.");
      throw e;
    }
  }
  /** Step 1: read the file's columns and suggest a mapping. Writes nothing. */
  async detect(actor: Actor, content: string | Uint8Array, limits?: Partial<CsvLimits>): Promise<DetectedColumns> {
    requirePermission(actor, "catalogue.import");
    return detectColumns(this.parse(content, limits));
  }

  /** Steps 2-4: validate every row, classify it against what is already
   * stored, and keep the result for review. Nothing is committed yet. */
  async stageCsv(actor: Actor, raw: StageOptions): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    if (!raw.attested) throw validation("Confirm that your organization may use this data before importing it.");
    const mapping = asRecord(raw.mapping, "Column mapping") as ColumnMapping;
    const parsed = this.parse(raw.content, raw.limits);
    for (const [field, header] of Object.entries(mapping)) {
      if (!(catalogueFields as readonly string[]).includes(field)) throw validation(`Unknown field "${field}" in the mapping.`);
      if (header && !parsed.headers.includes(header)) throw validation(`The mapped column "${header}" does not exist in the file.`);
    }
    if (!mapping.oem_number) throw validation("Map a column to oem_number.");
    if (!mapping.manufacturer && !raw.defaultManufacturer) throw validation("Map a column to manufacturer, or choose a default manufacturer.");
    const checksum = createHash("sha256").update(typeof raw.content === "string" ? raw.content : Buffer.from(raw.content)).digest("hex");
    const opts: NormalizeOptions = { defaultManufacturer: raw.defaultManufacturer?.trim(), defaultSource: raw.defaultSource?.trim(), defaultMarket: raw.defaultMarket?.trim() };
    const seen = new Map<string, CatalogueRecord>();
    const rows: Omit<ImportRow, "id">[] = [];
    let warnings = 0;
    for (const row of parsed.rows) {
      if (row.shapeError) {
        rows.push({ rowNumber: row.line, status: "INVALID", action: "NONE", identity: "", errors: [row.shapeError], warnings: [], record: { cells: row.cells.slice(0, 20) } });
        continue;
      }
      const { record, errors, warnings: w } = normalizeRow(parsed.headers, row.cells, mapping, opts);
      if (!record) {
        rows.push({ rowNumber: row.line, status: "INVALID", action: "NONE", identity: "", errors, warnings: w, record: Object.fromEntries(parsed.headers.map((h, i) => [h, row.cells[i] ?? ""])) });
        continue;
      }
      const identity = rowIdentity(record);
      const earlier = seen.get(identity);
      if (earlier) {
        const same = JSON.stringify(earlier) === JSON.stringify(record);
        if (same) {
          rows.push({ rowNumber: row.line, status: "DUPLICATE", action: "NONE", identity, errors: [], warnings: ["Identical to an earlier row in this file."], record });
          continue;
        }
        w.push(`Conflicts with an earlier row for the same part (description "${earlier.description}" vs "${record.description}"); both are kept as source evidence.`);
      } else seen.set(identity, record);
      rows.push({ rowNumber: row.line, status: "VALID", action: "NONE", identity, errors: [], warnings: w, record });
    }
    // Classify valid rows against what is already stored.
    let create = 0;
    let update = 0;
    let existing = 0;
    await this.uow.read(async (r) => {
      const w = r.catalogue.writer();
      for (const row of rows) {
        if (row.status !== "VALID") continue;
        const rec = row.record as CatalogueRecord;
        const found = await w.findPart(rec.manufacturer, normalizeNumber(rec.oemNumber));
        if (!found) {
          row.action = "CREATE";
          create++;
        } else {
          existing++;
          const sameFact = await w.factExists(found.id, sourceKeyOf(rec.source), rec.description);
          row.action = sameFact ? "NONE" : "UPDATE";
          if (!sameFact) {
            update++;
            if (found.description && rec.description && found.description !== rec.description)
              row.warnings.push(`Currently stored description: "${found.description}". The new description is added as source evidence; it does not replace the displayed one unless this source ranks higher.`);
          }
        }
      }
    });
    warnings = rows.reduce((n, r) => n + r.warnings.length, 0);
    const counts = { valid: 0, invalid: 0, duplicates: 0 };
    for (const r of rows) {
      if (r.status === "VALID") counts.valid++;
      else if (r.status === "INVALID") counts.invalid++;
      else if (r.status === "DUPLICATE") counts.duplicates++;
    }
    return this.uow.write(async (r) => {
      const job = await r.catalogue.createJob({
        kind: "CSV", providerKey: sourceKeyOf(raw.defaultSource ?? "csv-import"), sourceLabel: raw.fileName.slice(0, 200), status: "REVIEW_REQUIRED", createdBy: actor.id,
        mapping, sourceChecksum: checksum, discovered: parsed.rows.length, valid: counts.valid, invalid: counts.invalid, duplicates: counts.duplicates,
        message: `${create} new, ${existing} existing (${update} to update), ${counts.invalid} invalid, ${counts.duplicates} duplicate. Review before importing.`,
      });
      for (let i = 0; i < rows.length; i += 1000) await r.catalogue.insertRows(job.id, rows.slice(i, i + 1000));
      await r.catalogue.updateJob(job.id, { warnings, errors: counts.invalid, skipped: counts.invalid + counts.duplicates });
      await r.audit.record(actor, { action: "catalogue.import.stage", entityType: "import_job", entityId: job.id, summary: `CSV ${raw.fileName} staged: ${counts.valid} valid, ${counts.invalid} invalid`, metadata: { discovered: parsed.rows.length, checksum } });
      return (await r.catalogue.getJob(job.id))!;
    });
  }

  async getJob(actor: Actor, id: string): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    const j = await this.uow.read((r) => r.catalogue.getJob(id));
    if (!j) throw notFound("Import job");
    return j;
  }
  async listJobs(actor: Actor, limit = 50): Promise<ImportJob[]> {
    requirePermission(actor, "catalogue.import");
    return this.uow.read((r) => r.catalogue.listJobs(limit));
  }
  async rows(actor: Actor, jobId: string, opts: { status?: RowStatus; page?: number; pageSize?: number }): Promise<Page<ImportRow>> {
    requirePermission(actor, "catalogue.import");
    return this.uow.read((r) => r.catalogue.listRows(jobId, { status: opts.status, page: opts.page ?? 1, pageSize: opts.pageSize ?? 50 }));
  }
  async excludeRow(actor: Actor, jobId: string, rowId: string, excluded: boolean) {
    requirePermission(actor, "catalogue.import");
    return this.uow.write(async (r) => {
      const job = await r.catalogue.getJob(jobId);
      if (!job) throw notFound("Import job");
      if (job.status !== "REVIEW_REQUIRED") throw conflict("Rows can only be excluded while the job awaits review.");
      if (!(await r.catalogue.setRowExcluded(jobId, rowId, excluded))) throw notFound("Staged row");
      const c = await r.catalogue.countRows(jobId);
      await r.catalogue.updateJob(jobId, { valid: c.VALID });
      return r.catalogue.getJob(jobId);
    });
  }
  async cancel(actor: Actor, jobId: string): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    return this.uow.write(async (r) => {
      const job = await r.catalogue.getJob(jobId);
      if (!job) throw notFound("Import job");
      if (["COMPLETED", "COMPLETED_WITH_WARNINGS", "CANCELLED", "FAILED"].includes(job.status)) throw conflict(`A ${job.status.toLowerCase().replace(/_/g, " ")} job cannot be cancelled.`);
      if (job.status === "REVIEW_REQUIRED" || job.status === "PENDING") {
        await r.catalogue.updateJob(jobId, { status: "CANCELLED", finishedAt: nowIso(), message: "Cancelled before import." });
      } else await r.catalogue.requestCancel(jobId);
      await r.audit.record(actor, { action: "catalogue.import.cancel", entityType: "import_job", entityId: jobId, summary: "Import cancelled" });
      return (await r.catalogue.getJob(jobId))!;
    });
  }

  /** Imports every staged valid row, in chunks. Each chunk is its own
   * transaction; a row that fails is isolated with a savepoint and marked
   * INVALID without stopping the job. Safe to call again after a crash or
   * cancellation: it resumes with the rows still VALID. */
  async commit(actor: Actor, jobId: string, opts: { chunkSize?: number; afterChunk?: (chunkNumber: number) => Promise<void> } = {}): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    const start = await this.uow.write(async (r) => {
      const job = await r.catalogue.getJob(jobId);
      if (!job) throw notFound("Import job");
      if (["COMPLETED", "COMPLETED_WITH_WARNINGS"].includes(job.status)) return { job, run: false };
      if (!["REVIEW_REQUIRED", "FAILED", "RUNNING", "CANCELLED"].includes(job.status)) throw conflict(`A ${job.status.toLowerCase().replace(/_/g, " ")} job cannot be imported.`);
      if (job.kind !== "CSV") throw conflict("This job is not a staged CSV import.");
      await r.catalogue.updateJob(jobId, { status: "RUNNING", startedAt: job.startedAt ?? nowIso(), attempts: job.attempts + 1, cancelRequested: false, finishedAt: null, message: "Importing…" });
      return { job, run: true };
    });
    if (!start.run) return start.job;
    return this.runChunks(actor, jobId, opts);
  }

  private async runChunks(actor: Actor, jobId: string, opts: { chunkSize?: number; afterChunk?: (chunkNumber: number) => Promise<void> }): Promise<ImportJob> {
    let observed = nowIso();
    let chunkNumber = 0;
    const size = Math.max(1, Math.min(CHUNK, opts.chunkSize ?? CHUNK));
    try {
      for (;;) {
        const fresh = await this.uow.read((r) => r.catalogue.getJob(jobId));
        if (fresh?.cancelRequested) {
          await this.uow.write((r) => r.catalogue.updateJob(jobId, { status: "CANCELLED", finishedAt: nowIso(), message: `Cancelled after ${fresh.processed} row(s). Rows already imported remain; re-run to continue.` }));
          return (await this.uow.read((r) => r.catalogue.getJob(jobId)))!;
        }
        const more = await this.uow.write(async (r) => {
          const rows = await r.catalogue.nextRows(jobId, size);
          if (!rows.length) return false;
          const w = r.catalogue.writer();
          const job = (await r.catalogue.getJob(jobId))!;
          let created = 0, updated = 0, unchanged = 0, invalid = 0;
          for (const row of rows) {
            try {
              const result = await r.catalogue.attempt(() => applyRecord(w, row.record as CatalogueRecord, { importJobId: jobId, observedAt: observed }));
              if (result.created) (created++, await r.catalogue.setRowStatus(row.id, "IMPORTED"));
              else if (result.changed) (updated++, await r.catalogue.setRowStatus(row.id, "UPDATED"));
              else (unchanged++, await r.catalogue.setRowStatus(row.id, "UNCHANGED"));
            } catch (e) {
              invalid++;
              const message = e instanceof AppError ? e.message : "The row could not be stored.";
              await r.catalogue.setRowStatus(row.id, "INVALID", [...row.warnings, `Import failed: ${message}`]);
            }
          }
          await r.catalogue.updateJob(jobId, {
            processed: job.processed + rows.length, created: job.created + created, updated: job.updated + updated, unchanged: job.unchanged + unchanged,
            invalid: job.invalid + invalid, errors: job.errors + invalid, skipped: job.skipped + invalid,
          });
          return true;
        });
        if (!more) break;
        observed = nowIso();
        await opts.afterChunk?.(++chunkNumber);
      }
      await this.uow.write(async (r) => {
        await r.catalogue.writer().linkPendingRelations();
        const job = (await r.catalogue.getJob(jobId))!;
        const c = await r.catalogue.countRows(jobId);
        const clean = job.invalid === 0 && job.warnings === 0 && c.EXCLUDED === 0;
        await r.catalogue.updateJob(jobId, {
          status: clean ? "COMPLETED" : "COMPLETED_WITH_WARNINGS", finishedAt: nowIso(),
          message: `Imported ${job.processed} row(s): ${job.created} new, ${job.updated} updated, ${job.unchanged} unchanged; ${job.skipped} skipped.`,
        });
        await r.audit.record(actor, { action: "catalogue.import.commit", entityType: "import_job", entityId: jobId, summary: `Catalogue import completed`, metadata: { created: job.created, updated: job.updated, unchanged: job.unchanged, skipped: job.skipped } });
      });
    } catch (e) {
      await this.uow.write((r) => r.catalogue.updateJob(jobId, { status: "FAILED", finishedAt: nowIso(), message: `Import stopped: ${e instanceof Error ? e.message.slice(0, 300) : "unexpected error"}. Fix the problem and run it again — rows already imported are not repeated.` }));
    }
    return (await this.uow.read((r) => r.catalogue.getJob(jobId)))!;
  }
}
