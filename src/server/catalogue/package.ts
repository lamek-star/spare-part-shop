import type { Repositories, UnitOfWork } from "../providers/uow";
import type { Actor } from "../domain/types";
import type { CatalogueWriter } from "../providers/catalogue";
import type { ImageRights, ImportJob, RelationType } from "./model";
import { imageRightsValues, relationTypes, displayableRights } from "./model";
import { CsvError, looksLikeFormula, parseCsv, type ParsedCsv } from "./csv";
import { normalizeDate, sourceKeyOf } from "./importer";
import { PackageError, sha256, type PackageSource } from "./packageSource";
import { AppError, validation } from "../kernel/errors";
import { normalizeNumber, nowIso } from "../kernel/ids";
import { parseMoney } from "../kernel/money";
import { requirePermission } from "../domain/permissions";
import { sniffImage } from "../domain/products";

/**
 * Offline catalogue packages: a folder (or one archive) holding a manifest,
 * a set of CSV tables and optional drawings. After a successful import the
 * catalogue is entirely inside this application's own storage — the source
 * folder/USB stick is never needed again.
 *
 *   manifest.json                package_format_version, package_id, provider, ...
 *   sources.csv manufacturers.csv vehicles.csv catalogues.csv parts.csv
 *   fitments.csv supersessions.csv drawings.csv drawing_parts.csv
 *   images/diagrams/*  (images/reference/* is reserved; not imported in version 1)
 *
 * Every table and every column is optional except where a row cannot make
 * sense without it. Importing is idempotent, so re-running a package (for
 * instance after an interruption) is safe and never duplicates data.
 */
export const SUPPORTED_FORMAT_VERSION = 1;
export const TABLES = [
  "sources",
  "manufacturers",
  "vehicles",
  "catalogues",
  "parts",
  "fitments",
  "supersessions",
  "drawings",
  "drawing_parts",
] as const;
export type TableName = (typeof TABLES)[number];
const MAX_DRAWING_BYTES = 64 * 1024 * 1024;

export interface PackageManifest {
  package_format_version: number;
  package_id: string;
  provider: string;
  manufacturer?: string;
  market?: string;
  catalogue?: string;
  source?: string;
  created_at?: string;
  schema_versions?: Record<string, number>;
  record_counts?: Partial<Record<TableName, number>>;
  asset_counts?: Record<string, number>;
  checksums?: Record<string, string>;
}
export interface PackageIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}
export interface PackageReport {
  manifest: PackageManifest | null;
  /** True when nothing blocks the import (row-level problems are reported but do not block). */
  ok: boolean;
  tables: Partial<
    Record<TableName, { rows: number; valid: number; invalid: number }>
  >;
  assets: { declared: number; found: number; storable: number };
  issues: PackageIssue[];
  files: string[];
}
interface Row {
  n: number;
  v: Record<string, string>;
}
interface Parsed {
  report: PackageReport;
  tables: Partial<Record<TableName, Row[]>>;
}

