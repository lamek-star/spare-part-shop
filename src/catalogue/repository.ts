import { createHash, randomUUID } from "node:crypto";
import { normalizeNumber } from "../domain/models";
import {
  ReferenceState,
  ReferenceDetail,
  ReferenceHit,
  Page,
  ColumnMapping,
  ImportBatch,
  ImportRecord,
  Provenance,
  AdminOverview,
  Verification,
  ImageRights,
  isCatalogueAdmin,
  canDisplayImage,
} from "./models";
import { referenceSeed } from "./seed";
import { parseCsv, mapRecord } from "./providers";
const id = (...values: unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
const timestamp = () => new Date().toISOString();
const ensure = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const identity = (r: ImportRecord, provider: string) =>
  id(
    provider,
    r.sourceRecordId || normalizeNumber(r.number),
    r.manufacturer,
    r.catalogue,
    r.make,
    r.model,
    r.chassis,
    r.engineCode,
    r.yearFrom,
    r.yearTo,
    r.market,
  );
export class ReferenceRepository {
  private state: ReferenceState;
  private numberIndex = new Map<string, Set<string>>();
  private partIndex = new Map<string, ReferenceState["parts"][number]>();
  private numbersByPart = new Map<string, ReferenceState["numbers"]>();
  constructor(
    initial = referenceSeed(),
    private persist?: (s: ReferenceState) => void,
  ) {
    this.state = structuredClone(initial);
    this.reindex();
  }
  private reindex() {
    this.numberIndex.clear();
    this.partIndex = new Map(this.state.parts.map((p) => [p.id, p]));
    this.numbersByPart.clear();
    for (const n of this.state.numbers) {
      const partNumbers = this.numbersByPart.get(n.partId) ?? [];
      partNumbers.push(n);
      this.numbersByPart.set(n.partId, partNumbers);
      const bucket = this.numberIndex.get(n.normalized) ?? new Set<string>();
      bucket.add(n.partId);
      this.numberIndex.set(n.normalized, bucket);
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  private commit(mutate: (state: ReferenceState) => void) {
    const draft = structuredClone(this.state);
    mutate(draft);
    this.persist?.(draft);
    this.state = draft;
    this.reindex();
  }
  private admin(role: string) {
    ensure(
      isCatalogueAdmin(role),
      "Permission denied: catalogue administration requires Owner or Administrator.",
    );
  }
  private imageForDisplay<
    T extends { image: import("./models").CatalogueImage },
  >(d: T): T {
    return {
      ...d,
      image: { ...d.image, url: canDisplayImage(d.image) ? d.image.url : "" },
    };
  }
  search(
    q = "",
    page = 1,
    pageSize = 20,
    variantId = "",
    categoryId = "",
    year = "",
    engine = "",
    modelId = "",
    makeId = "",
  ): Page<ReferenceHit> {
    page = Math.max(1, Math.floor(page) || 1);
    pageSize = Math.max(1, Math.min(50, Math.floor(pageSize) || 20));
    const n = normalizeNumber(q);
    const exact = this.numberIndex.get(n);
    const numberMatches = new Set(exact ?? []);
    if (q && !exact)
      for (const [number, ids] of this.numberIndex)
        if (number.includes(n)) ids.forEach((i) => numberMatches.add(i));
    const allowedVariants = new Set(
      this.state.variants
        .filter(
          (v) =>
            (!variantId || v.id === variantId) &&
            (!year ||
              (v.yearFrom <= Number(year) && v.yearTo >= Number(year))) &&
            (!engine || v.engineCode === engine) &&
            (!modelId || v.modelId === modelId) &&
            (!makeId ||
              this.state.models.some(
                (m) => m.id === v.modelId && m.makeId === makeId,
              )),
        )
        .map((v) => v.id),
    );
    const fitIds =
      variantId || year || engine || modelId || makeId
        ? new Set(
            this.state.fitments
              .filter((f) => allowedVariants.has(f.variantId))
              .map((f) => f.partId),
          )
        : null;
    const matchingVariants = exact
      ? []
      : this.state.variants.filter((v) => {
          const model = this.state.models.find((m) => m.id === v.modelId);
          const make = this.state.makes.find((m) => m.id === model?.makeId);
          return `${make?.name} ${model?.name} ${v.chassis} ${v.engine} ${v.engineCode}`
            .toLowerCase()
            .includes(q.toLowerCase());
        });
    const vehicleParts = new Set(
      (exact ? [] : this.state.fitments)
        .filter((f) => matchingVariants.some((v) => v.id === f.variantId))
        .map((f) => f.partId),
    );
    const candidates = exact
      ? [...exact].map((id) => this.partIndex.get(id)!).filter(Boolean)
      : this.state.parts;
    const matched = candidates
      .filter(
        (p) =>
          (!fitIds || fitIds.has(p.id)) &&
          (!categoryId || p.categoryId === categoryId) &&
          (!q ||
            numberMatches.has(p.id) ||
            vehicleParts.has(p.id) ||
            `${p.description} ${p.manufacturer}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      )
      .sort(
        (a, b) =>
          Number(numberMatches.has(b.id)) - Number(numberMatches.has(a.id)),
      );
    return {
      items: matched
        .slice((page - 1) * pageSize, page * pageSize)
        .map((part) => ({
          part: structuredClone(part),
          numbers: structuredClone(this.numbersByPart.get(part.id) ?? []),
        })),
      total: matched.length,
      page,
      pageSize,
    };
  }
  browse(filters: Record<string, string> = {}) {
    const makes = this.state.makes;
    const models = this.state.models.filter(
      (m) => !filters.make || m.makeId === filters.make,
    );
    const variants = this.state.variants.filter(
      (v) =>
        (!filters.model || v.modelId === filters.model) &&
        (!filters.make || models.some((m) => m.id === v.modelId)) &&
        (!filters.year ||
          (v.yearFrom <= Number(filters.year) &&
            v.yearTo >= Number(filters.year))) &&
        (!filters.engine || v.engineCode === filters.engine),
    );
    const cats = this.state.catalogues.filter(
      (c) => !filters.variant || c.variantId === filters.variant,
    );
    return structuredClone({
      makes: makes.slice(0, 100),
      models: models.slice(0, 200),
      variants: variants.slice(0, 200),
      categories: this.state.categories.filter((c) =>
        cats.some((x) => x.id === c.catalogueId),
      ),
      diagrams: this.state.diagrams
        .filter(
          (d) =>
            (!filters.variant || d.variantId === filters.variant) &&
            variants.some((v) => v.id === d.variantId) &&
            (!filters.category || d.categoryId === filters.category),
        )
        .map((d) => this.imageForDisplay(d)),
    });
  }
  detail(partId: string): ReferenceDetail {
    const part = this.state.parts.find((p) => p.id === partId);
    ensure(part, "Reference part not found.");
    const numbers = this.state.numbers.filter((n) => n.partId === partId);
    const source = this.state.sources.find(
      (s) => s.providerKey === part!.provenance.sourceProvider,
    )!;
    return structuredClone({
      part: part!,
      numbers,
      source,
      fitments: this.state.fitments
        .filter((f) => f.partId === partId)
        .map((f) => {
          const v = this.state.variants.find((v) => v.id === f.variantId)!;
          const model = this.state.models.find((m) => m.id === v.modelId)!;
          const make = this.state.makes.find((m) => m.id === model.makeId)!;
          return {
            ...f,
            vehicle: `${make.name} ${model.name} / ${v.chassis} / ${v.engineCode}`,
          };
        }),
      crossReferences: this.state.crossReferences
        .filter((r) =>
          numbers.some(
            (n) => n.id === r.sourceNumberId || n.id === r.targetNumberId,
          ),
        )
        .map((r) => {
          const a = this.state.numbers.find((n) => n.id === r.sourceNumberId)!;
          const b = this.state.numbers.find((n) => n.id === r.targetNumberId)!;
          return {
            ...r,
            source: a.original,
            target: b.original,
            targetPartId: b.partId === partId ? a.partId : b.partId,
          };
        }),
      diagrams: this.state.diagrams.flatMap((d) =>
        this.state.callouts
          .filter((c) => c.diagramId === d.id && c.partIds.includes(partId))
          .map((callout) => ({ diagram: this.imageForDisplay(d), callout })),
      ),
    });
  }
  diagram(diagramId: string) {
    const diagram = this.state.diagrams.find((d) => d.id === diagramId);
    ensure(diagram, "Diagram not found.");
    const callouts = this.state.callouts.filter(
      (c) => c.diagramId === diagramId,
    );
    return structuredClone({
      diagram: this.imageForDisplay(diagram!),
      callouts,
      parts: this.state.parts
        .filter((p) => callouts.some((c) => c.partIds.includes(p.id)))
        .map((part) => ({
          part,
          numbers: this.state.numbers.filter((n) => n.partId === part.id),
        })),
    });
  }
  overview(role: string): AdminOverview {
    this.admin(role);
    return {
      sources: structuredClone(this.state.sources),
      batches: this.state.batches.map(({ records, csv, ...batch }) => ({
        ...structuredClone(batch),
        valid: records.filter(
          (r) =>
            !r.errors.length &&
            !r.excluded &&
            r.duplicate !== "IN_BATCH" &&
            r.duplicate !== "CONFLICT",
        ).length,
      })),
      statistics: {
        parts: this.state.parts.length,
        numbers: this.state.numbers.length,
        fitments: this.state.fitments.length,
        diagrams: this.state.diagrams.length,
        sources: this.state.sources.length,
        batches: this.state.batches.length,
      },
      images: this.state.diagrams.map((d) => ({
        ...d.image,
        url: canDisplayImage(d.image) ? d.image.url : "",
      })),
    };
  }
  batch(batchId: string, role: string, page = 1) {
    this.admin(role);
    const batch = this.state.batches.find((b) => b.id === batchId);
    ensure(batch, "Import batch not found.");
    const { csv, records, ...summary } = batch!;
    page = Math.max(1, Math.floor(page) || 1);
    return {
      batch: structuredClone(summary),
      records: {
        items: structuredClone(records.slice((page - 1) * 25, page * 25)),
        page,
        pageSize: 25,
        total: records.length,
      },
    };
  }
  stage(
    csv: string,
    mapping: ColumnMapping,
    role: string,
    attested: boolean,
    retryId?: string,
    sourceId = "company-csv",
  ) {
    this.admin(role);
    ensure(
      attested,
      "Confirm that your organization may use the uploaded data internally.",
    );
    let batchId = retryId ?? randomUUID();
    if (retryId) {
      const previous = this.state.batches.find((b) => b.id === retryId);
      ensure(
        previous && ["FAILED", "REVIEW_REQUIRED"].includes(previous.status),
        "Only failed or uncommitted batches may be retried.",
      );
    }
    const batch: ImportBatch = {
      id: batchId,
      sourceId,
      startedAt: timestamp(),
      status: "PENDING",
      discovered: 0,
      valid: 0,
      rejected: 0,
      duplicates: 0,
      warnings: [],
      errors: [],
      created: 0,
      updated: 0,
      records: [],
      csv,
      mapping,
      attempts:
        (this.state.batches.find((b) => b.id === batchId)?.attempts ?? 0) + 1,
      history: [],
    };
    const transition = (status: ImportBatch["status"]) => {
      batch.status = status;
      batch.history.push({ at: timestamp(), status });
    };
    try {
      transition("PARSING");
      const parsed = parseCsv(csv);
      for (const header of Object.values(mapping))
        ensure(
          !header || parsed.headers.includes(header!),
          "Mapped column does not exist.",
        );
      transition("VALIDATING");
      batch.discovered = parsed.rows.length;
      const seen = new Set<string>();
      batch.records = parsed.rows.map((row, i) => {
        const { record, errors, warnings } = mapRecord(
          parsed.headers,
          row,
          mapping,
        );
        const key = identity(record, sourceId);
        const existing = this.state.parts.find((p) => p.id === key);
        if (existing)
          warnings.push(
            "Current published description: " + existing.description,
          );
        const signature =
          key + "|" + normalizeNumber(record.number) + "|" + record.numberType;
        let duplicate: "NONE" | "EXISTING" | "IN_BATCH" | "CONFLICT" = seen.has(
          signature,
        )
          ? "IN_BATCH"
          : existing
            ? "EXISTING"
            : "NONE";
        if (
          record.sourceRecordId &&
          this.state.parts.some(
            (p) =>
              p.provenance.sourceProvider === sourceId &&
              p.provenance.sourceRecordId === record.sourceRecordId &&
              p.id !== key,
          )
        )
          duplicate = "CONFLICT";
        seen.add(signature);
        return {
          id: randomUUID(),
          row: i + 2,
          record,
          identity: key,
          errors,
          warnings,
          duplicate,
          excluded: false,
          existingVersion: existing?.version,
        };
      });
      const sourceGroups = new Map<string, typeof batch.records>();
      for (const row of batch.records) {
        const key = row.record.sourceRecordId || row.identity;
        const group = sourceGroups.get(key) ?? [];
        group.push(row);
        sourceGroups.set(key, group);
      }
      for (const group of sourceGroups.values()) {
        if (
          new Set(group.map((r) => r.identity)).size > 1 ||
          new Set(group.map((r) => r.record.description)).size > 1
        )
          for (const row of group) {
            row.duplicate = "CONFLICT";
            row.warnings.push(
              "Conflicting records share a source identity within this batch.",
            );
          }
      }
      batch.valid = batch.records.filter(
        (r) => !r.errors.length && ["NONE", "EXISTING"].includes(r.duplicate),
      ).length;
      batch.rejected = batch.records.filter(
        (r) => r.errors.length || r.duplicate === "CONFLICT",
      ).length;
      batch.duplicates = batch.records.filter(
        (r) => r.duplicate !== "NONE",
      ).length;
      batch.warnings = [
        "Review identifiers, fitment, source and conflicts before publishing. Uploaded source values are retained.",
      ];
      transition("REVIEW_REQUIRED");
    } catch (e) {
      transition("FAILED");
      batch.errors = [(e as Error).message];
      batch.completedAt = timestamp();
      batch.csv = csv.slice(0, 2_000_000);
    }
    this.commit((s) => {
      const index = s.batches.findIndex((b) => b.id === batchId);
      if (index >= 0) s.batches[index] = batch;
      else s.batches.unshift(batch);
    });
    return this.batch(batchId, role);
  }
  retry(batchId: string, role: string) {
    this.admin(role);
    const b = this.state.batches.find((b) => b.id === batchId);
    ensure(b, "Batch not found.");
    return this.stage(b!.csv, b!.mapping, role, true, batchId, b!.sourceId);
  }
  exclude(batchId: string, rowId: string, role: string) {
    this.admin(role);
    this.commit((s) => {
      const b = s.batches.find((b) => b.id === batchId);
      ensure(b?.status === "REVIEW_REQUIRED", "Batch is not awaiting review.");
      const row = b!.records.find((r) => r.id === rowId);
      ensure(row, "Staged row not found.");
      row!.excluded = !row!.excluded;
    });
    return this.batch(batchId, role);
  }
  cancel(batchId: string, role: string) {
    this.admin(role);
    this.commit((s) => {
      const b = s.batches.find((b) => b.id === batchId);
      ensure(
        b && !["COMPLETED", "CANCELLED"].includes(b.status),
        "Batch cannot be cancelled.",
      );
      b!.status = "CANCELLED";
      b!.completedAt = timestamp();
      b!.history.push({ at: timestamp(), status: "CANCELLED" });
    });
  }
  publish(batchId: string, role: string) {
    this.admin(role);
    const current = this.state.batches.find((b) => b.id === batchId);
    ensure(current, "Batch not found.");
    if (current!.status === "COMPLETED") return this.batch(batchId, role);
    this.commit((s) => {
      const batch = s.batches.find((b) => b.id === batchId)!;
      ensure(
        batch.status === "REVIEW_REQUIRED",
        "Batch is not ready to publish.",
      );
      const candidates = batch.records.filter(
        (r) =>
          !r.excluded &&
          !r.errors.length &&
          ["NONE", "EXISTING"].includes(r.duplicate),
      );
      ensure(candidates.length, "There are no valid rows to publish.");
      ensure(
        !batch.records.some((r) => !r.excluded && r.duplicate === "CONFLICT"),
        "Exclude conflicting rows before publishing.",
      );
      for (const row of candidates) {
        const existing = s.parts.find((p) => p.id === row.identity);
        ensure(
          existing?.version === row.existingVersion,
          "Published data changed since staging. Retry validation before publishing.",
        );
      }
      batch.status = "PUBLISHING";
      batch.history.push({ at: timestamp(), status: "PUBLISHING" });
      const created = new Set<string>(),
        updated = new Set<string>();
      for (const row of candidates) {
        const r = row.record;
        const provenance: Provenance = {
          sourceProvider: batch.sourceId,
          sourceRecordId: r.sourceRecordId || row.identity,
          sourceUrl: r.sourceUrl,
          sourceCatalogue: r.catalogue,
          retrievedAt: batch.startedAt,
          importBatchId: batch.id,
          verification: "UNVERIFIED",
          licenseStatus: "OPERATOR_ATTESTED_INTERNAL",
        };
        const makeId = id("make", r.make),
          modelId = id("model", makeId, r.model),
          variantId = id(
            "variant",
            modelId,
            r.chassis,
            r.engine,
            r.engineCode,
            r.yearFrom,
            r.yearTo,
            r.market,
          );
        if (!s.makes.some((m) => m.id === makeId))
          s.makes.push({ id: makeId, name: r.make, provenance });
        if (!s.models.some((m) => m.id === modelId))
          s.models.push({ id: modelId, makeId, name: r.model, provenance });
        if (!s.variants.some((v) => v.id === variantId))
          s.variants.push({
            id: variantId,
            modelId,
            chassis: r.chassis,
            generation: "",
            yearFrom: r.yearFrom,
            yearTo: r.yearTo,
            engine: r.engine,
            engineCode: r.engineCode,
            transmission: "Unspecified",
            drivetrain: "Unspecified",
            market: r.market,
            bodyType: "Unspecified",
            notes: "Uploaded fitment — unverified.",
            provenance,
          });
        const catalogueId = id(
            "catalogue",
            batch.sourceId,
            r.catalogue,
            variantId,
          ),
          categoryId = id("category", catalogueId, r.category);
        if (!s.catalogues.some((c) => c.id === catalogueId))
          s.catalogues.push({
            id: catalogueId,
            sourceId: batch.sourceId,
            variantId,
            name: r.catalogue,
            provenance,
          });
        if (!s.categories.some((c) => c.id === categoryId))
          s.categories.push({
            id: categoryId,
            catalogueId,
            name: r.category,
            provenance,
          });
        const part = {
          id: row.identity,
          manufacturer: r.manufacturer,
          description: r.description,
          catalogueDescription: r.description,
          categoryId,
          catalogueId,
          status: "Active",
          notes: "Published from reviewed CSV. Not independently verified.",
          version: 1,
          provenance,
        };
        const index = s.parts.findIndex((p) => p.id === row.identity);
        if (index < 0) {
          s.parts.push(part);
          created.add(part.id);
        } else {
          s.parts[index] = { ...part, version: s.parts[index].version + 1 };
          if (!created.has(part.id)) updated.add(part.id);
        }
        const numberId = id(
          "number",
          part.id,
          r.numberType,
          normalizeNumber(r.number),
        );
        const number = {
          id: numberId,
          partId: part.id,
          original: r.number,
          normalized: normalizeNumber(r.number),
          type: r.numberType,
          manufacturer: r.manufacturer,
          market: r.market,
          primary: !s.numbers.some(
            (n) =>
              n.partId === part.id &&
              n.type === r.numberType &&
              n.primary &&
              n.id !== numberId,
          ),
          active: true,
          notes: "Imported identifier",
          provenance,
        };
        const ni = s.numbers.findIndex((n) => n.id === numberId);
        if (ni < 0) s.numbers.push(number);
        else s.numbers[ni] = number;
        const fitId = id("fit", part.id, variantId);
        if (!s.fitments.some((f) => f.id === fitId))
          s.fitments.push({
            id: fitId,
            partId: part.id,
            variantId,
            yearFrom: r.yearFrom,
            yearTo: r.yearTo,
            engine: r.engine,
            engineCode: r.engineCode,
            chassis: r.chassis,
            transmission: "Unspecified",
            market: r.market,
            position: "Unspecified",
            notes: "Operator supplied; unverified.",
            provenance,
          });
      }
      batch.created = created.size;
      batch.updated = updated.size;
      batch.rejected = batch.records.length - candidates.length;
      batch.status = "COMPLETED";
      batch.completedAt = timestamp();
      batch.history.push({ at: timestamp(), status: "COMPLETED" });
    });
    return this.batch(batchId, role);
  }
  verify(partId: string, status: Verification, role: string) {
    this.admin(role);
    ensure(
      [
        "UNVERIFIED",
        "SOURCE_VERIFIED",
        "MANUALLY_VERIFIED",
        "LICENSED_DATA",
        "DISPUTED",
      ].includes(status),
      "Invalid verification state.",
    );
    this.commit((s) => {
      const part = s.parts.find((p) => p.id === partId);
      ensure(part, "Part not found.");
      ensure(
        status !== "LICENSED_DATA",
        "Licensed-data verification requires an approved provider contract.",
      );
      part!.provenance.verification = status;
      part!.version++;
    });
  }
  imageRights(
    imageId: string,
    rights: ImageRights,
    evidence: string,
    role: string,
  ) {
    this.admin(role);
    ensure(
      [
        "EXTERNAL_REFERENCE",
        "LICENSE_UNKNOWN",
        "LICENSED_FOR_INTERNAL_USE",
        "LICENSED_FOR_DISPLAY",
        "COMPANY_OWNED",
        "MANUFACTURER_AUTHORIZED",
        "DO_NOT_REPUBLISH",
      ].includes(rights),
      "Invalid image-rights state.",
    );
    ensure(
      evidence.trim().length >= 12,
      "Record the rights evidence or reason (at least 12 characters).",
    );
    this.commit((s) => {
      const d = s.diagrams.find((d) => d.image.id === imageId);
      ensure(d, "Image not found.");
      d!.image.rights = rights;
      d!.image.rightsEvidence = evidence;
      d!.image.rightsReviewedAt = timestamp();
    });
  }
  addCrossReference(
    sourceId: string,
    targetId: string,
    type: import("./models").CrossReference["type"],
    notes: string,
    role: string,
  ) {
    this.admin(role);
    ensure(
      [
        "EQUIVALENT",
        "CROSS_REFERENCE",
        "SUPERSEDES",
        "SUPERSEDED_BY",
        "REPLACEMENT",
        "ALTERNATIVE",
        "INTERCHANGE",
      ].includes(type),
      "Unknown relationship type.",
    );
    this.commit((s) => {
      ensure(
        sourceId !== targetId &&
          s.numbers.some((n) => n.id === sourceId) &&
          s.numbers.some((n) => n.id === targetId),
        "Select two different existing numbers.",
      );
      const forward = type === "SUPERSEDED_BY";
      if (["SUPERSEDED_BY", "SUPERSEDES", "REPLACEMENT"].includes(type)) {
        const edges = s.crossReferences
          .filter((r) =>
            ["SUPERSEDED_BY", "SUPERSEDES", "REPLACEMENT"].includes(r.type),
          )
          .map((r) =>
            r.type === "SUPERSEDED_BY"
              ? [r.sourceNumberId, r.targetNumberId]
              : [r.targetNumberId, r.sourceNumberId],
          );
        const old = forward ? sourceId : targetId,
          next = forward ? targetId : sourceId;
        const visit = [next],
          seen = new Set<string>();
        while (visit.length) {
          const n = visit.pop()!;
          ensure(n !== old, "Circular supersession is not allowed.");
          if (seen.has(n)) continue;
          seen.add(n);
          edges.filter((e) => e[0] === n).forEach((e) => visit.push(e[1]));
        }
      }
      const source = s.numbers.find((n) => n.id === sourceId)!;
      s.crossReferences.push({
        id: randomUUID(),
        sourceNumberId: sourceId,
        targetNumberId: targetId,
        type,
        confidence: "Manual unverified",
        notes,
        provenance: {
          ...source.provenance,
          verification: "UNVERIFIED",
          retrievedAt: timestamp(),
        },
      });
    });
  }
}
