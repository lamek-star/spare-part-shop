import type { Repositories, UnitOfWork } from "../providers/uow";
import type {
  BrowseFilters,
  BrowseResult,
  CatalogueSearchQuery,
  CatalogueSource,
  CatalogueStats,
  DrawingDetail,
  ImageRights,
  LinkedProduct,
  PartDetail,
  PartSummary,
  Verification,
} from "../catalogue/model";
import { displayableRights, imageRightsValues } from "../catalogue/model";
import type { Actor, Page } from "./types";
import { notFound, validation } from "../kernel/errors";
import { can, requirePermission } from "./permissions";
import { record, text } from "./validate";

async function linkedProducts(r: Repositories, actor: Actor, referencePartId: string): Promise<LinkedProduct[]> {
  if (!can(actor, "products.read")) return [];
  const links = await r.products.linksForReference(referencePartId);
  const canStock = can(actor, "inventory.read");
  const out: LinkedProduct[] = [];
  for (const l of links) {
    const p = await r.products.get(l.productId);
    if (!p) continue;
    out.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      available: canStock ? (await r.inventory.balances({ productId: p.id })).reduce((n, b) => n + b.available, 0) : null,
    });
  }
  return out;
}

/** Read access to the reference catalogue plus its governance (sources,
 * verification, image rights). Reference records carry no shop price,
 * cost or stock; `linkedProducts` is the only bridge to My Products. */
export class CatalogueService {
  constructor(private readonly uow: UnitOfWork) {}

  async search(actor: Actor, q: CatalogueSearchQuery): Promise<Page<PartSummary>> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read(async (r) => {
      const page = await r.catalogue.search(q);
      for (const item of page.items) item.linkedProducts = await linkedProducts(r, actor, item.id);
      return page;
    });
  }
  async part(actor: Actor, id: string): Promise<PartDetail> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read(async (r) => {
      const part = await r.catalogue.getPart(id);
      if (!part) throw notFound("Reference part");
      part.linkedProducts = await linkedProducts(r, actor, id);
      return part;
    });
  }
  /** Finds a reference part by OEM number in any format (exact match). */
  async partByOem(actor: Actor, oem: string): Promise<PartDetail | null> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read(async (r) => {
      const ids = await r.catalogue.findPartIdsByOem(oem.toUpperCase().replace(/[\s-]/g, ""));
      if (!ids.length) return null;
      const part = await r.catalogue.getPart(ids[0]);
      if (part) part.linkedProducts = await linkedProducts(r, actor, ids[0]);
      return part;
    });
  }
  async drawing(actor: Actor, id: string): Promise<DrawingDetail> {
    requirePermission(actor, "catalogue.read");
    const d = await this.uow.read((r) => r.catalogue.getDrawing(id));
    if (!d) throw notFound("Drawing");
    return d;
  }
  async browse(actor: Actor, filters: BrowseFilters): Promise<BrowseResult> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read((r) => r.catalogue.browse(filters));
  }
  async stats(actor: Actor): Promise<CatalogueStats> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read((r) => r.catalogue.stats());
  }

  // ---------------- images ----------------
  /** Bytes of a locally stored drawing — only when its recorded rights
   * allow this application to show it. Otherwise nothing is served. */
  async assetBytes(actor: Actor, assetId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read(async (r) => {
      const a = await r.catalogue.getAsset(assetId);
      if (!a || !a.fileId || !displayableRights.includes(a.rights)) return null;
      const f = await r.files.get(a.fileId);
      return f ? { bytes: f.bytes, mime: f.file.mime } : null;
    });
  }

  // ---------------- governance ----------------
  async sources(actor: Actor): Promise<CatalogueSource[]> {
    requirePermission(actor, "catalogue.read");
    return this.uow.read((r) => r.catalogue.listSources());
  }
  async saveSource(actor: Actor, raw: unknown): Promise<CatalogueSource> {
    requirePermission(actor, "catalogue.admin");
    const i = record(raw);
    const providerKey = text(i.providerKey, "Provider key", { required: true, max: 60 });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(providerKey)) throw validation("Provider key may use lower-case letters, digits and hyphens.");
    return this.uow.write(async (r) => {
      const s = await r.catalogue.saveSource({
        providerKey,
        name: text(i.name, "Name", { required: true, max: 120 }),
        type: text(i.type, "Type", { max: 40 }) || "OTHER",
        url: text(i.url, "URL", { max: 300 }),
        manufacturer: text(i.manufacturer, "Manufacturer", { max: 100 }),
        market: text(i.market, "Market", { max: 80 }),
        licenseStatus: text(i.licenseStatus, "License status", { max: 80 }) || undefined,
        redistributionStatus: text(i.redistributionStatus, "Redistribution", { max: 80 }) || undefined,
        notes: text(i.notes, "Notes", { max: 1000 }),
        priority: typeof i.priority === "number" && Number.isInteger(i.priority) && i.priority >= 0 && i.priority <= 1000 ? i.priority : undefined,
        active: i.active === undefined ? undefined : Boolean(i.active),
      });
      await r.audit.record(actor, { action: "catalogue.source.save", entityType: "catalogue_source", entityId: s.id, summary: `Source ${s.name} saved` });
      return s;
    });
  }
  async setVerification(actor: Actor, partId: string, status: unknown): Promise<void> {
    requirePermission(actor, "catalogue.admin");
    const allowed: Verification[] = ["UNVERIFIED", "SOURCE_VERIFIED", "MANUALLY_VERIFIED", "DISPUTED"];
    if (typeof status !== "string" || !allowed.includes(status as Verification)) throw validation("Unknown verification state.");
    await this.uow.write(async (r) => {
      if (!(await r.catalogue.getPart(partId))) throw notFound("Reference part");
      await r.catalogue.setVerification(partId, status as Verification);
      await r.audit.record(actor, { action: "catalogue.verify", entityType: "catalogue_part", entityId: partId, summary: `Verification set to ${status}` });
    });
  }
  async setImageRights(actor: Actor, assetId: string, rights: unknown, evidence: unknown): Promise<void> {
    requirePermission(actor, "catalogue.admin");
    if (typeof rights !== "string" || !imageRightsValues.includes(rights as ImageRights)) throw validation("Unknown image-rights state.");
    const ev = text(evidence, "Evidence", { required: true, max: 1000 });
    if (ev.length < 12) throw validation("Record the rights evidence or reason (at least 12 characters).");
    await this.uow.write(async (r) => {
      if (!(await r.catalogue.setAssetRights(assetId, rights as ImageRights, ev))) throw notFound("Image");
      await r.audit.record(actor, { action: "catalogue.image_rights", entityType: "asset", entityId: assetId, summary: `Image rights set to ${rights}`, metadata: { evidence: ev } });
    });
  }
  async assets(actor: Actor, page = 1, pageSize = 50) {
    requirePermission(actor, "catalogue.admin");
    return this.uow.read((r) => r.catalogue.listAssets(page, pageSize));
  }
}
