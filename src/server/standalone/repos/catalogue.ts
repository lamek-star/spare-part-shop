import { createHash } from "node:crypto";
import type { Dialect, SqlDatabase, SqlHandle } from "../../db/connection";
import type {
  BrowseFilters,
  BrowseResult,
  CalloutView,
  CatalogueSearchQuery,
  CatalogueSource,
  CatalogueStats,
  DrawingDetail,
  DrawingRef,
  FactView,
  FitmentView,
  ImageRights,
  ImportJob,
  ImportRow,
  PartDetail,
  PartSummary,
  RelationView,
  RowStatus,
  SourceRecordView,
  StatusClass,
  Verification,
} from "../../catalogue/model";
import { displayableRights, imageRightsValues } from "../../catalogue/model";
import type { Page } from "../../domain/types";
import type {
  CatalogueRepository,
  CatalogueWriter,
} from "../../providers/catalogue";
import { newId, normalizeNumber, nowIso } from "../../kernel/ids";
import { likeTerm, mapSeq, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : String(v);
const key = (...parts: unknown[]) =>
  createHash("sha1")
    .update(parts.map((p) => String(p ?? "").toLowerCase()).join("\u0001"))
    .digest("hex");
/** The leading year of a stored production date. SQLite keeps its
 * original cast; PostgreSQL refuses to cast non-numbers, so it takes the
 * year only when the first four characters are digits (else NULL). */
const yearSql = (column: string, dialect: Dialect) =>
  dialect === "postgres"
    ? `CASE WHEN substr(${column},1,4) ~ '^[0-9]{4}$' THEN CAST(substr(${column},1,4) AS INTEGER) END`
    : `CAST(substr(${column},1,4) AS INTEGER)`;
const yearOf = (d: string | null | undefined) => {
  const y = Number((d ?? "").slice(0, 4));
  return Number.isInteger(y) && y > 1800 && y < 2200 ? y : null;
};

export function classifyStatus(text: string): StatusClass {
  const t = text.toLowerCase();
  if (!t.trim()) return "UNKNOWN";
  if (/supersed|replaced/.test(t)) return "SUPERSEDED";
  if (/discontinu|ended|obsolete|no longer|deleted|n\/a/.test(t))
    return "ENDED";
  if (/available|listed|active|current|in production|in stock/.test(t))
    return "ACTIVE";
  return "UNKNOWN";
}
const source = (r: Row): CatalogueSource => ({
  id: s(r.id),
  providerKey: s(r.provider_key),
  name: s(r.name),
  type: s(r.type),
  url: s(r.url),
  manufacturer: s(r.manufacturer),
  market: s(r.market),
  licenseStatus: s(r.license_status),
  redistributionStatus: s(r.redistribution_status),
  imageUsageStatus: r.image_usage_status as ImageRights,
  feedAvailability: s(r.feed_availability),
  notes: s(r.notes),
  priority: n(r.priority),
  active: Boolean(r.active),
  lastChecked: nn(r.last_checked),
});
const job = (r: Row): ImportJob => ({
  id: s(r.id),
  kind: r.kind as ImportJob["kind"],
  providerKey: s(r.provider_key),
  sourceLabel: s(r.source_label),
  status: r.status as ImportJob["status"],
  createdBy: nn(r.created_by),
  createdAt: s(r.created_at),
  startedAt: nn(r.started_at),
  finishedAt: nn(r.finished_at),
  discovered: n(r.discovered),
  valid: n(r.valid_count),
  invalid: n(r.invalid_count),
  duplicates: n(r.duplicate_count),
  processed: n(r.processed),
  created: n(r.created_count),
  updated: n(r.updated_count),
  unchanged: n(r.unchanged_count),
  skipped: n(r.skipped_count),
  warnings: n(r.warning_count),
  errors: n(r.error_count),
  message: s(r.message),
  cancelRequested: Boolean(r.cancel_requested),
  attempts: n(r.attempts),
  mapping: r.mapping
    ? (JSON.parse(s(r.mapping)) as ImportJob["mapping"])
    : null,
  manifest: r.manifest
    ? (JSON.parse(s(r.manifest)) as Record<string, unknown>)
    : null,
  sourceChecksum: nn(r.source_checksum),
});
const jobColumns: Record<string, string> = {
  status: "status",
  startedAt: "started_at",
  finishedAt: "finished_at",
  discovered: "discovered",
  valid: "valid_count",
  invalid: "invalid_count",
  duplicates: "duplicate_count",
  processed: "processed",
  created: "created_count",
  updated: "updated_count",
  unchanged: "unchanged_count",
  skipped: "skipped_count",
  warnings: "warning_count",
  errors: "error_count",
  message: "message",
  attempts: "attempts",
  mapping: "mapping",
  manifest: "manifest",
  sourceChecksum: "source_checksum",
  sourceLabel: "source_label",
  cancelRequested: "cancel_requested",
};

export class SqliteCatalogueRepository implements CatalogueRepository {
  constructor(private readonly db: SqlDatabase) {}
  writer(): CatalogueWriter {
    return new SqliteCatalogueWriter(this.db);
  }
  private savepoints = 0;
  async attempt<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.write(async (h) => {
      const name = `sp${++this.savepoints}`;
      await h.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await h.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        await h.exec(`ROLLBACK TO ${name}`);
        await h.exec(`RELEASE ${name}`);
        throw error;
      }
    });
  }

  /** Full-text condition over the search index for one bound query:
   * FTS5 MATCH on SQLite, a tsvector match on PostgreSQL. The query text
   * is built from letters and digits only, and bound, never pasted. */
  private textMatch(column: "document" | "sections"): string {
    if (this.db.dialect === "postgres")
      return column === "document"
        ? "p.id IN (SELECT part_id FROM catalogue_search WHERE document @@ to_tsquery('simple', ?))"
        : "p.id IN (SELECT part_id FROM catalogue_search WHERE sections_document @@ phraseto_tsquery('simple', ?))";
    return "p.rowid IN (SELECT rowid FROM catalogue_search WHERE catalogue_search MATCH ?)";
  }

  // ====================== queries ======================
  async search(q: CatalogueSearchQuery): Promise<Page<PartSummary>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize, 100);
    const where: string[] = [];
    const params: (string | number)[] = [];
    let rank = "CAST(0 AS INTEGER)";
    const rankParams: string[] = [];
    const text = (q.q ?? "").trim();
    if (text) {
      const norm = normalizeNumber(text);
      const clauses: string[] = [];
      if (norm) {
        clauses.push("p.oem_normalized = ?");
        params.push(norm);
        clauses.push("p.oem_normalized LIKE ? ESCAPE '\\'");
        params.push(norm.replace(/[\\%_]/g, (c) => "\\" + c) + "%");
        // Exact number first, then prefix, then everything else — with bound
        // parameters only, never text pasted into the SQL.
        rank =
          "CASE WHEN p.oem_normalized = ? THEN 0 WHEN p.oem_normalized LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END";
        rankParams.push(norm, norm.replace(/[\\%_]/g, (c) => "\\" + c) + "%");
      }
      const tokens = text
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .slice(0, 8);
      if (tokens.length) {
        clauses.push(this.textMatch("document"));
        params.push(
          this.db.dialect === "postgres"
            ? tokens.map((t) => `${t.toLowerCase()}:*`).join(" & ")
            : tokens.map((t) => `"${t}"*`).join(" "),
        );
      }
      where.push(clauses.length ? "(" + clauses.join(" OR ") + ")" : "1=0");
    }
    const exists = (sql: string, ...p: (string | number)[]) => {
      where.push(`EXISTS (${sql})`);
      params.push(...p);
    };
    if (q.manufacturer)
      (where.push("m.name = ? COLLATE NOCASE"), params.push(q.manufacturer));
    if (q.status) (where.push("p.status_class = ?"), params.push(q.status));
    if (q.model)
      exists(
        "SELECT 1 FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id JOIN vehicle_models vm ON vm.id = v.model_id WHERE f.part_id = p.id AND vm.name = ? COLLATE NOCASE",
        q.model,
      );
    if (q.chassis)
      exists(
        "SELECT 1 FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.part_id = p.id AND v.chassis = ? COLLATE NOCASE",
        q.chassis,
      );
    if (q.engine)
      exists(
        "SELECT 1 FROM fitments f JOIN fitment_engines fe ON fe.fitment_id = f.id WHERE f.part_id = p.id AND fe.engine_code = ? COLLATE NOCASE",
        q.engine,
      );
    if (q.market)
      exists(
        "SELECT 1 FROM fitments f WHERE f.part_id = p.id AND f.market = ? COLLATE NOCASE",
        q.market,
      );
    if (q.year)
      exists(
        `SELECT 1 FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.part_id = p.id
           AND COALESCE(${yearSql("f.production_from", this.db.dialect)}, v.year_from, 0) <= ?
           AND COALESCE(${yearSql("f.production_to", this.db.dialect)}, v.year_to, 9999) >= ?`,
        q.year,
        q.year,
      );
    if (q.section) {
      const phrase = q.section.replace(/[^\p{L}\p{N} ]/gu, "").trim();
      where.push(this.textMatch("sections"));
      params.push(
        this.db.dialect === "postgres" ? phrase : `sections : "${phrase}"`,
      );
    }
    if (q.hasDrawing)
      exists("SELECT 1 FROM callout_parts cp WHERE cp.part_id = p.id");
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read(async (h) => {
      const rows = await h.all<Row>(
        `SELECT p.id, p.oem_number, p.description, p.pnc, p.status, p.status_class, m.name AS manufacturer
           FROM catalogue_parts p JOIN manufacturers m ON m.id = p.manufacturer_id ${clause}
          ORDER BY ${rank}, m.name COLLATE NOCASE, p.oem_normalized LIMIT ? OFFSET ?`,
        [...params, ...rankParams, pageSize, offset],
      );
      const total = await h.count(
        `SELECT COUNT(*) AS n FROM catalogue_parts p JOIN manufacturers m ON m.id = p.manufacturer_id ${clause}`,
        params,
      );
      const items: PartSummary[] = await mapSeq(rows, async (r) => ({
        id: s(r.id),
        manufacturer: s(r.manufacturer),
        oemNumber: s(r.oem_number),
        description: s(r.description),
        pnc: s(r.pnc),
        status: s(r.status),
        statusClass: r.status_class as StatusClass,
        vehicles: (
          await h.all<Row>(
            `SELECT DISTINCT vm.name AS model, v.chassis FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id
               JOIN vehicle_models vm ON vm.id = v.model_id WHERE f.part_id = ? LIMIT 3`,
            [s(r.id)],
          )
        ).map((v) => [s(v.model), s(v.chassis)].filter(Boolean).join(" ")),
        drawingCount: await h.count(
          `SELECT COUNT(DISTINCT dc.drawing_id) AS n FROM callout_parts cp JOIN drawing_callouts dc ON dc.id = cp.callout_id WHERE cp.part_id = ?`,
          [s(r.id)],
        ),
        linkedProducts: [],
      }));
      return { items, total, page, pageSize };
    });
  }

  async findPartIdsByOem(oemNormalized: string): Promise<string[]> {
    return this.db.read(async (h) =>
      (
        await h.all<{ id: string }>(
          "SELECT id FROM catalogue_parts WHERE oem_normalized = ? ORDER BY created_at",
          [oemNormalized],
        )
      ).map((r) => r.id),
    );
  }

  async getPart(id: string): Promise<PartDetail | null> {
    return this.db.read(async (h) => {
      const p = await h.get<Row>(
        `SELECT p.*, m.name AS manufacturer FROM catalogue_parts p JOIN manufacturers m ON m.id = p.manufacturer_id WHERE p.id = ?`,
        [id],
      );
      if (!p) return null;
      const fitments: FitmentView[] = await mapSeq(
        await h.all<Row>(
          `SELECT f.*, v.generation, v.chassis, v.frame, v.body, v.transmission AS v_transmission, vm.name AS model, mm.name AS make,
                  c.name AS catalogue_name, sc.name AS section_name
             FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id JOIN vehicle_models vm ON vm.id = v.model_id
             JOIN manufacturers mm ON mm.id = vm.manufacturer_id LEFT JOIN catalogues c ON c.id = f.catalogue_id LEFT JOIN sections sc ON sc.id = f.section_id
            WHERE f.part_id = ? ORDER BY mm.name, vm.name, v.chassis, f.production_from`,
          [id],
        ),
        async (f) => {
          const engines = (
            await h.all<{ engine_code: string }>(
              "SELECT engine_code FROM fitment_engines WHERE fitment_id = ? ORDER BY engine_code",
              [s(f.id)],
            )
          ).map((e) => e.engine_code);
          return {
            id: s(f.id),
            vehicleId: s(f.vehicle_id),
            make: s(f.make),
            model: s(f.model),
            generation: s(f.generation),
            chassis: s(f.chassis),
            frame: s(f.frame),
            body: s(f.body),
            transmission: s(f.transmission) || s(f.v_transmission),
            engines,
            engineText: s(f.engine),
            productionFrom: nn(f.production_from),
            productionTo: nn(f.production_to),
            market: s(f.market),
            position: s(f.position),
            notes: s(f.notes),
            catalogue: s(f.catalogue_name),
            section: s(f.section_name),
            attributes: f.attributes
              ? (JSON.parse(s(f.attributes)) as FitmentView["attributes"])
              : [],
          };
        },
      );
      const catalogues = (
        await h.all<Row>(
          `SELECT DISTINCT c.id, c.code, c.name, c.market, cs.name AS source FROM fitments f JOIN catalogues c ON c.id = f.catalogue_id
             JOIN catalogue_sources cs ON cs.id = c.source_id WHERE f.part_id = ?
           UNION SELECT DISTINCT c.id, c.code, c.name, c.market, cs.name FROM callout_parts cp JOIN drawing_callouts dc ON dc.id = cp.callout_id
             JOIN catalogue_drawings cd ON cd.drawing_id = dc.drawing_id JOIN catalogues c ON c.id = cd.catalogue_id
             JOIN catalogue_sources cs ON cs.id = c.source_id WHERE cp.part_id = ?`,
          [id, id],
        )
      ).map((c) => ({
        id: s(c.id),
        code: s(c.code),
        name: s(c.name),
        source: s(c.source),
        market: s(c.market),
      }));
      const drawings: DrawingRef[] = (
        await h.all<Row>(
          `SELECT d.id, d.code, d.title, dc.label, d.asset_id,
                  COALESCE((SELECT c.name FROM catalogue_drawings cd JOIN catalogues c ON c.id = cd.catalogue_id WHERE cd.drawing_id = d.id LIMIT 1), '') AS catalogue,
                  COALESCE((SELECT sc.name FROM catalogue_drawings cd JOIN sections sc ON sc.id = cd.section_id WHERE cd.drawing_id = d.id LIMIT 1), '') AS section
             FROM callout_parts cp JOIN drawing_callouts dc ON dc.id = cp.callout_id JOIN drawings d ON d.id = dc.drawing_id
            WHERE cp.part_id = ? ORDER BY d.code`,
          [id],
        )
      ).map((d) => ({
        drawingId: s(d.id),
        code: s(d.code),
        title: s(d.title),
        callout: s(d.label),
        catalogue: s(d.catalogue),
        section: s(d.section),
        hasImage: d.asset_id !== null,
      }));
      const relations: RelationView[] = [
        ...(
          await h.all<Row>(
            "SELECT * FROM part_relations WHERE part_id = ? ORDER BY relation, related_number",
            [id],
          )
        ).map((r): RelationView => ({
          id: s(r.id),
          relation: r.relation as RelationView["relation"],
          relatedNumber: s(r.related_number),
          relatedPartId: nn(r.related_part_id),
          effectiveFrom: nn(r.effective_from),
          effectiveTo: nn(r.effective_to),
          notes: s(r.notes),
          direction: "out",
        })),
        ...(
          await h.all<Row>(
            `SELECT r.*, p2.oem_number AS from_number FROM part_relations r JOIN catalogue_parts p2 ON p2.id = r.part_id WHERE r.related_part_id = ? ORDER BY r.relation`,
            [id],
          )
        ).map((r): RelationView => ({
          id: s(r.id),
          relation: r.relation as RelationView["relation"],
          relatedNumber: s(r.from_number),
          relatedPartId: s(r.part_id),
          effectiveFrom: nn(r.effective_from),
          effectiveTo: nn(r.effective_to),
          notes: s(r.notes),
          direction: "in",
        })),
      ];
      const facts: FactView[] = (
        await h.all<Row>(
          `SELECT f.*, cs.name AS source, cs.provider_key FROM part_facts f JOIN catalogue_sources cs ON cs.id = f.source_id
            WHERE f.part_id = ? ORDER BY cs.priority, f.observed_at, f.id`,
          [id],
        )
      ).map((f) => ({
        id: s(f.id),
        source: s(f.source),
        sourceKey: s(f.provider_key),
        description: s(f.description),
        status: s(f.status),
        priceUsdMinor: f.price_usd_minor === null ? null : n(f.price_usd_minor),
        priceJpy: f.price_jpy === null ? null : n(f.price_jpy),
        notes: s(f.notes),
        observedAt: s(f.observed_at),
      }));
      const sources: SourceRecordView[] = (
        await h.all<Row>(
          `SELECT sr.*, cs.name AS source, cs.provider_key FROM source_records sr JOIN catalogue_sources cs ON cs.id = sr.source_id
            WHERE sr.entity_type = 'part' AND sr.entity_id = ? ORDER BY sr.imported_at DESC LIMIT 50`,
          [id],
        )
      ).map((r) => ({
        id: s(r.id),
        source: s(r.source),
        sourceKey: s(r.provider_key),
        externalId: s(r.external_id),
        sourceUrl: s(r.source_url),
        catalogueCode: s(r.catalogue_code),
        market: s(r.market),
        importJobId: nn(r.import_job_id),
        importedAt: s(r.imported_at),
        sourceUpdatedAt: nn(r.source_updated_at),
      }));
      return {
        id: s(p.id),
        manufacturer: s(p.manufacturer),
        oemNumber: s(p.oem_number),
        description: s(p.description),
        pnc: s(p.pnc),
        partGroup: s(p.part_group),
        status: s(p.status),
        statusClass: p.status_class as StatusClass,
        notes: s(p.notes),
        verification: p.verification as Verification,
        version: n(p.version),
        createdAt: s(p.created_at),
        updatedAt: s(p.updated_at),
        fitments,
        catalogues,
        drawings,
        relations,
        facts,
        sources,
        linkedProducts: [],
      };
    });
  }

  async getDrawing(id: string): Promise<DrawingDetail | null> {
    return this.db.read(async (h) => {
      const d = await h.get<Row>(
        `SELECT d.*, cs.name AS source, cs.provider_key, a.file_id, a.rights, a.rights_evidence, a.source_url, a.width, a.height
           FROM drawings d JOIN catalogue_sources cs ON cs.id = d.source_id LEFT JOIN assets a ON a.id = d.asset_id WHERE d.id = ?`,
        [id],
      );
      if (!d) return null;
      const rights = (d.rights ?? "EXTERNAL_REFERENCE") as ImageRights;
      const callouts: CalloutView[] = await mapSeq(
        await h.all<Row>(
          "SELECT * FROM drawing_callouts WHERE drawing_id = ? ORDER BY sequence, label",
          [id],
        ),
        async (c) => ({
          id: s(c.id),
          label: s(c.label),
          sequence: n(c.sequence),
          rect:
            c.x1 === null
              ? null
              : { x1: n(c.x1), y1: n(c.y1), x2: n(c.x2), y2: n(c.y2) },
          space: c.space as "PIXEL" | "PERCENT",
          resolved: Boolean(c.resolved),
          notes: s(c.notes),
          parts: (
            await h.all<Row>(
              `SELECT p.id, p.oem_number, p.description, p.status_class, cp.quantity FROM callout_parts cp JOIN catalogue_parts p ON p.id = cp.part_id
                WHERE cp.callout_id = ? ORDER BY p.oem_normalized`,
              [s(c.id)],
            )
          ).map((p) => ({
            id: s(p.id),
            oemNumber: s(p.oem_number),
            description: s(p.description),
            quantity: p.quantity === null ? null : n(p.quantity),
            statusClass: p.status_class as StatusClass,
          })),
        }),
      );
      return {
        id: s(d.id),
        code: s(d.code),
        title: s(d.title),
        revision: s(d.revision),
        notes: s(d.notes),
        source: s(d.source),
        sourceKey: s(d.provider_key),
        catalogues: (
          await h.all<{ name: string }>(
            "SELECT c.name FROM catalogue_drawings cd JOIN catalogues c ON c.id = cd.catalogue_id WHERE cd.drawing_id = ?",
            [id],
          )
        ).map((c) => c.name),
        assetId: nn(d.asset_id),
        width: d.width === null || d.width === undefined ? null : n(d.width),
        height:
          d.height === null || d.height === undefined ? null : n(d.height),
        rights,
        rightsEvidence: s(d.rights_evidence),
        imageAvailable:
          d.file_id !== null &&
          d.file_id !== undefined &&
          displayableRights.includes(rights),
        sourceImageUrl: s(d.source_url),
        callouts,
      };
    });
  }

  async browse(f: BrowseFilters): Promise<BrowseResult> {
    return this.db.read(async (h) => {
      const manufacturers = (
        await h.all<Row>(
          `SELECT m.id, m.name, (SELECT COUNT(*) FROM catalogue_parts p WHERE p.manufacturer_id = m.id) AS parts FROM manufacturers m ORDER BY m.name COLLATE NOCASE LIMIT 200`,
        )
      ).map((r) => ({ id: s(r.id), name: s(r.name), parts: n(r.parts) }));
      const models = (
        await h.all<Row>(
          `SELECT vm.id, vm.manufacturer_id, vm.name FROM vehicle_models vm JOIN manufacturers m ON m.id = vm.manufacturer_id
            ${f.manufacturer ? "WHERE m.name = ? COLLATE NOCASE" : ""} ORDER BY vm.name COLLATE NOCASE LIMIT 500`,
          f.manufacturer ? [f.manufacturer] : [],
        )
      ).map((r) => ({
        id: s(r.id),
        manufacturerId: s(r.manufacturer_id),
        name: s(r.name),
      }));
      const vw: string[] = [];
      const vp: string[] = [];
      if (f.manufacturer)
        (vw.push("m.name = ? COLLATE NOCASE"), vp.push(f.manufacturer));
      if (f.model) (vw.push("vm.name = ? COLLATE NOCASE"), vp.push(f.model));
      const vehicles = (
        await h.all<Row>(
          `SELECT v.*, vm.name AS model FROM vehicles v JOIN vehicle_models vm ON vm.id = v.model_id JOIN manufacturers m ON m.id = vm.manufacturer_id
            ${vw.length ? "WHERE " + vw.join(" AND ") : ""} ORDER BY vm.name, v.chassis LIMIT 500`,
          vp,
        )
      ).map((v) => ({
        id: s(v.id),
        modelId: s(v.model_id),
        label: [s(v.model), s(v.chassis), s(v.generation)]
          .filter(Boolean)
          .join(" "),
        chassis: s(v.chassis),
        market: s(v.market),
        productionFrom: nn(v.production_from),
        productionTo: nn(v.production_to),
      }));
      const engines = (
        await h.all<{ engine_code: string }>(
          "SELECT engine_code FROM fitment_engines GROUP BY engine_code ORDER BY engine_code COLLATE NOCASE LIMIT 500",
        )
      ).map((e) => e.engine_code);
      const markets = (
        await h.all<{ market: string }>(
          "SELECT DISTINCT market FROM fitments WHERE market <> '' ORDER BY market LIMIT 100",
        )
      ).map((m) => m.market);
      const sections = (
        await h.all<Row>(
          "SELECT id, catalogue_id, code, name FROM sections ORDER BY name COLLATE NOCASE LIMIT 500",
        )
      ).map((r) => ({
        id: s(r.id),
        catalogueId: s(r.catalogue_id),
        code: s(r.code),
        name: s(r.name),
      }));
      return { manufacturers, models, vehicles, engines, markets, sections };
    });
  }

  async stats(): Promise<CatalogueStats> {
    return this.db.read(async (h) => ({
      manufacturers: await h.count("SELECT COUNT(*) AS n FROM manufacturers"),
      parts: await h.count("SELECT COUNT(*) AS n FROM catalogue_parts"),
      vehicles: await h.count("SELECT COUNT(*) AS n FROM vehicles"),
      fitments: await h.count("SELECT COUNT(*) AS n FROM fitments"),
      drawings: await h.count("SELECT COUNT(*) AS n FROM drawings"),
      drawingsWithImages: await h.count(
        "SELECT COUNT(*) AS n FROM drawings d JOIN assets a ON a.id = d.asset_id WHERE a.file_id IS NOT NULL",
      ),
      callouts: await h.count("SELECT COUNT(*) AS n FROM drawing_callouts"),
      relations: await h.count("SELECT COUNT(*) AS n FROM part_relations"),
      sources: await h.count("SELECT COUNT(*) AS n FROM catalogue_sources"),
      importJobs: await h.count("SELECT COUNT(*) AS n FROM import_jobs"),
    }));
  }

  // ====================== governance ======================
  listSources() {
    return this.db.read(async (h) =>
      (
        await h.all<Row>(
          "SELECT * FROM catalogue_sources ORDER BY priority, name",
        )
      ).map(source),
    );
  }
  async saveSource(
    x: Partial<CatalogueSource> & { providerKey: string; name: string },
  ): Promise<CatalogueSource> {
    return this.db.write(async (h) => {
      const existing = await h.get<Row>(
        "SELECT * FROM catalogue_sources WHERE provider_key = ?",
        [x.providerKey],
      );
      if (existing) {
        await h.run(
          `UPDATE catalogue_sources SET name=?, type=?, url=?, manufacturer=?, market=?, license_status=?, redistribution_status=?, image_usage_status=?, feed_availability=?, notes=?, priority=?, active=?, last_checked=? WHERE provider_key=?`,
          [
            x.name,
            x.type ?? s(existing.type),
            x.url ?? s(existing.url),
            x.manufacturer ?? s(existing.manufacturer),
            x.market ?? s(existing.market),
            x.licenseStatus ?? s(existing.license_status),
            x.redistributionStatus ?? s(existing.redistribution_status),
            x.imageUsageStatus ?? s(existing.image_usage_status),
            x.feedAvailability ?? s(existing.feed_availability),
            x.notes ?? s(existing.notes),
            x.priority ?? n(existing.priority),
            x.active ?? Boolean(existing.active),
            x.lastChecked ?? nn(existing.last_checked),
            x.providerKey,
          ],
        );
      } else {
        await h.run(
          `INSERT INTO catalogue_sources(id,provider_key,name,type,url,manufacturer,market,license_status,redistribution_status,image_usage_status,feed_availability,notes,priority,active,last_checked)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newId(),
            x.providerKey,
            x.name,
            x.type ?? "OTHER",
            x.url ?? "",
            x.manufacturer ?? "",
            x.market ?? "",
            x.licenseStatus ?? "UNVERIFIED",
            x.redistributionStatus ?? "UNKNOWN",
            x.imageUsageStatus ?? "LICENSE_UNKNOWN",
            x.feedAvailability ?? "",
            x.notes ?? "",
            x.priority ?? 100,
            x.active ?? true,
            x.lastChecked ?? null,
          ],
        );
      }
      return source(
        (await h.get<Row>(
          "SELECT * FROM catalogue_sources WHERE provider_key = ?",
          [x.providerKey],
        ))!,
      );
    });
  }
  async setVerification(partId: string, v: Verification) {
    await this.db.write(async (h) =>
      h.run(
        "UPDATE catalogue_parts SET verification = ?, version = version + 1, updated_at = ? WHERE id = ?",
        [v, nowIso(), partId],
      ),
    );
  }
  async getAsset(id: string) {
    const r = await this.db.read(async (h) =>
      h.get<Row>("SELECT * FROM assets WHERE id = ?", [id]),
    );
    return r
      ? {
          id: s(r.id),
          fileId: nn(r.file_id),
          mime: s(r.mime),
          rights: r.rights as ImageRights,
          sourceUrl: s(r.source_url),
        }
      : null;
  }
  async setAssetRights(assetId: string, rights: ImageRights, evidence: string) {
    if (!imageRightsValues.includes(rights)) return false;
    return this.db.write(
      async (h) =>
        (
          await h.run(
            "UPDATE assets SET rights = ?, rights_evidence = ?, rights_reviewed_at = ? WHERE id = ?",
            [rights, evidence, nowIso(), assetId],
          )
        ).changes > 0,
    );
  }
  async listAssets(page: number, pageSize: number) {
    const a = pageArgs(page, pageSize, 200);
    return this.db.read(async (h) => ({
      items: (
        await h.all<Row>(
          `SELECT a.id, a.rights, a.file_id, a.source_url, a.rights_evidence, COALESCE(d.code, '') AS code FROM assets a LEFT JOIN drawings d ON d.asset_id = a.id
            ORDER BY d.code LIMIT ? OFFSET ?`,
          [a.pageSize, a.offset],
        )
      ).map((r) => ({
        id: s(r.id),
        drawingCode: s(r.code),
        rights: r.rights as ImageRights,
        hasFile: r.file_id !== null,
        sourceUrl: s(r.source_url),
        rightsEvidence: s(r.rights_evidence),
      })),
      total: await h.count("SELECT COUNT(*) AS n FROM assets"),
      page: a.page,
      pageSize: a.pageSize,
    }));
  }

  // ====================== import jobs ======================
  async createJob(
    j: Partial<ImportJob> & { kind: ImportJob["kind"]; providerKey: string },
  ): Promise<ImportJob> {
    const id = newId();
    await this.db.write(async (h) =>
      h.run(
        `INSERT INTO import_jobs(id,kind,provider_key,source_label,status,created_by,created_at,mapping,manifest,source_checksum,message,discovered,valid_count,invalid_count,duplicate_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          j.kind,
          j.providerKey,
          j.sourceLabel ?? "",
          j.status ?? "PENDING",
          j.createdBy ?? null,
          nowIso(),
          j.mapping ? JSON.stringify(j.mapping) : null,
          j.manifest ? JSON.stringify(j.manifest) : null,
          j.sourceChecksum ?? null,
          j.message ?? "",
          j.discovered ?? 0,
          j.valid ?? 0,
          j.invalid ?? 0,
          j.duplicates ?? 0,
        ],
      ),
    );
    return (await this.getJob(id))!;
  }
  async getJob(id: string) {
    const r = await this.db.read(async (h) =>
      h.get<Row>("SELECT * FROM import_jobs WHERE id = ?", [id]),
    );
    return r ? job(r) : null;
  }
  listJobs(limit: number) {
    return this.db.read(async (h) =>
      (
        await h.all<Row>(
          "SELECT * FROM import_jobs ORDER BY created_at DESC, id LIMIT ?",
          [Math.max(1, Math.min(200, limit))],
        )
      ).map(job),
    );
  }
  async updateJob(id: string, patch: Partial<ImportJob>) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const column = jobColumns[k];
      if (!column) continue;
      sets.push(`${column} = ?`);
      params.push(
        k === "mapping" || k === "manifest"
          ? v === null
            ? null
            : JSON.stringify(v)
          : (v as string | number | null),
      );
    }
    if (!sets.length) return;
    await this.db.write(async (h) =>
      h.run(`UPDATE import_jobs SET ${sets.join(", ")} WHERE id = ?`, [
        ...params,
        id,
      ]),
    );
  }
  async requestCancel(id: string) {
    return this.db.write(
      async (h) =>
        (
          await h.run(
            "UPDATE import_jobs SET cancel_requested = 1 WHERE id = ? AND status IN ('PENDING','REVIEW_REQUIRED','RUNNING')",
            [id],
          )
        ).changes > 0,
    );
  }
  async insertRows(jobId: string, rows: Omit<ImportRow, "id">[]) {
    await this.db.write(async (h) => {
      for (const r of rows)
        await h.run(
          "INSERT INTO import_job_rows(id,job_id,row_number,status,action,identity,errors,warnings,record) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            newId(),
            jobId,
            r.rowNumber,
            r.status,
            r.action,
            r.identity,
            JSON.stringify(r.errors),
            JSON.stringify(r.warnings),
            JSON.stringify(r.record),
          ],
        );
    });
  }
  private rowFrom(r: Row): ImportRow {
    return {
      id: s(r.id),
      rowNumber: n(r.row_number),
      status: r.status as RowStatus,
      action: r.action as ImportRow["action"],
      identity: s(r.identity),
      errors: JSON.parse(s(r.errors)) as string[],
      warnings: JSON.parse(s(r.warnings)) as string[],
      record: JSON.parse(s(r.record)) as ImportRow["record"],
    };
  }
  async listRows(
    jobId: string,
    opts: { status?: RowStatus; page: number; pageSize: number },
  ): Promise<Page<ImportRow>> {
    const a = pageArgs(opts.page, opts.pageSize, 200);
    const where = opts.status ? "AND status = ?" : "";
    const params = opts.status ? [jobId, opts.status] : [jobId];
    return this.db.read(async (h) => ({
      items: (
        await h.all<Row>(
          `SELECT * FROM import_job_rows WHERE job_id = ? ${where} ORDER BY row_number LIMIT ? OFFSET ?`,
          [...params, a.pageSize, a.offset],
        )
      ).map((r) => this.rowFrom(r)),
      total: await h.count(
        `SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = ? ${where}`,
        params,
      ),
      page: a.page,
      pageSize: a.pageSize,
    }));
  }
  async nextRows(jobId: string, limit: number) {
    return this.db.read(async (h) =>
      (
        await h.all<Row>(
          "SELECT * FROM import_job_rows WHERE job_id = ? AND status = 'VALID' ORDER BY row_number LIMIT ?",
          [jobId, limit],
        )
      ).map((r) => this.rowFrom(r)),
    );
  }
  async setRowStatus(rowId: string, status: RowStatus, warnings?: string[]) {
    await this.db.write(async (h) =>
      warnings
        ? await h.run(
            "UPDATE import_job_rows SET status = ?, warnings = ? WHERE id = ?",
            [status, JSON.stringify(warnings), rowId],
          )
        : await h.run("UPDATE import_job_rows SET status = ? WHERE id = ?", [
            status,
            rowId,
          ]),
    );
  }
  async setRowExcluded(jobId: string, rowId: string, excluded: boolean) {
    return this.db.write(async (h) => {
      const from = excluded ? "VALID" : "EXCLUDED";
      const to = excluded ? "EXCLUDED" : "VALID";
      return (
        (
          await h.run(
            "UPDATE import_job_rows SET status = ? WHERE id = ? AND job_id = ? AND status = ?",
            [to, rowId, jobId, from],
          )
        ).changes > 0
      );
    });
  }
  async countRows(jobId: string): Promise<Record<RowStatus, number>> {
    const base = {
      VALID: 0,
      INVALID: 0,
      DUPLICATE: 0,
      CONFLICT: 0,
      EXCLUDED: 0,
      IMPORTED: 0,
      UPDATED: 0,
      UNCHANGED: 0,
    } as Record<RowStatus, number>;
    return this.db.read(async (h) => {
      for (const r of await h.all<{ status: RowStatus; n: number }>(
        "SELECT status, COUNT(*) AS n FROM import_job_rows WHERE job_id = ? GROUP BY status",
        [jobId],
      ))
        base[r.status] = r.n;
      return base;
    });
  }
  async purgeRows(jobId: string) {
    await this.db.write(async (h) =>
      h.run("DELETE FROM import_job_rows WHERE job_id = ?", [jobId]),
    );
  }
}