const squash = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const multi = (v: string) =>
  [
    ...new Set(
      v
        .split(/[;|]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function readTable(
  source: PackageSource,
  file: string,
  issues: PackageIssue[],
): ParsedCsv | null {
  if (!source.list().includes(file)) return null;
  try {
    return parseCsv(source.read(file), {
      maxBytes: 400 * 1024 * 1024,
      maxRows: 2_000_000,
    });
  } catch (e) {
    issues.push({
      level: "error",
      where: file,
      message:
        e instanceof CsvError || e instanceof PackageError
          ? e.message
          : e instanceof TypeError
            ? "The file is not valid UTF-8 text."
            : "The file could not be read.",
    });
    return null;
  }
}

export function parseManifest(
  source: PackageSource,
  issues: PackageIssue[],
): PackageManifest | null {
  if (!source.list().includes("manifest.json")) {
    issues.push({
      level: "error",
      where: "manifest.json",
      message: "The package has no manifest.json.",
    });
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        source.read("manifest.json"),
      ),
    );
  } catch {
    issues.push({
      level: "error",
      where: "manifest.json",
      message: "manifest.json is not valid JSON.",
    });
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({
      level: "error",
      where: "manifest.json",
      message: "manifest.json must be a JSON object.",
    });
    return null;
  }
  const m = raw as Record<string, unknown>;
  const err = (message: string) =>
    issues.push({ level: "error", where: "manifest.json", message });
  if (typeof m.package_format_version !== "number")
    err("package_format_version is required.");
  else if (m.package_format_version > SUPPORTED_FORMAT_VERSION)
    err(
      `This package uses format version ${m.package_format_version}; this application understands version ${SUPPORTED_FORMAT_VERSION}. Update the application before importing it.`,
    );
  else if (
    !Number.isInteger(m.package_format_version) ||
    m.package_format_version < 1
  )
    err("package_format_version is not valid.");
  for (const k of ["package_id", "provider"] as const)
    if (typeof m[k] !== "string" || !(m[k] as string).trim())
      err(`${k} is required.`);
  if (
    typeof m.package_id === "string" &&
    !/^[A-Za-z0-9._-]{1,120}$/.test(m.package_id)
  )
    err(
      "package_id may only use letters, digits, dots, dashes and underscores.",
    );
  for (const k of [
    "manufacturer",
    "market",
    "catalogue",
    "source",
    "created_at",
  ] as const)
    if (m[k] !== undefined && typeof m[k] !== "string")
      err(`${k} must be text.`);
  if (
    m.checksums !== undefined &&
    (typeof m.checksums !== "object" ||
      m.checksums === null ||
      Array.isArray(m.checksums))
  )
    err("checksums must be an object of file -> sha256.");
  if (
    m.record_counts !== undefined &&
    (typeof m.record_counts !== "object" || m.record_counts === null)
  )
    err("record_counts must be an object.");
  return issues.some((i) => i.level === "error" && i.where === "manifest.json")
    ? null
    : (m as unknown as PackageManifest);
}

/** Reads and validates the whole package without writing anything. */
export function parsePackage(source: PackageSource): Parsed {
  const issues: PackageIssue[] = [];
  const files = source.list();
  const manifest = parseManifest(source, issues);
  const report: PackageReport = {
    manifest,
    ok: false,
    tables: {},
    assets: { declared: 0, found: 0, storable: 0 },
    issues,
    files,
  };
  const tables: Partial<Record<TableName, Row[]>> = {};
  if (!manifest) return { report, tables };

  // Integrity: every checksum the manifest lists must match the bytes.
  for (const [file, expected] of Object.entries(manifest.checksums ?? {})) {
    if (!files.includes(file)) {
      issues.push({
        level: "error",
        where: file,
        message:
          "Listed in the manifest checksums but missing from the package.",
      });
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(expected)) {
      issues.push({
        level: "error",
        where: file,
        message: "The manifest checksum is not a sha256 value.",
      });
      continue;
    }
    try {
      if (sha256(source.read(file)) !== expected.toLowerCase())
        issues.push({
          level: "error",
          where: file,
          message:
            "Checksum mismatch — the file is corrupt or has been changed. The package was not imported.",
        });
    } catch (e) {
      issues.push({
        level: "error",
        where: file,
        message:
          e instanceof PackageError ? e.message : "The file could not be read.",
      });
    }
  }
  if (manifest.checksums) {
    for (const f of files)
      if (f !== "manifest.json" && !(f in manifest.checksums))
        issues.push({
          level: "warning",
          where: f,
          message:
            "Not listed in the manifest checksums, so its integrity cannot be verified.",
        });
  } else
    issues.push({
      level: "warning",
      where: "manifest.json",
      message: "No checksums supplied; file integrity could not be verified.",
    });

  for (const table of TABLES) {
    const csv = readTable(source, `${table}.csv`, issues);
    if (!csv) continue;
    const headers = csv.headers.map(squash);
    const rows: Row[] = [];
    let invalid = 0;
    for (const r of csv.rows) {
      if (r.shapeError) {
        invalid++;
        issues.push({
          level: "error",
          where: `${table}.csv line ${r.line}`,
          message: r.shapeError,
        });
        continue;
      }
      const v: Record<string, string> = {};
      headers.forEach((h, i) => (v[h] = (r.cells[i] ?? "").trim()));
      const problem = validateRow(table, v, manifest);
      if (problem) {
        invalid++;
        issues.push({
          level: "error",
          where: `${table}.csv line ${r.line}`,
          message: problem,
        });
        continue;
      }
      if (Object.values(v).some((c) => looksLikeFormula(c)))
        issues.push({
          level: "warning",
          where: `${table}.csv line ${r.line}`,
          message:
            "A cell starts like a spreadsheet formula; it is stored as plain text.",
        });
      rows.push({ n: r.line, v });
    }
    tables[table] = rows;
    report.tables[table] = {
      rows: csv.rows.length,
      valid: rows.length,
      invalid,
    };
    const declared = manifest.record_counts?.[table];
    if (declared !== undefined && declared !== csv.rows.length)
      issues.push({
        level: "error",
        where: `${table}.csv`,
        message: `The manifest declares ${declared} record(s) but the file has ${csv.rows.length}. The package may be incomplete.`,
      });
  }
  for (const t of Object.keys(manifest.record_counts ?? {}))
    if (!(TABLES as readonly string[]).includes(t))
      issues.push({
        level: "warning",
        where: "manifest.json",
        message: `record_counts lists an unknown table "${t}".`,
      });

  // Drawings: which image files exist and are real images.
  const drawingRows = tables.drawings ?? [];
  for (const d of drawingRows) {
    if (!d.v.image_file) continue;
    report.assets.declared++;
    let name: string;
    try {
      name = safeImagePath(d.v.image_file);
    } catch (e) {
      issues.push({
        level: "error",
        where: `drawings.csv line ${d.n}`,
        message: (e as Error).message,
      });
      continue;
    }
    if (!files.includes(name)) {
      issues.push({
        level: "error",
        where: `drawings.csv line ${d.n}`,
        message: `The image "${d.v.image_file}" is not in the package.`,
      });
      continue;
    }
    report.assets.found++;
    try {
      if (source.size(name) > MAX_DRAWING_BYTES)
        throw new PackageError("The image is larger than the 64 MB limit.");
      const kind = sniffImage(source.read(name));
      if (kind !== "png" && kind !== "jpeg")
        throw new PackageError("The image is not a PNG or JPEG file.");
      report.assets.storable++;
    } catch (e) {
      issues.push({
        level: "error",
        where: `drawings.csv line ${d.n}`,
        message: e instanceof Error ? e.message : "Unreadable image.",
      });
    }
  }
  const declaredAssets = manifest.asset_counts?.diagrams;
  if (declaredAssets !== undefined && declaredAssets !== report.assets.declared)
    issues.push({
      level: "error",
      where: "manifest.json",
      message: `The manifest declares ${declaredAssets} diagram image(s) but drawings.csv references ${report.assets.declared}.`,
    });
  if (!TABLES.some((t) => tables[t]?.length))
    issues.push({
      level: "error",
      where: "package",
      message:
        "The package contains no catalogue data (expected at least parts.csv or drawings.csv).",
    });

  // Problems inside a table are reported and those rows skipped; problems
  // with the package as a whole (manifest, checksums, counts, shape) block.
  // Problems inside a table row are reported and that row skipped; a problem
  // with the package as a whole (manifest, checksums, counts, unreadable
  // table) blocks the import.
  report.ok = !issues.some(
    (i) => i.level === "error" && !/ line \d+/.test(i.where),
  );
  return { report, tables };
}
function safeImagePath(name: string): string {
  const unified = name.replace(/\\/g, "/");
  if (
    unified.startsWith("/") ||
    /^[A-Za-z]:/.test(unified) ||
    unified.split("/").includes("..") ||
    unified.includes("\0")
  )
    throw new PackageError(`"${name}" is not a safe image path.`);
  return unified.replace(/^\.\//, "");
}

function validateRow(
  table: TableName,
  v: Record<string, string>,
  manifest: PackageManifest,
): string | null {
  const need = (...cols: string[]) => cols.find((c) => !v[c]);
  const tooLong = Object.entries(v).find(([, val]) => val.length > 4000);
  if (tooLong) return `${tooLong[0]} is too long.`;
  // eslint-disable-next-line no-control-regex
  if (
    Object.values(v).some((c) =>
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(c),
    )
  )
    return "A cell contains a control character.";
  const dateProblem = (...cols: string[]) =>
    cols.find((c) => v[c] && normalizeDate(v[c]) === "INVALID");
  let missing: string | undefined;
  switch (table) {
    case "sources":
      if ((missing = need("provider_key", "name")))
        return `${missing} is required.`;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(v.provider_key))
        return "provider_key may use lower-case letters, digits and hyphens.";
      return null;
    case "manufacturers":
      return need("name") ? "name is required." : null;
    case "vehicles":
      if ((missing = need("manufacturer", "model")))
        return `${missing} is required.`;
      return dateProblem("production_from", "production_to")
        ? `${dateProblem("production_from", "production_to")} is not a valid date.`
        : null;
    case "catalogues":
      if ((missing = need("code"))) return `${missing} is required.`;
      return dateProblem("production_from", "production_to")
        ? `${dateProblem("production_from", "production_to")} is not a valid date.`
        : null;
    case "parts": {
      if ((missing = need("oem_number"))) return `${missing} is required.`;
      if (!(v.manufacturer || manifest.manufacturer))
        return "manufacturer is required (or set it once in the manifest).";
      if (v.oem_number.length > 40 || !/[A-Za-z0-9]/.test(v.oem_number))
        return "oem_number is not a valid part number.";
      if (v.price_usd)
        try {
          if (parseMoney(v.price_usd) < 0)
            return "price_usd must not be negative.";
        } catch {
          return "price_usd is not a valid amount.";
        }
      if (v.price_jpy && !/^\d{1,12}$/.test(v.price_jpy.replace(/,/g, "")))
        return "price_jpy is not a valid whole amount.";
      return null;
    }
    case "fitments":
      if ((missing = need("oem_number", "model")))
        return `${missing} is required.`;
      if (!(v.manufacturer || manifest.manufacturer))
        return "manufacturer is required (or set it once in the manifest).";
      return dateProblem("production_from", "production_to")
        ? `${dateProblem("production_from", "production_to")} is not a valid date.`
        : null;
    case "supersessions":
      if ((missing = need("oem_number", "related_number")))
        return `${missing} is required.`;
      if (!(v.manufacturer || manifest.manufacturer))
        return "manufacturer is required (or set it once in the manifest).";
      if (
        v.relation &&
        !(relationTypes as readonly string[]).includes(v.relation.toUpperCase())
      )
        return `relation must be one of: ${relationTypes.join(", ")}.`;
      return null;
    case "drawings":
      if ((missing = need("code"))) return `${missing} is required.`;
      if (
        v.rights &&
        !(imageRightsValues as string[]).includes(v.rights.toUpperCase())
      )
        return `rights must be one of: ${imageRightsValues.join(", ")}.`;
      return null;
    case "drawing_parts": {
      if ((missing = need("drawing", "oem_number")))
        return `${missing} is required.`;
      if (!(v.manufacturer || manifest.manufacturer))
        return "manufacturer is required (or set it once in the manifest).";
      for (const c of ["x1", "y1", "x2", "y2"])
        if (v[c] && !Number.isFinite(Number(v[c])))
          return `${c} is not a number.`;
      const given = ["x1", "y1", "x2", "y2"].filter(
        (c) => v[c] !== undefined && v[c] !== "",
      ).length;
      if (given !== 0 && given !== 4)
        return "A hotspot needs all of x1, y1, x2 and y2 (or none of them).";
      if (
        given === 4 &&
        (Number(v.x2) < Number(v.x1) || Number(v.y2) < Number(v.y1))
      )
        return "The hotspot rectangle is inverted (x2/y2 must not be smaller than x1/y1).";
      if (v.space && !["PIXEL", "PERCENT"].includes(v.space.toUpperCase()))
        return "space must be PIXEL or PERCENT.";
      if (v.quantity && !/^\d{1,6}$/.test(v.quantity))
        return "quantity must be a whole number.";
      return null;
    }
  }
}

/** Width/height from PNG or JPEG bytes (0/null when unknown). */
export function imageSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50)
    return {
      width: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0,
      height: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0,
    };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          height: (b[i + 5] << 8) | b[i + 6],
          width: (b[i + 7] << 8) | b[i + 8],
        };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