// =====================================================================
// Writer: every method is an idempotent upsert, so re-running an import
// (or resuming a failed one) can never duplicate a manufacturer, vehicle,
// part, fitment, relation, drawing or callout.
// =====================================================================
class SqliteCatalogueWriter implements CatalogueWriter {
  constructor(private readonly db: SqlDatabase) {}

  async ensureSource(
    providerKey: string,
    defaults: Partial<Omit<CatalogueSource, "id" | "providerKey">> = {},
  ) {
    return this.db.write(async (h) => {
      let r = await h.get<Row>(
        "SELECT * FROM catalogue_sources WHERE provider_key = ?",
        [providerKey],
      );
      if (!r) {
        await h.run(
          `INSERT INTO catalogue_sources(id,provider_key,name,type,url,manufacturer,market,license_status,redistribution_status,image_usage_status,feed_availability,notes,priority,active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          [
            newId(),
            providerKey,
            defaults.name ?? providerKey,
            defaults.type ?? "CSV",
            defaults.url ?? "",
            defaults.manufacturer ?? "",
            defaults.market ?? "",
            defaults.licenseStatus ?? "UNVERIFIED",
            defaults.redistributionStatus ?? "UNKNOWN",
            defaults.imageUsageStatus ?? "LICENSE_UNKNOWN",
            defaults.feedAvailability ?? "",
            defaults.notes ?? "",
            defaults.priority ?? 100,
          ],
        );
        r = (await h.get<Row>(
          "SELECT * FROM catalogue_sources WHERE provider_key = ?",
          [providerKey],
        ))!;
      }
      return source(r);
    });
  }
  async ensureManufacturer(name: string) {
    const clean = name.trim();
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM manufacturers WHERE name = ? COLLATE NOCASE",
        [clean],
      );
      if (r) return r.id;
      const id = newId();
      await h.run("INSERT INTO manufacturers(id,name) VALUES (?,?)", [
        id,
        clean,
      ]);
      return id;
    });
  }
  async ensureModel(manufacturerId: string, name: string) {
    const clean = name.trim();
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM vehicle_models WHERE manufacturer_id = ? AND name = ? COLLATE NOCASE",
        [manufacturerId, clean],
      );
      if (r) return r.id;
      const id = newId();
      await h.run(
        "INSERT INTO vehicle_models(id,manufacturer_id,name) VALUES (?,?,?)",
        [id, manufacturerId, clean],
      );
      return id;
    });
  }
  async ensureVehicle(v: Parameters<CatalogueWriter["ensureVehicle"]>[0]) {
    const vehicleKey = key(
      v.modelId,
      v.generation,
      v.chassis,
      v.frame,
      v.body,
      v.transmission,
      v.market,
      v.productionFrom,
      v.productionTo,
    );
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM vehicles WHERE vehicle_key = ?",
        [vehicleKey],
      );
      if (r) return r.id;
      const id = newId();
      await h.run(
        `INSERT INTO vehicles(id,vehicle_key,model_id,generation,chassis,frame,engine,transmission,drivetrain,body,market,production_from,production_to,year_from,year_to,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          vehicleKey,
          v.modelId,
          v.generation ?? "",
          v.chassis ?? "",
          v.frame ?? "",
          v.engine ?? "",
          v.transmission ?? "",
          v.drivetrain ?? "",
          v.body ?? "",
          v.market ?? "",
          v.productionFrom ?? null,
          v.productionTo ?? null,
          yearOf(v.productionFrom),
          yearOf(v.productionTo),
          v.notes ?? "",
        ],
      );
      return id;
    });
  }
  async ensureCatalogue(c: Parameters<CatalogueWriter["ensureCatalogue"]>[0]) {
    // A catalogue covers every vehicle (chassis code) it lists; the vehicle
    // recorded here is only the first one seen.
    const catalogueKey = key(c.sourceId, c.code, c.market ?? "");
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM catalogues WHERE catalogue_key = ?",
        [catalogueKey],
      );
      if (r) return r.id;
      const id = newId();
      await h.run(
        "INSERT INTO catalogues(id,catalogue_key,source_id,vehicle_id,code,name,market,production_from,production_to) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          id,
          catalogueKey,
          c.sourceId,
          c.vehicleId ?? null,
          c.code,
          c.name,
          c.market ?? "",
          c.productionFrom ?? null,
          c.productionTo ?? null,
        ],
      );
      return id;
    });
  }
  async ensureSection(catalogueId: string, code: string, name: string) {
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM sections WHERE catalogue_id = ? AND code = ?",
        [catalogueId, code],
      );
      if (r) return r.id;
      const id = newId();
      await h.run(
        "INSERT INTO sections(id,catalogue_id,code,name,position) VALUES (?,?,?,?,?)",
        [
          id,
          catalogueId,
          code,
          name,
          await h.count(
            "SELECT COUNT(*) AS n FROM sections WHERE catalogue_id = ?",
            [catalogueId],
          ),
        ],
      );
      return id;
    });
  }
  async upsertPart(p: Parameters<CatalogueWriter["upsertPart"]>[0]) {
    const normalized = normalizeNumber(p.oemNumber);
    return this.db.write(async (h) => {
      const existing = await h.get<Row>(
        "SELECT * FROM catalogue_parts WHERE manufacturer_id = ? AND oem_normalized = ?",
        [p.manufacturerId, normalized],
      );
      const now = nowIso();
      if (!existing) {
        const id = newId();
        await h.run(
          `INSERT INTO catalogue_parts(id,manufacturer_id,oem_number,oem_normalized,pnc,part_group,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            id,
            p.manufacturerId,
            p.oemNumber.trim(),
            normalized,
            p.pnc ?? "",
            p.partGroup ?? "",
            p.notes ?? "",
            now,
            now,
          ],
        );
        return { id, created: true, changed: true };
      }
      // Fill gaps only; never overwrite a value another import supplied.
      const pnc = s(existing.pnc) || (p.pnc ?? "");
      const group = s(existing.part_group) || (p.partGroup ?? "");
      const notes = s(existing.notes) || (p.notes ?? "");
      const changed =
        pnc !== s(existing.pnc) ||
        group !== s(existing.part_group) ||
        notes !== s(existing.notes);
      if (changed)
        await h.run(
          "UPDATE catalogue_parts SET pnc=?, part_group=?, notes=?, version = version + 1, updated_at=? WHERE id=?",
          [pnc, group, notes, now, s(existing.id)],
        );
      return { id: s(existing.id), created: false, changed };
    });
  }
  async recordFact(f: Parameters<CatalogueWriter["recordFact"]>[0]) {
    return this.db.write(async (h) => {
      const existing = await h.get<Row>(
        "SELECT * FROM part_facts WHERE part_id = ? AND source_id = ? AND description = ?",
        [f.partId, f.sourceId, f.description],
      );
      if (!existing) {
        await h.run(
          `INSERT INTO part_facts(id,part_id,source_id,source_record_id,description,status,price_usd_minor,price_jpy,notes,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            newId(),
            f.partId,
            f.sourceId,
            f.sourceRecordId ?? null,
            f.description,
            f.status,
            f.priceUsdMinor ?? null,
            f.priceJpy ?? null,
            f.notes ?? "",
            f.observedAt,
          ],
        );
        return { created: true, changed: true };
      }
      const usd =
        f.priceUsdMinor ??
        (existing.price_usd_minor === null
          ? null
          : n(existing.price_usd_minor));
      const jpy =
        f.priceJpy ??
        (existing.price_jpy === null ? null : n(existing.price_jpy));
      const status = f.status || s(existing.status);
      const notes = f.notes || s(existing.notes);
      const changed =
        usd !==
          (existing.price_usd_minor === null
            ? null
            : n(existing.price_usd_minor)) ||
        jpy !== (existing.price_jpy === null ? null : n(existing.price_jpy)) ||
        status !== s(existing.status) ||
        notes !== s(existing.notes);
      if (changed)
        await h.run(
          "UPDATE part_facts SET price_usd_minor=?, price_jpy=?, status=?, notes=?, source_record_id=COALESCE(?, source_record_id) WHERE id=?",
          [usd, jpy, status, notes, f.sourceRecordId ?? null, s(existing.id)],
        );
      return { created: false, changed };
    });
  }
  async upsertFitment(f: Parameters<CatalogueWriter["upsertFitment"]>[0]) {
    const fitmentKey = key(
      f.partId,
      f.vehicleId,
      f.catalogueId ?? "",
      f.sectionId ?? "",
      f.productionFrom,
      f.productionTo,
      f.market,
      f.engine,
    );
    return this.db.write(async (h) => {
      let r = await h.get<{ id: string }>(
        "SELECT id FROM fitments WHERE fitment_key = ?",
        [fitmentKey],
      );
      let created = false;
      if (!r) {
        const id = newId();
        await h.run(
          `INSERT INTO fitments(id,fitment_key,part_id,vehicle_id,catalogue_id,section_id,production_from,production_to,market,engine,transmission,position,notes,attributes,source_record_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            fitmentKey,
            f.partId,
            f.vehicleId,
            f.catalogueId ?? null,
            f.sectionId ?? null,
            f.productionFrom ?? null,
            f.productionTo ?? null,
            f.market ?? "",
            f.engine ?? "",
            f.transmission ?? "",
            f.position ?? "",
            f.notes ?? "",
            f.attributes ? JSON.stringify(f.attributes) : null,
            f.sourceRecordId ?? null,
          ],
        );
        r = { id };
        created = true;
      }
      for (const code of f.engineCodes ?? [])
        if (code.trim())
          await h.run(
            "INSERT INTO fitment_engines(fitment_id, engine_code) VALUES (?,?) ON CONFLICT DO NOTHING",
            [r.id, code.trim()],
          );
      return { id: r.id, created };
    });
  }
  async upsertRelation(r: Parameters<CatalogueWriter["upsertRelation"]>[0]) {
    const normalized = normalizeNumber(r.relatedNumber);
    if (!normalized) return { created: false };
    return this.db.write(async (h) => {
      const exists = await h.get(
        "SELECT 1 AS x FROM part_relations WHERE part_id = ? AND relation = ? AND related_normalized = ?",
        [r.partId, r.relation, normalized],
      );
      if (exists) return { created: false };
      const related = await h.get<{ id: string }>(
        `SELECT p2.id FROM catalogue_parts p1 JOIN catalogue_parts p2 ON p2.oem_normalized = ? AND p2.manufacturer_id = p1.manufacturer_id WHERE p1.id = ?`,
        [normalized, r.partId],
      );
      await h.run(
        `INSERT INTO part_relations(id,part_id,relation,related_number,related_normalized,related_part_id,effective_from,effective_to,notes,source_record_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          newId(),
          r.partId,
          r.relation,
          r.relatedNumber.trim(),
          normalized,
          related?.id ?? null,
          r.effectiveFrom ?? null,
          r.effectiveTo ?? null,
          r.notes ?? "",
          r.sourceRecordId ?? null,
        ],
      );
      return { created: true };
    });
  }
  async ensureDrawing(d: Parameters<CatalogueWriter["ensureDrawing"]>[0]) {
    return this.db.write(async (h) => {
      const r = await h.get<{ id: string }>(
        "SELECT id FROM drawings WHERE source_id = ? AND code = ?",
        [d.sourceId, d.code],
      );
      if (r) {
        if (d.title)
          await h.run(
            "UPDATE drawings SET title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?",
            [d.title, r.id],
          );
        return { id: r.id, created: false };
      }
      const id = newId();
      await h.run(
        "INSERT INTO drawings(id,source_id,code,title,revision,notes) VALUES (?,?,?,?,?,?)",
        [
          id,
          d.sourceId,
          d.code,
          d.title ?? "",
          d.revision ?? "",
          d.notes ?? "",
        ],
      );
      return { id, created: true };
    });
  }
  async linkCatalogueDrawing(
    catalogueId: string,
    drawingId: string,
    sectionId?: string | null,
  ) {
    await this.db.write(async (h) =>
      h.run(
        "INSERT INTO catalogue_drawings(catalogue_id, drawing_id, section_id) VALUES (?,?,?) ON CONFLICT(catalogue_id, drawing_id) DO UPDATE SET section_id = COALESCE(excluded.section_id, catalogue_drawings.section_id)",
        [catalogueId, drawingId, sectionId ?? null],
      ),
    );
  }
  async ensureCallout(c: Parameters<CatalogueWriter["ensureCallout"]>[0]) {
    return this.db.write(async (h) => {
      const seq = c.sequence ?? 0;
      const r = await h.get<{ id: string }>(
        "SELECT id FROM drawing_callouts WHERE drawing_id = ? AND label = ? AND sequence = ?",
        [c.drawingId, c.label, seq],
      );
      const rect = c.rect;
      if (r) {
        if (rect)
          await h.run(
            "UPDATE drawing_callouts SET x1=?, y1=?, x2=?, y2=?, space=COALESCE(?, space) WHERE id = ?",
            [rect.x1, rect.y1, rect.x2, rect.y2, c.space ?? null, r.id],
          );
        return r.id;
      }
      const id = newId();
      await h.run(
        `INSERT INTO drawing_callouts(id,drawing_id,label,sequence,x1,y1,x2,y2,space,resolved,key_type,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          c.drawingId,
          c.label,
          seq,
          rect?.x1 ?? null,
          rect?.y1 ?? null,
          rect?.x2 ?? null,
          rect?.y2 ?? null,
          c.space ?? "PIXEL",
          c.resolved === false ? 0 : 1,
          c.keyType ?? "",
          c.notes ?? "",
        ],
      );
      return id;
    });
  }
  async linkCalloutPart(
    calloutId: string,
    partId: string,
    quantity?: number | null,
  ): Promise<"created" | "updated" | "unchanged"> {
    return this.db.write(async (h) => {
      const existing = await h.get<{ quantity: number | null }>(
        "SELECT quantity FROM callout_parts WHERE callout_id = ? AND part_id = ?",
        [calloutId, partId],
      );
      if (!existing) {
        await h.run(
          "INSERT INTO callout_parts(callout_id, part_id, quantity) VALUES (?,?,?)",
          [calloutId, partId, quantity ?? null],
        );
        return "created" as const;
      }
      if (quantity != null && quantity !== existing.quantity) {
        await h.run(
          "UPDATE callout_parts SET quantity = ? WHERE callout_id = ? AND part_id = ?",
          [quantity, calloutId, partId],
        );
        return "updated" as const;
      }
      return "unchanged" as const;
    });
  }
  async recordSourceRecord(
    r: Parameters<CatalogueWriter["recordSourceRecord"]>[0],
  ) {
    return this.db.write(async (h) => {
      const existing = await h.get<{ id: string }>(
        "SELECT id FROM source_records WHERE source_id = ? AND entity_type = ? AND entity_id = ? AND external_id = ?",
        [r.sourceId, r.entityType, r.entityId, r.externalId],
      );
      const now = nowIso();
      if (existing) {
        await h.run(
          "UPDATE source_records SET import_job_id = ?, imported_at = ?, source_url = COALESCE(NULLIF(?, ''), source_url), payload = COALESCE(?, payload) WHERE id = ?",
          [
            r.importJobId ?? null,
            now,
            r.sourceUrl ?? "",
            r.payload === undefined ? null : JSON.stringify(r.payload),
            existing.id,
          ],
        );
        return existing.id;
      }
      const id = newId();
      await h.run(
        `INSERT INTO source_records(id,source_id,external_id,entity_type,entity_id,source_url,catalogue_code,market,import_job_id,imported_at,source_updated_at,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          r.sourceId,
          r.externalId,
          r.entityType,
          r.entityId,
          r.sourceUrl ?? "",
          r.catalogueCode ?? "",
          r.market ?? "",
          r.importJobId ?? null,
          now,
          r.sourceUpdatedAt ?? null,
          r.payload === undefined ? null : JSON.stringify(r.payload),
        ],
      );
      return id;
    });
  }
  async saveAsset(a: Parameters<CatalogueWriter["saveAsset"]>[0]) {
    const id = newId();
    await this.db.write(async (h) =>
      h.run(
        `INSERT INTO assets(id,file_id,kind,provider_key,source_url,mime,width,height,checksum,rights,rights_evidence,import_job_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          a.fileId ?? null,
          a.kind,
          a.providerKey,
          a.sourceUrl ?? "",
          a.mime ?? "",
          a.width ?? null,
          a.height ?? null,
          a.checksum ?? "",
          a.rights,
          a.rightsEvidence ?? "",
          a.importJobId ?? null,
          nowIso(),
        ],
      ),
    );
    return id;
  }
  async attachAssetToDrawing(drawingId: string, assetId: string) {
    await this.db.write(async (h) =>
      h.run("UPDATE drawings SET asset_id = ? WHERE id = ?", [
        assetId,
        drawingId,
      ]),
    );
  }
  async recomputeDisplay(partId: string) {
    await this.db.write(async (h) => {
      const best = await h.get<Row>(
        `SELECT f.description, f.status FROM part_facts f JOIN catalogue_sources cs ON cs.id = f.source_id
          WHERE f.part_id = ? AND f.description <> '' ORDER BY cs.priority, f.observed_at, f.id LIMIT 1`,
        [partId],
      );
      const statusRow = await h.get<Row>(
        `SELECT f.status FROM part_facts f JOIN catalogue_sources cs ON cs.id = f.source_id
          WHERE f.part_id = ? AND f.status <> '' ORDER BY cs.priority, f.observed_at, f.id LIMIT 1`,
        [partId],
      );
      const p = await h.get<Row>(
        "SELECT description, status FROM catalogue_parts WHERE id = ?",
        [partId],
      );
      if (!p) return;
      const description = best ? s(best.description) : s(p.description);
      const status = statusRow ? s(statusRow.status) : s(p.status);
      if (description !== s(p.description) || status !== s(p.status))
        await h.run(
          "UPDATE catalogue_parts SET description = ?, status = ?, status_class = ?, version = version + 1, updated_at = ? WHERE id = ?",
          [description, status, classifyStatus(status), nowIso(), partId],
        );
    });
  }
  async refreshSearch(partId: string) {
    await this.db.write(async (h: SqlHandle) => {
      const pg = h.dialect === "postgres";
      const p = await h.get<Row>(
        `SELECT ${pg ? "0" : "rowid"} AS rid, oem_number, oem_normalized, description FROM catalogue_parts WHERE id = ?`,
        [partId],
      );
      if (!p) return;
      const vehicles = (
        await h.all<Row>(
          `SELECT MIN(mm.name) AS make, MIN(vm.name) AS model, MIN(v.chassis) AS chassis, MIN(v.generation) AS generation, MIN(v.body) AS body, ${pg ? "string_agg(DISTINCT fe.engine_code, ',')" : "GROUP_CONCAT(DISTINCT fe.engine_code)"} AS engines
             FROM fitments f JOIN vehicles v ON v.id = f.vehicle_id JOIN vehicle_models vm ON vm.id = v.model_id JOIN manufacturers mm ON mm.id = vm.manufacturer_id
             LEFT JOIN fitment_engines fe ON fe.fitment_id = f.id WHERE f.part_id = ? GROUP BY v.id`,
          [partId],
        )
      )
        .map((v) =>
          [
            v.make,
            v.model,
            v.chassis,
            v.generation,
            v.body,
            s(v.engines).replace(/,/g, " "),
          ]
            .map(s)
            .filter(Boolean)
            .join(" "),
        )
        .join(" ; ");
      const sections = (
        await h.all<Row>(
          `SELECT DISTINCT sc.name FROM callout_parts cp JOIN drawing_callouts dc ON dc.id = cp.callout_id JOIN catalogue_drawings cd ON cd.drawing_id = dc.drawing_id
             JOIN sections sc ON sc.id = cd.section_id WHERE cp.part_id = ?
           UNION SELECT DISTINCT sc.name FROM fitments f JOIN sections sc ON sc.id = f.section_id WHERE f.part_id = ?`,
          [partId, partId],
        )
      )
        .map((r) => s(r.name))
        .join(" ; ");
      const text = [
        partId,
        `${s(p.oem_number)} ${s(p.oem_normalized)}`,
        s(p.description),
        vehicles,
        sections,
      ];
      if (pg) {
        await h.run("DELETE FROM catalogue_search WHERE part_id = ?", [partId]);
        await h.run(
          "INSERT INTO catalogue_search(part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?)",
          text,
        );
      } else {
        await h.run("DELETE FROM catalogue_search WHERE rowid = ?", [n(p.rid)]);
        await h.run(
          "INSERT INTO catalogue_search(rowid, part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?,?)",
          [n(p.rid), ...text],
        );
      }
    });
  }
  async linkPendingRelations() {
    await this.db.write(async (h) =>
      h.run(
        `UPDATE part_relations SET related_part_id = (
           SELECT p2.id FROM catalogue_parts p1 JOIN catalogue_parts p2 ON p2.manufacturer_id = p1.manufacturer_id AND p2.oem_normalized = part_relations.related_normalized
            WHERE p1.id = part_relations.part_id LIMIT 1)
         WHERE related_part_id IS NULL`,
      ),
    );
  }
  async findPart(manufacturerName: string, oemNormalized: string) {
    const r = await this.db.read(async (h) =>
      h.get<Row>(
        "SELECT p.id, p.description FROM catalogue_parts p JOIN manufacturers m ON m.id = p.manufacturer_id WHERE m.name = ? COLLATE NOCASE AND p.oem_normalized = ?",
        [manufacturerName.trim(), oemNormalized],
      ),
    );
    return r ? { id: s(r.id), description: s(r.description) } : null;
  }
  async factExists(partId: string, sourceKey: string, description: string) {
    return this.db.read(
      async (h) =>
        (await h.count(
          "SELECT COUNT(*) AS n FROM part_facts f JOIN catalogue_sources cs ON cs.id = f.source_id WHERE f.part_id = ? AND cs.provider_key = ? AND f.description = ?",
          [partId, sourceKey, description],
        )) > 0,
    );
  }
}
export { likeTerm };