interface Summary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}
const blank = (): Summary => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
});
const CHUNK = 500;

export class PackageImportService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Validates the package and reports what it contains. Writes nothing. */
  async preview(actor: Actor, source: PackageSource): Promise<PackageReport> {
    requirePermission(actor, "catalogue.import");
    return parsePackage(source).report;
  }

  /**
   * Imports a validated package. `imagesLicenseConfirmed` is the operator's
   * statement that this application may store and show the package's
   * drawings; without it no image bytes are stored (each drawing keeps its
   * metadata and any source URL only).
   */
  async importPackage(
    actor: Actor,
    source: PackageSource,
    opts: { imagesLicenseConfirmed?: boolean; label?: string } = {},
  ): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    const { report, tables } = parsePackage(source);
    const manifest = report.manifest;
    if (!manifest || !report.ok) {
      const job = await this.uow.write(async (r) => {
        const j = await r.catalogue.createJob({
          kind: "PACKAGE",
          providerKey: manifest ? sourceKeyOf(manifest.provider) : "unknown",
          sourceLabel: opts.label ?? manifest?.package_id ?? "package",
          status: "FAILED",
          createdBy: actor.id,
          manifest: { issues: report.issues.slice(0, 200) },
          message: `The package was rejected: ${report.issues
            .filter((i) => i.level === "error")
            .slice(0, 3)
            .map((i) => i.message)
            .join(" ")}`,
        });
        await r.catalogue.updateJob(j.id, {
          errors: report.issues.filter((i) => i.level === "error").length,
          finishedAt: nowIso(),
        });
        await r.audit.record(actor, {
          action: "catalogue.package.reject",
          entityType: "import_job",
          entityId: j.id,
          summary: `Package ${manifest?.package_id ?? ""} rejected`,
          metadata: {
            errors: report.issues.filter((i) => i.level === "error").length,
          },
        });
        return (await r.catalogue.getJob(j.id))!;
      });
      return job;
    }
    const total = TABLES.reduce((n, t) => n + (tables[t]?.length ?? 0), 0);
    const job = await this.uow.write(async (r) => {
      const j = await r.catalogue.createJob({
        kind: "PACKAGE",
        providerKey: sourceKeyOf(manifest.provider),
        sourceLabel: opts.label ?? manifest.package_id,
        status: "RUNNING",
        createdBy: actor.id,
        discovered: total,
        manifest: {
          packageId: manifest.package_id,
          formatVersion: manifest.package_format_version,
          market: manifest.market,
          catalogue: manifest.catalogue,
        },
        message: "Importing package…",
      });
      const checked = Object.values(report.tables);
      await r.catalogue.updateJob(j.id, {
        startedAt: nowIso(),
        attempts: 1,
        valid: checked.reduce((n, t) => n + (t?.valid ?? 0), 0),
        invalid: checked.reduce((n, t) => n + (t?.invalid ?? 0), 0),
      });
      return j;
    });
    const summary: Record<string, Summary> = {};
    const problems: PackageIssue[] = report.issues.filter(
      (i) => i.level === "warning" || / line \d+/.test(i.where),
    );
    let processed = 0;
    let cancelled = false;
    try {
      for (const table of TABLES) {
        const rows = tables[table];
        if (!rows?.length) continue;
        const sum = (summary[table] = blank());
        for (let i = 0; i < rows.length && !cancelled; i += CHUNK) {
          await this.uow.write(async (r) => {
            const w = r.catalogue.writer();
            for (const row of rows.slice(i, i + CHUNK)) {
              try {
                const res = await r.catalogue.attempt(() =>
                  this.applyRow(
                    r,
                    w,
                    table,
                    row,
                    manifest,
                    source,
                    job.id,
                    opts.imagesLicenseConfirmed === true,
                  ),
                );
                sum[res.outcome]++;
                for (const warning of res.warnings)
                  problems.push({
                    level: "warning",
                    where: `${table}.csv line ${row.n}`,
                    message: warning,
                  });
              } catch (e) {
                sum.skipped++;
                problems.push({
                  level: "error",
                  where: `${table}.csv line ${row.n}`,
                  message:
                    e instanceof AppError || e instanceof PackageError
                      ? e.message
                      : "The row could not be stored.",
                });
              }
            }
            processed += Math.min(CHUNK, rows.length - i);
            const c = totals(summary);
            await r.catalogue.updateJob(job.id, {
              processed,
              created: c.created,
              updated: c.updated,
              unchanged: c.unchanged,
              skipped: c.skipped,
            });
          });
          const fresh = await this.uow.read((r) => r.catalogue.getJob(job.id));
          if (fresh?.cancelRequested) cancelled = true;
        }
      }
      await this.uow.write((r) => r.catalogue.writer().linkPendingRelations());
    } catch (e) {
      return this.finish(
        actor,
        job.id,
        summary,
        problems,
        "FAILED",
        `Import stopped: ${e instanceof Error ? e.message.slice(0, 300) : "unexpected error"}. Run the same package again to continue — nothing is imported twice.`,
      );
    }
    const errors = problems.filter((p) => p.level === "error").length;
    const status: ImportJob["status"] = cancelled
      ? "CANCELLED"
      : errors || problems.length
        ? "COMPLETED_WITH_WARNINGS"
        : "COMPLETED";
    return this.finish(
      actor,
      job.id,
      summary,
      problems,
      status,
      cancelled
        ? "Cancelled part-way; run the package again to finish."
        : undefined,
    );
  }

  private async finish(
    actor: Actor,
    id: string,
    summary: Record<string, Summary>,
    problems: PackageIssue[],
    status: ImportJob["status"],
    message?: string,
  ) {
    return this.uow.write(async (r) => {
      const c = totals(summary);
      const warnings = problems.filter((p) => p.level === "warning").length;
      const errors = problems.filter((p) => p.level === "error").length;
      const current = (await r.catalogue.getJob(id))!;
      await r.catalogue.updateJob(id, {
        status,
        finishedAt: nowIso(),
        created: c.created,
        updated: c.updated,
        unchanged: c.unchanged,
        skipped: c.skipped,
        warnings,
        errors,
        manifest: {
          ...(current.manifest ?? {}),
          summary,
          issues: problems.slice(0, 300),
        },
        message:
          message ??
          `Imported: ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged, ${c.skipped} skipped${errors ? ` (${errors} problem row(s) listed)` : ""}.`,
      });
      await r.audit.record(actor, {
        action: "catalogue.package.import",
        entityType: "import_job",
        entityId: id,
        summary: `Package import ${status.toLowerCase().replace(/_/g, " ")}`,
        metadata: { ...c, warnings, errors },
      });
      return (await r.catalogue.getJob(id))!;
    });
  }

  /** Applies one validated row idempotently. */
  private async applyRow(
    r: Repositories,
    w: CatalogueWriter,
    table: TableName,
    row: Row,
    m: PackageManifest,
    source: PackageSource,
    jobId: string,
    storeImages: boolean,
  ): Promise<{ outcome: keyof Summary; warnings: string[] }> {
    const v = row.v;
    const warnings: string[] = [];
    const providerKey = sourceKeyOf(m.provider);
    const sourceOf = async (key?: string) =>
      w.ensureSource(key ? sourceKeyOf(key) : providerKey, {
        name: key || m.source || m.provider,
        type: "PACKAGE",
        manufacturer: m.manufacturer ?? "",
        market: m.market ?? "",
      });
    const maker = v.manufacturer || m.manufacturer || "";
    const observed =
      m.created_at && !Number.isNaN(Date.parse(m.created_at))
        ? new Date(m.created_at).toISOString()
        : nowIso();
    switch (table) {
      case "sources": {
        await r.catalogue.saveSource({
          providerKey: v.provider_key,
          name: v.name,
          type: v.type || "PACKAGE",
          url: v.url ?? "",
          manufacturer: v.manufacturer ?? "",
          market: v.market ?? "",
          notes: v.notes ?? "",
          licenseStatus: v.license_status || undefined,
          redistributionStatus: v.redistribution_status || undefined,
          imageUsageStatus: (imageRightsValues as string[]).includes(
            (v.image_usage_status ?? "").toUpperCase(),
          )
            ? (v.image_usage_status.toUpperCase() as ImageRights)
            : undefined,
          priority:
            v.priority && /^\d+$/.test(v.priority)
              ? Number(v.priority)
              : undefined,
        });
        return { outcome: "updated", warnings };
      }
      case "manufacturers":
        await w.ensureManufacturer(v.name);
        return { outcome: "unchanged", warnings };
      case "vehicles": {
        const model = await w.ensureModel(
          await w.ensureManufacturer(v.manufacturer),
          v.model,
        );
        const chassisList = multi(v.chassis).length ? multi(v.chassis) : [""];
        for (const chassis of chassisList)
          await w.ensureVehicle({
            modelId: model,
            generation: v.generation,
            chassis,
            frame: v.frame,
            body: v.body,
            transmission: v.transmission,
            drivetrain: v.drivetrain,
            market: v.market,
            productionFrom: nd(v.production_from),
            productionTo: nd(v.production_to),
          });
        return { outcome: "unchanged", warnings };
      }
      case "catalogues": {
        const src = await sourceOf(v.source);
        await w.ensureCatalogue({
          sourceId: src.id,
          code: v.code,
          name: v.name || v.code,
          market: v.market || m.market || "",
          productionFrom: nd(v.production_from),
          productionTo: nd(v.production_to),
        });
        return { outcome: "unchanged", warnings };
      }
      case "parts": {
        const src = await sourceOf(v.source);
        const manufacturerId = await w.ensureManufacturer(maker);
        const part = await w.upsertPart({
          manufacturerId,
          oemNumber: v.oem_number,
          pnc: v.pnc,
          partGroup: v.part_group,
        });
        const rec = await w.recordSourceRecord({
          sourceId: src.id,
          externalId:
            v.source_record_id ||
            `${m.package_id}:${normalizeNumber(v.oem_number)}`,
          entityType: "part",
          entityId: part.id,
          sourceUrl: v.source_url,
          catalogueCode: m.catalogue ?? "",
          market: m.market ?? "",
          importJobId: jobId,
          payload: v,
        });
        const fact = await w.recordFact({
          partId: part.id,
          sourceId: src.id,
          sourceRecordId: rec,
          description: v.description ?? "",
          status: v.status ?? "",
          priceUsdMinor: v.price_usd ? parseMoney(v.price_usd) : null,
          priceJpy: v.price_jpy ? Number(v.price_jpy.replace(/,/g, "")) : null,
          notes: v.notes ?? "",
          observedAt: observed,
        });
        if (fact.changed) await w.recomputeDisplay(part.id);
        await w.refreshSearch(part.id);
        return {
          outcome: part.created
            ? "created"
            : part.changed || fact.changed
              ? "updated"
              : "unchanged",
          warnings,
        };
      }
      case "fitments": {
        const found = await w.findPart(maker, normalizeNumber(v.oem_number));
        if (!found)
          throw validation(
            `Part ${v.oem_number} is not in parts.csv or the catalogue; list it there first.`,
          );
        const src = await sourceOf(v.source);
        const modelId = await w.ensureModel(
          await w.ensureManufacturer(v.make || maker),
          v.model,
        );
        const chassisList = multi(v.chassis).length ? multi(v.chassis) : [""];
        let created = false;
        for (const chassis of chassisList) {
          const vehicleId = await w.ensureVehicle({
            modelId,
            generation: v.generation,
            chassis,
            frame: v.frame,
            body: v.body,
            transmission: v.transmission,
            market: v.market || m.market,
            productionFrom: nd(v.production_from),
            productionTo: nd(v.production_to),
          });
          const code =
            v.catalogue ||
            m.catalogue ||
            `${v.model} ${v.market || m.market || ""}`.trim();
          const catalogueId = await w.ensureCatalogue({
            sourceId: src.id,
            code,
            name: code,
            vehicleId,
            market: v.market || m.market || "",
            productionFrom: nd(v.production_from),
            productionTo: nd(v.production_to),
          });
          const sectionId = v.section
            ? await w.ensureSection(
                catalogueId,
                squash(v.section) || "section",
                v.section,
              )
            : null;
          const engines = multi(v.engine)
            .map((e) => e.replace(/\s*\(.*\)\s*$/, "").trim())
            .filter(Boolean);
          const f = await w.upsertFitment({
            partId: found.id,
            vehicleId,
            catalogueId,
            sectionId,
            productionFrom: nd(v.production_from),
            productionTo: nd(v.production_to),
            market: v.market || m.market || "",
            engine: v.engine,
            engineCodes: engines,
            transmission: v.transmission,
            position: v.position,
            notes: v.notes,
          });
          created ||= f.created;
        }
        await w.refreshSearch(found.id);
        return { outcome: created ? "created" : "unchanged", warnings };
      }
      case "supersessions": {
        const found = await w.findPart(maker, normalizeNumber(v.oem_number));
        if (!found)
          throw validation(
            `Part ${v.oem_number} is not in parts.csv or the catalogue; list it there first.`,
          );
        const rel = (
          v.relation || "SUPERSEDED_BY"
        ).toUpperCase() as RelationType;
        const res = await w.upsertRelation({
          partId: found.id,
          relation: rel,
          relatedNumber: v.related_number,
          effectiveFrom: nd(v.effective_from),
          effectiveTo: nd(v.effective_to),
          notes: v.notes,
        });
        return { outcome: res.created ? "created" : "unchanged", warnings };
      }
      case "drawings": {
        const src = await sourceOf(v.source);
        const { id: drawingId, created: drawingCreated } = await w.ensureDrawing({
          sourceId: src.id,
          code: v.code,
          title: v.title || v.code,
          revision: v.revision,
          notes: v.notes,
        });
        if (v.catalogue || m.catalogue) {
          const code = v.catalogue || m.catalogue!;
          const catalogueId = await w.ensureCatalogue({
            sourceId: src.id,
            code,
            name: code,
            market: m.market ?? "",
          });
          const sectionId = v.section
            ? await w.ensureSection(
                catalogueId,
                squash(v.section) || "section",
                v.section,
              )
            : null;
          await w.linkCatalogueDrawing(catalogueId, drawingId, sectionId);
        }
        const before = await r.catalogue.getDrawing(drawingId);
        let outcome: keyof Summary = drawingCreated ? "created" : "unchanged";
        if (v.image_file) {
          const name = safeImagePath(v.image_file);
          const bytes = source.read(name);
          const digest = sha256(bytes);
          const size = imageSize(bytes);
          const mime = sniffImage(bytes) === "png" ? "image/png" : "image/jpeg";
          const rights =
            ((v.rights || "").toUpperCase() as ImageRights) ||
            "LICENSED_FOR_INTERNAL_USE";
          // A drawing imported earlier WITHOUT its image (rights not confirmed then) has a
          // metadata-only asset; confirming the rights on a later import stores the image now.
          // A drawing that already has a stored image keeps it.
          const existing = before?.assetId
            ? await r.catalogue.getAsset(before.assetId)
            : null;
          if (existing?.fileId) {
            warnings.push(
              `Drawing ${v.code} already has a stored image; the image in this package was not applied.`,
            );
          } else if (existing && !storeImages) {
            warnings.push(
              `Drawing ${v.code}: the image was not stored because image rights were not confirmed; only its metadata is kept.`,
            );
          } else if (storeImages) {
            const file = await r.files.put({
              bytes,
              originalName: name.split("/").pop() ?? "drawing",
              mime,
              kind: "CATALOGUE_DRAWING",
              entityType: "drawing",
              entityId: drawingId,
              createdBy: null,
            });
            const asset = await w.saveAsset({
              fileId: file.id,
              kind: "DIAGRAM",
              providerKey: src.providerKey,
              sourceUrl: v.source_image_url,
              mime,
              width: size?.width,
              height: size?.height,
              checksum: digest,
              rights: displayableRights.includes(rights)
                ? rights
                : "LICENSED_FOR_INTERNAL_USE",
              rightsEvidence: `Operator confirmed rights at import of package ${m.package_id}`,
              importJobId: jobId,
            });
            await w.attachAssetToDrawing(drawingId, asset);
            outcome = drawingCreated ? "created" : "updated";
          } else {
            const asset = await w.saveAsset({
              fileId: null,
              kind: "DIAGRAM",
              providerKey: src.providerKey,
              sourceUrl: v.source_image_url,
              mime,
              width: size?.width,
              height: size?.height,
              checksum: digest,
              rights: "EXTERNAL_REFERENCE",
              importJobId: jobId,
            });
            await w.attachAssetToDrawing(drawingId, asset);
            warnings.push(
              `Drawing ${v.code}: the image was not stored because image rights were not confirmed; only its metadata was kept.`,
            );
          }
        } else if (v.source_image_url && !before?.assetId) {
          const asset = await w.saveAsset({
            fileId: null,
            kind: "DIAGRAM",
            providerKey: src.providerKey,
            sourceUrl: v.source_image_url,
            rights: "EXTERNAL_REFERENCE",
            importJobId: jobId,
          });
          await w.attachAssetToDrawing(drawingId, asset);
        }
        return { outcome, warnings };
      }
      case "drawing_parts": {
        const found = await w.findPart(maker, normalizeNumber(v.oem_number));
        if (!found)
          throw validation(
            `Part ${v.oem_number} is not in parts.csv or the catalogue; list it there first.`,
          );
        const src = await sourceOf(v.source);
        const { id: drawingId } = await w.ensureDrawing({
          sourceId: src.id,
          code: v.drawing,
        });
        const rect =
          v.x1 !== undefined && v.x1 !== ""
            ? {
                x1: Number(v.x1),
                y1: Number(v.y1),
                x2: Number(v.x2),
                y2: Number(v.y2),
              }
            : null;
        const calloutId = await w.ensureCallout({
          drawingId,
          label: v.callout || v.pnc || "",
          sequence: num(v.sequence ?? "") ?? 0,
          rect,
          space: (v.space || "PIXEL").toUpperCase() as "PIXEL" | "PERCENT",
          resolved:
            v.resolved === undefined || !/^(0|false|no)$/i.test(v.resolved),
        });
        const outcome = await w.linkCalloutPart(
          calloutId,
          found.id,
          v.quantity ? Number(v.quantity) : null,
        );
        if (outcome !== "unchanged") await w.refreshSearch(found.id);
        return { outcome, warnings };
      }
    }
  }

  /** Attaches drawings from a folder of `<figure key>.png|jpg` files. */
  async importDrawingImages(
    actor: Actor,
    source: PackageSource,
    opts: { provider: string; rightsConfirmed: boolean; label?: string },
  ): Promise<ImportJob> {
    requirePermission(actor, "catalogue.import");
    if (!opts.rightsConfirmed)
      throw validation(
        "Confirm that you may store and show these drawings before importing them.",
      );
    if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.provider))
      throw validation(
        "Provider key may use lower-case letters, digits and hyphens.",
      );
    const images = new Map<string, string>();
    let duplicates = 0;
    const skipped: PackageIssue[] = [];
    for (const path of source.list()) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg"].includes(ext)) continue;
      const stem = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
      if (!stem) continue;
      if (images.has(stem)) duplicates++;
      else images.set(stem, path);
    }
    if (!images.size) throw validation("No PNG or JPEG drawings were found.");
    const job = await this.uow.write((r) =>
      r.catalogue.createJob({
        kind: "PACKAGE",
        providerKey: opts.provider,
        sourceLabel: opts.label ?? "Drawings folder",
        status: "RUNNING",
        createdBy: actor.id,
        discovered: images.size,
        message: "Importing drawings…",
      }),
    );
    const sum = blank();
    const entries = [...images.entries()];
    for (let i = 0; i < entries.length; i += 100) {
      await this.uow.write(async (r) => {
        const w = r.catalogue.writer();
        for (const [code, path] of entries.slice(i, i + 100)) {
          try {
            const outcome = await r.catalogue.attempt(async () => {
              const bytes = source.read(path);
              const kind = sniffImage(bytes);
              if (kind !== "png" && kind !== "jpeg")
                throw validation("Not a PNG/JPEG file.");
              if (bytes.length > MAX_DRAWING_BYTES)
                throw validation("Larger than the 64 MB limit.");
              const src = await w.ensureSource(opts.provider, {
                name: opts.provider,
                type: "PACKAGE",
              });
              const { id: drawingId } = await w.ensureDrawing({
                sourceId: src.id,
                code,
                title: code,
              });
              const before = await r.catalogue.getDrawing(drawingId);
              if (
                before?.assetId &&
                (await r.catalogue.getAsset(before.assetId))?.fileId
              )
                return "unchanged" as const;
              const size = imageSize(bytes);
              const mime = kind === "png" ? "image/png" : "image/jpeg";
              const file = await r.files.put({
                bytes,
                originalName: path.split("/").pop() ?? code,
                mime,
                kind: "CATALOGUE_DRAWING",
                entityType: "drawing",
                entityId: drawingId,
                createdBy: actor.id,
              });
              const asset = await w.saveAsset({
                fileId: file.id,
                kind: "DIAGRAM",
                providerKey: opts.provider,
                mime,
                width: size?.width,
                height: size?.height,
                checksum: sha256(bytes),
                rights: "LICENSED_FOR_INTERNAL_USE",
                rightsEvidence: `Operator confirmed rights at import of drawings folder "${opts.label ?? ""}"`,
                importJobId: job.id,
              });
              await w.attachAssetToDrawing(drawingId, asset);
              return "created" as const;
            });
            sum[outcome]++;
          } catch (e) {
            sum.skipped++;
            skipped.push({
              level: "error",
              where: path,
              message: e instanceof Error ? e.message : "Could not import.",
            });
          }
        }
        await r.catalogue.updateJob(job.id, {
          processed: Math.min(entries.length, i + 100),
          created: sum.created,
          unchanged: sum.unchanged,
          skipped: sum.skipped,
        });
      });
    }
    if (duplicates)
      skipped.push({
        level: "warning",
        where: "folder",
        message: `${duplicates} duplicate file name(s) were ignored (the first one found was used).`,
      });
    return this.finish(
      actor,
      job.id,
      { drawings: sum },
      skipped,
      skipped.length ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
    );
  }
}
const nd = (v: string | undefined) => {
  const d = normalizeDate(v ?? "");
  return d === "INVALID" ? null : d;
};
const totals = (s: Record<string, Summary>) =>
  Object.values(s).reduce(
    (a, x) => ({
      created: a.created + x.created,
      updated: a.updated + x.updated,
      unchanged: a.unchanged + x.unchanged,
      skipped: a.skipped + x.skipped,
    }),
    blank(),
  );
