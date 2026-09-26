import type { ProductQuery, ProductRow } from "../providers/data";
import type { Repositories, UnitOfWork } from "../providers/uow";
import type {
  Actor,
  Page,
  Product,
  ProductImage,
  ProductNumber,
  ProductSupplier,
  ReferenceLink,
  StockBalance,
} from "./types";
import { productConditions } from "./types";
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  validation,
} from "../kernel/errors";
import { newId, normalizeNumber, nowIso } from "../kernel/ids";
import { InventoryOps } from "./inventory";
import { can, requirePermission } from "./permissions";
import { currency, integer, moneyMinor, oneOf, record, text } from "./validate";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 12;
const IMAGE_TYPES: Record<string, { mime: string; extensions: string[] }> = {
  png: { mime: "image/png", extensions: ["png"] },
  jpeg: { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  gif: { mime: "image/gif", extensions: ["gif"] },
  webp: { mime: "image/webp", extensions: ["webp"] },
};
/** Identifies an image from its own bytes; a client-supplied MIME type or
 * file extension is never trusted on its own (and SVG is not accepted). */
export function sniffImage(bytes: Uint8Array): keyof typeof IMAGE_TYPES | null {
  const b = bytes;
  if (
    b.length > 12 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "jpeg";
  if (
    b.length > 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  )
    return "gif";
  if (
    b.length > 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "webp";
  return null;
}
export const imageUrl = (fileId: string) => `/api/v1/files/${fileId}`;

export interface ProductDetail {
  product: Product;
  numbers: ProductNumber[];
  suppliers: ProductSupplier[];
  images: ProductImage[];
  referenceLinks: ReferenceLink[];
  stock: (StockBalance & { warehouseName: string; locationCode: string })[];
  totals: { onHand: number; reserved: number; available: number };
}

export interface ProductListItem extends Product {
  onHand: number;
  available: number;
  primaryImageUrl: string | null;
}

const mask = (p: ProductRow, actor: Actor): Product => ({
  ...p,
  costMinor: can(actor, "products.cost.read") ? p.costMinor : null,
});

function productFields(input: Record<string, unknown>, base?: ProductRow) {
  const pick = <T>(key: string, fallback: T) =>
    input[key] === undefined ? fallback : input[key];
  return {
    sku: text(pick("sku", base?.sku), "SKU", { required: true, max: 64 }),
    name: text(pick("name", base?.name), "Name", { required: true, max: 200 }),
    brand: text(pick("brand", base?.brand), "Brand", { max: 100 }),
    manufacturer: text(
      pick("manufacturer", base?.manufacturer),
      "Manufacturer",
      { max: 100 },
    ),
    category: text(pick("category", base?.category), "Category", { max: 100 }),
    description: text(pick("description", base?.description), "Description", {
      max: 2000,
    }),
    condition: oneOf(
      pick("condition", base?.condition),
      productConditions,
      "Condition",
      "NEW",
    ),
    unit:
      text(pick("unit", base?.unit ?? "Each"), "Unit", { max: 30 }) || "Each",
    weightGrams: integer(pick("weightGrams", base?.weightGrams), "Weight", {
      min: 0,
      max: 100_000_000,
      default: 0,
    }),
    origin: text(pick("origin", base?.origin), "Origin", { max: 100 }),
    status: oneOf(
      pick("status", base?.status),
      ["ACTIVE", "INACTIVE"] as const,
      "Status",
      "ACTIVE",
    ),
    priceMinor: moneyMinor(
      pick("priceMinor", base?.priceMinor),
      "Selling price",
      { default: 0 },
    ),
    currency: currency(pick("currency", base?.currency)),
    taxCategory:
      text(
        pick("taxCategory", base?.taxCategory ?? "Standard"),
        "Tax category",
        { max: 60 },
      ) || "Standard",
    reorderLevel: integer(
      pick("reorderLevel", base?.reorderLevel),
      "Reorder level",
      { min: 0, max: 1_000_000, default: 0 },
    ),
    minimumLevel: integer(
      pick("minimumLevel", base?.minimumLevel),
      "Minimum level",
      { min: 0, max: 1_000_000, default: 0 },
    ),
    notes: text(pick("notes", base?.notes), "Notes", { max: 2000 }),
  };
}

export class ProductService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(actor: Actor, q: ProductQuery): Promise<Page<ProductListItem>> {
    requirePermission(actor, "products.read");
    return this.uow.read(async (r) => {
      const page = await r.products.list(q);
      const items: ProductListItem[] = [];
      for (const p of page.items) {
        const balances = await r.inventory.balances({ productId: p.id });
        const images = await r.products.images(p.id);
        const primary = images.find((i) => i.isPrimary) ?? images[0];
        items.push({
          ...mask(p, actor),
          onHand: balances.reduce((n, b) => n + b.onHand, 0),
          available: balances.reduce((n, b) => n + b.available, 0),
          primaryImageUrl: primary ? imageUrl(primary.fileId) : null,
        });
      }
      return { ...page, items };
    });
  }
  async categories(actor: Actor) {
    requirePermission(actor, "products.read");
    return this.uow.read((r) => r.products.categories());
  }

  async detail(actor: Actor, id: string): Promise<ProductDetail> {
    requirePermission(actor, "products.read");
    return this.uow.read(async (r) => this.loadDetail(r, actor, id));
  }
  private async loadDetail(
    r: Repositories,
    actor: Actor,
    id: string,
  ): Promise<ProductDetail> {
    const p = await r.products.get(id);
    if (!p) throw notFound("Product");
    const canCost = can(actor, "products.cost.read");
    const [numbers, suppliers, images, links, balances, warehouses, locations] =
      await Promise.all([
        r.products.numbers(id),
        r.products.suppliers(id),
        r.products.images(id),
        r.products.links(id),
        can(actor, "inventory.read")
          ? r.inventory.balances({ productId: id })
          : Promise.resolve([] as StockBalance[]),
        r.masterData.listWarehouses(),
        r.masterData.listLocations(),
      ]);
    const stock = balances.map((b) => ({
      ...b,
      warehouseName: warehouses.find((w) => w.id === b.warehouseId)?.name ?? "",
      locationCode: locations.find((l) => l.id === b.locationId)?.code ?? "",
    }));
    return {
      product: mask(p, actor),
      numbers,
      suppliers: suppliers.map((s) => ({
        ...s,
        costMinor: canCost ? s.costMinor : null,
      })),
      images: images.map((i) => ({ ...i, url: imageUrl(i.fileId) })),
      referenceLinks: links,
      stock,
      totals: {
        onHand: balances.reduce((n, b) => n + b.onHand, 0),
        reserved: balances.reduce((n, b) => n + b.reserved, 0),
        available: balances.reduce((n, b) => n + b.available, 0),
      },
    };
  }

  async create(actor: Actor, raw: unknown): Promise<Product> {
    requirePermission(actor, "products.write");
    const input = record(raw);
    const f = productFields(input);
    const costMinor = moneyMinor(input.costMinor, "Cost price", { default: 0 });
    if (input.costMinor !== undefined && costMinor !== 0)
      requirePermission(actor, "products.cost.read");
    const opening = input.openingStock as
      { locationId?: string; quantity?: number } | undefined;
    if (opening) requirePermission(actor, "inventory.write");
    return this.uow.write(async (r) => {
      if (await r.products.getBySku(f.sku))
        throw conflict(`SKU ${f.sku} already exists.`);
      const supplierId =
        typeof input.defaultSupplierId === "string" && input.defaultSupplierId
          ? input.defaultSupplierId
          : null;
      if (supplierId && !(await r.masterData.getSupplier(supplierId)))
        throw notFound("Supplier");
      const locationId =
        typeof input.defaultLocationId === "string" && input.defaultLocationId
          ? input.defaultLocationId
          : null;
      if (locationId && !(await r.masterData.getLocation(locationId)))
        throw notFound("Location");
      const now = nowIso();
      const product: ProductRow = {
        id: newId(),
        ...f,
        costMinor,
        defaultSupplierId: supplierId,
        defaultLocationId: locationId,
        createdAt: now,
        updatedAt: now,
      };
      await r.products.insert(product, actor.id);
      await r.products.upsertNumber({
        id: newId(),
        productId: product.id,
        display: product.sku,
        normalized: normalizeNumber(product.sku),
        type: "INTERNAL_SKU",
        brand: product.brand,
        source: "Shop entry",
        market: "",
        active: true,
        primary: true,
        notes: "Shop SKU",
        supplierId: null,
        supersededByNumber: null,
      });
      if (supplierId)
        await r.products.upsertSupplier({
          id: newId(),
          productId: product.id,
          supplierId,
          supplierPartNumber: "",
          costMinor,
          currency: product.currency,
          isDefault: true,
          notes: "",
        });
      if (opening && opening.quantity) {
        if (!opening.locationId)
          throw validation("Choose a location for the opening stock.");
        await new InventoryOps(r).receive(actor, {
          productId: product.id,
          locationId: opening.locationId,
          quantity: integer(opening.quantity, "Opening quantity", {
            min: 1,
            max: 1_000_000,
          }),
          type: "OPENING_BALANCE",
          referenceType: "OPENING_BALANCE",
          note: "Opening stock",
        });
      }
      await r.audit.record(actor, {
        action: "product.create",
        entityType: "product",
        entityId: product.id,
        summary: `Product ${product.sku} ${product.name} created`,
        metadata: { sku: product.sku, priceMinor: product.priceMinor },
      });
      return mask(product, actor);
    });
  }

  async update(actor: Actor, id: string, raw: unknown): Promise<Product> {
    requirePermission(actor, "products.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const current = await r.products.get(id);
      if (!current) throw notFound("Product");
      if (
        typeof input.expectedUpdatedAt === "string" &&
        input.expectedUpdatedAt !== current.updatedAt
      )
        throw conflict(
          "This product was changed by someone else. Reload it and try again.",
          "STALE",
        );
      const f = productFields(input, current);
      let costMinor = current.costMinor;
      if (input.costMinor !== undefined) {
        if (!can(actor, "products.cost.read"))
          throw forbidden("You may not change cost prices.");
        costMinor = moneyMinor(input.costMinor, "Cost price");
      }
      const supplierId =
        input.defaultSupplierId === undefined
          ? current.defaultSupplierId
          : typeof input.defaultSupplierId === "string" &&
              input.defaultSupplierId
            ? input.defaultSupplierId
            : null;
      if (supplierId && !(await r.masterData.getSupplier(supplierId)))
        throw notFound("Supplier");
      const locationId =
        input.defaultLocationId === undefined
          ? current.defaultLocationId
          : typeof input.defaultLocationId === "string" &&
              input.defaultLocationId
            ? input.defaultLocationId
            : null;
      if (locationId && !(await r.masterData.getLocation(locationId)))
        throw notFound("Location");
      if (
        f.sku.toLowerCase() !== current.sku.toLowerCase() &&
        (await r.products.getBySku(f.sku))
      )
        throw conflict(`SKU ${f.sku} already exists.`);
      const next: ProductRow = {
        ...current,
        ...f,
        costMinor,
        defaultSupplierId: supplierId,
        defaultLocationId: locationId,
        updatedAt: nowIso(),
      };
      await r.products.update(next);
      const changed = (Object.keys(f) as (keyof typeof f)[]).filter(
        (k) => f[k] !== (current as never)[k],
      );
      if (costMinor !== current.costMinor) changed.push("costMinor" as never);
      await r.audit.record(actor, {
        action: "product.update",
        entityType: "product",
        entityId: id,
        summary: `Product ${next.sku} updated`,
        metadata: { fields: changed },
      });
      if (next.priceMinor !== current.priceMinor)
        await r.audit.record(actor, {
          action: "product.price_change",
          entityType: "product",
          entityId: id,
          summary: `Price of ${next.sku} changed`,
          metadata: { fromMinor: current.priceMinor, toMinor: next.priceMinor },
        });
      if (costMinor !== current.costMinor)
        await r.audit.record(actor, {
          action: "product.cost_change",
          entityType: "product",
          entityId: id,
          summary: `Cost of ${next.sku} changed`,
          metadata: { fromMinor: current.costMinor, toMinor: costMinor },
        });
      return mask(next, actor);
    });
  }

  // ---------------- reference catalogue -> My Products ----------------
  /**
   * Turns a reference part into a shop product. The reference record is
   * never modified: the product copies convenient fields and keeps a link
   * back. A second product for the same reference part needs an explicit
   * `allowDuplicate`, so staff cannot create duplicates by accident.
   */
  async importFromReference(
    actor: Actor,
    referencePartId: string,
    raw: unknown,
  ): Promise<Product> {
    requirePermission(actor, "products.write");
    requirePermission(actor, "catalogue.read");
    const input = record(raw);
    const f = {
      sku: text(input.sku, "SKU", { required: true, max: 64 }),
      priceMinor: moneyMinor(input.priceMinor, "Selling price", { default: 0 }),
      costMinor: moneyMinor(input.costMinor, "Cost price", { default: 0 }),
      reorderLevel: integer(input.reorderLevel, "Reorder level", {
        min: 0,
        max: 1_000_000,
        default: 0,
      }),
      openingQuantity: integer(input.openingQuantity, "Opening quantity", {
        min: 0,
        max: 1_000_000,
        default: 0,
      }),
    };
    if (input.costMinor !== undefined && f.costMinor !== 0)
      requirePermission(actor, "products.cost.read");
    if (f.openingQuantity > 0) requirePermission(actor, "inventory.write");
    return this.uow.write(async (r) => {
      const part = await r.catalogue.getPart(referencePartId);
      if (!part) throw notFound("Reference part");
      const existing = await r.products.linksForReference(referencePartId);
      if (existing.length && input.allowDuplicate !== true) {
        const p = await r.products.get(existing[0].productId);
        throw new AppError(
          "ALREADY_IMPORTED",
          `${part.oemNumber} is already in My Products as ${p?.sku ?? "another product"}. Open that product, or choose to create another one deliberately.`,
          409,
          { productId: existing[0].productId, sku: p?.sku },
        );
      }
      if (await r.products.getBySku(f.sku))
        throw conflict(`SKU ${f.sku} already exists.`);
      const supplierId =
        typeof input.supplierId === "string" && input.supplierId
          ? input.supplierId
          : null;
      if (supplierId && !(await r.masterData.getSupplier(supplierId)))
        throw notFound("Supplier");
      const locationId =
        typeof input.locationId === "string" && input.locationId
          ? input.locationId
          : null;
      if (locationId && !(await r.masterData.getLocation(locationId)))
        throw notFound("Location");
      if (f.openingQuantity > 0 && !locationId)
        throw validation("Choose a location for the opening stock.");
      const now = nowIso();
      const product: ProductRow = {
        id: newId(),
        sku: f.sku,
        name:
          text(input.name, "Name", { max: 200 }) ||
          part.description ||
          part.oemNumber,
        brand: text(input.brand, "Brand", { max: 100 }) || part.manufacturer,
        manufacturer: part.manufacturer,
        category: text(input.category, "Category", { max: 100 }),
        description: part.description,
        condition: oneOf(
          input.condition,
          productConditions,
          "Condition",
          "NEW",
        ),
        unit: "Each",
        weightGrams: 0,
        origin: "",
        status: "ACTIVE",
        costMinor: f.costMinor,
        priceMinor: f.priceMinor,
        currency: (await r.config.get()).currency,
        taxCategory: "Standard",
        reorderLevel: f.reorderLevel,
        minimumLevel: 0,
        defaultSupplierId: supplierId,
        defaultLocationId: locationId,
        notes: "",
        createdAt: now,
        updatedAt: now,
      };
      await r.products.insert(product, actor.id);
      const base = {
        productId: product.id,
        brand: part.manufacturer,
        source: "Reference catalogue",
        market: "",
        active: true,
        notes: "",
        supplierId: null,
        supersededByNumber: null as string | null,
      };
      await r.products.upsertNumber({
        ...base,
        id: newId(),
        display: product.sku,
        normalized: normalizeNumber(product.sku),
        type: "INTERNAL_SKU",
        primary: true,
        notes: "Shop SKU",
        source: "Shop entry",
      });
      const supersededBy = part.relations.find(
        (x) => x.direction === "out" && x.relation === "SUPERSEDED_BY",
      );
      await r.products.upsertNumber({
        ...base,
        id: newId(),
        display: part.oemNumber,
        normalized: normalizeNumber(part.oemNumber),
        type: "OEM_OE",
        primary: false,
        supersededByNumber: supersededBy?.relatedNumber ?? null,
      });
      const typeFor: Record<string, string> = {
        SUPERSEDES: "PREVIOUS",
        SUPERSEDED_BY: "REPLACEMENT",
        REPLACEMENT: "REPLACEMENT",
        INTERCHANGE: "INTERCHANGE",
        ALTERNATIVE: "CROSS_REFERENCE",
        EQUIVALENT: "CROSS_REFERENCE",
        CROSS_REFERENCE: "CROSS_REFERENCE",
      };
      const seen = new Set<string>([
        normalizeNumber(part.oemNumber),
        normalizeNumber(product.sku),
      ]);
      for (const rel of part.relations
        .filter((x) => x.direction === "out")
        .slice(0, 25)) {
        const norm = normalizeNumber(rel.relatedNumber);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        await r.products.upsertNumber({
          ...base,
          id: newId(),
          display: rel.relatedNumber,
          normalized: norm,
          type: typeFor[rel.relation] ?? "OTHER",
          primary: false,
          notes: `From the reference catalogue (${rel.relation.toLowerCase().replace(/_/g, " ")})`,
        });
      }
      if (supplierId)
        await r.products.upsertSupplier({
          id: newId(),
          productId: product.id,
          supplierId,
          supplierPartNumber: text(
            input.supplierPartNumber,
            "Supplier part number",
            { max: 100 },
          ),
          costMinor: f.costMinor,
          currency: product.currency,
          isDefault: true,
          notes: "",
        });
      await r.products.addLink({
        id: newId(),
        productId: product.id,
        referencePartId,
        oemNumber: part.oemNumber,
        linkedAt: now,
        linkedBy: actor.id,
        snapshot: {
          oemNumber: part.oemNumber,
          description: part.description,
          manufacturer: part.manufacturer,
          statusClass: part.statusClass,
          verification: part.verification,
          importedAt: now,
        },
      });
      if (f.openingQuantity > 0)
        await new InventoryOps(r).receive(actor, {
          productId: product.id,
          locationId: locationId!,
          quantity: f.openingQuantity,
          type: "OPENING_BALANCE",
          referenceType: "OPENING_BALANCE",
          note: "Opening stock on import from reference",
        });
      await r.audit.record(actor, {
        action: "product.import_from_reference",
        entityType: "product",
        entityId: product.id,
        summary: `${product.sku} created from reference ${part.oemNumber}`,
        metadata: {
          referencePartId,
          oemNumber: part.oemNumber,
          duplicate: existing.length > 0,
        },
      });
      return mask(product, actor);
    });
  }

  /** Links an existing product to a reference part (no data is copied). */
  async linkReference(
    actor: Actor,
    productId: string,
    referencePartId: string,
  ): Promise<ReferenceLink[]> {
    requirePermission(actor, "products.write");
    requirePermission(actor, "catalogue.read");
    return this.uow.write(async (r) => {
      const product = await r.products.get(productId);
      if (!product) throw notFound("Product");
      const part = await r.catalogue.getPart(referencePartId);
      if (!part) throw notFound("Reference part");
      const mine = await r.products.links(productId);
      if (mine.some((l) => l.referencePartId === referencePartId))
        throw conflict(
          "This product is already linked to that reference part.",
        );
      const now = nowIso();
      await r.products.addLink({
        id: newId(),
        productId,
        referencePartId,
        oemNumber: part.oemNumber,
        linkedAt: now,
        linkedBy: actor.id,
        snapshot: {
          oemNumber: part.oemNumber,
          description: part.description,
          manufacturer: part.manufacturer,
          statusClass: part.statusClass,
          verification: part.verification,
          importedAt: now,
        },
      });
      await r.audit.record(actor, {
        action: "product.reference_link",
        entityType: "product",
        entityId: productId,
        summary: `Linked to reference ${part.oemNumber}`,
        metadata: { referencePartId },
      });
      return r.products.links(productId);
    });
  }
  async unlinkReference(
    actor: Actor,
    productId: string,
    linkId: string,
  ): Promise<void> {
    requirePermission(actor, "products.write");
    await this.uow.write(async (r) => {
      const link = (await r.products.links(productId)).find(
        (l) => l.id === linkId,
      );
      if (!link) throw notFound("Reference link");
      await r.products.removeLink(linkId);
      await r.audit.record(actor, {
        action: "product.reference_unlink",
        entityType: "product",
        entityId: productId,
        summary: `Unlinked from reference ${link.oemNumber}`,
      });
    });
  }

  // ---------------- numbers ----------------
  async addNumber(
    actor: Actor,
    productId: string,
    raw: unknown,
  ): Promise<ProductNumber> {
    requirePermission(actor, "products.write");
    const input = record(raw);
    const display = text(input.display, "Number", { required: true, max: 100 });
    return this.uow.write(async (r) => {
      const product = await r.products.get(productId);
      if (!product) throw notFound("Product");
      const number: ProductNumber = {
        id: newId(),
        productId,
        display,
        normalized: normalizeNumber(display),
        type: text(input.type, "Type", { max: 40 }) || "OTHER",
        brand: text(input.brand, "Brand", { max: 100 }),
        source: text(input.source, "Source", { max: 100 }),
        market: text(input.market, "Market", { max: 60 }),
        active: input.active !== false,
        primary: false,
        notes: text(input.notes, "Notes", { max: 500 }),
        supplierId: null,
        supersededByNumber:
          text(input.supersededByNumber, "Superseded by", { max: 100 }) || null,
      };
      if (!number.normalized) throw validation("Enter a valid number.");
      const existing = (await r.products.numbers(productId)).find(
        (n) => n.type === number.type && n.normalized === number.normalized,
      );
      if (existing) throw conflict("That number is already on this product.");
      await r.products.upsertNumber(number);
      await r.audit.record(actor, {
        action: "product.number_add",
        entityType: "product",
        entityId: productId,
        summary: `Number ${display} added to ${product.sku}`,
      });
      return number;
    });
  }
  async removeNumber(actor: Actor, productId: string, numberId: string) {
    requirePermission(actor, "products.write");
    return this.uow.write(async (r) => {
      const n = (await r.products.numbers(productId)).find(
        (x) => x.id === numberId,
      );
      if (!n) throw notFound("Number");
      if (n.type === "INTERNAL_SKU")
        throw conflict("The shop SKU cannot be removed.");
      await r.products.removeNumber(numberId);
      await r.audit.record(actor, {
        action: "product.number_remove",
        entityType: "product",
        entityId: productId,
        summary: `Number ${n.display} removed`,
      });
    });
  }

  // ---------------- suppliers ----------------
  async setSupplier(
    actor: Actor,
    productId: string,
    raw: unknown,
  ): Promise<ProductSupplier> {
    requirePermission(actor, "products.write");
    const input = record(raw);
    const supplierId = text(input.supplierId, "Supplier", {
      required: true,
      max: 64,
    });
    const costGiven = input.costMinor !== undefined;
    if (costGiven) requirePermission(actor, "products.cost.read");
    return this.uow.write(async (r) => {
      if (!(await r.products.get(productId))) throw notFound("Product");
      if (!(await r.masterData.getSupplier(supplierId)))
        throw notFound("Supplier");
      const existing = (await r.products.suppliers(productId)).find(
        (s) => s.supplierId === supplierId,
      );
      const link = {
        id: existing?.id ?? newId(),
        productId,
        supplierId,
        supplierPartNumber: text(
          input.supplierPartNumber ?? existing?.supplierPartNumber,
          "Supplier part number",
          { max: 100 },
        ),
        costMinor: costGiven
          ? moneyMinor(input.costMinor, "Cost")
          : (existing?.costMinor ?? 0),
        currency: currency(input.currency ?? existing?.currency),
        isDefault:
          input.isDefault === undefined
            ? (existing?.isDefault ?? false)
            : Boolean(input.isDefault),
        notes: text(input.notes ?? existing?.notes, "Notes", { max: 500 }),
      };
      await r.products.upsertSupplier(link);
      await r.audit.record(actor, {
        action: "product.supplier_set",
        entityType: "product",
        entityId: productId,
        summary: `Supplier link updated`,
        metadata: { supplierId },
      });
      return {
        ...link,
        costMinor: can(actor, "products.cost.read") ? link.costMinor : null,
      } as ProductSupplier;
    });
  }
  async removeSupplier(actor: Actor, productId: string, linkId: string) {
    requirePermission(actor, "products.write");
    return this.uow.write(async (r) => {
      if (!(await r.products.suppliers(productId)).some((s) => s.id === linkId))
        throw notFound("Supplier link");
      await r.products.removeSupplier(linkId);
      await r.audit.record(actor, {
        action: "product.supplier_remove",
        entityType: "product",
        entityId: productId,
        summary: "Supplier link removed",
      });
    });
  }

  // ---------------- images ----------------
  async addImage(
    actor: Actor,
    productId: string,
    input: {
      bytes: Uint8Array;
      fileName: string;
      caption?: string;
      primary?: boolean;
    },
  ): Promise<ProductImage> {
    requirePermission(actor, "products.write");
    const { bytes } = input;
    if (bytes.byteLength === 0) throw validation("The file is empty.");
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw validation(
        `Images may be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    const kind = sniffImage(bytes);
    if (!kind)
      throw validation("Only PNG, JPEG, GIF or WebP images are accepted.");
    const ext = (input.fileName.split(".").pop() ?? "").toLowerCase();
    if (!IMAGE_TYPES[kind].extensions.includes(ext))
      throw validation(
        `The file name says .${ext || "?"} but the content is ${IMAGE_TYPES[kind].mime}.`,
      );
    return this.uow.write(async (r) => {
      const product = await r.products.get(productId);
      if (!product) throw notFound("Product");
      if ((await r.products.images(productId)).length >= MAX_IMAGES_PER_PRODUCT)
        throw conflict(
          `A product may have at most ${MAX_IMAGES_PER_PRODUCT} photos.`,
        );
      const file = await r.files.put({
        bytes,
        originalName: input.fileName,
        mime: IMAGE_TYPES[kind].mime,
        kind: "PRODUCT_IMAGE",
        entityType: "product",
        entityId: productId,
        createdBy: actor.id,
      });
      const image: Omit<ProductImage, "url"> = {
        id: newId(),
        productId,
        fileId: file.id,
        position: 0,
        isPrimary: Boolean(input.primary),
        caption: text(input.caption, "Caption", { max: 200 }),
        mime: file.mime,
        size: file.size,
      };
      try {
        await r.products.addImage(image, nowIso());
      } catch (error) {
        await r.files.delete(file.id);
        throw error;
      }
      await r.audit.record(actor, {
        action: "product.image_add",
        entityType: "product",
        entityId: productId,
        summary: `Photo added to ${product.sku}`,
        metadata: { fileId: file.id, size: file.size },
      });
      return {
        ...(await r.products.getImage(image.id))!,
        url: imageUrl(file.id),
      };
    });
  }
  async setPrimaryImage(actor: Actor, productId: string, imageId: string) {
    requirePermission(actor, "products.write");
    return this.uow.write(async (r) => {
      const image = await r.products.getImage(imageId);
      if (!image || image.productId !== productId) throw notFound("Photo");
      await r.products.setPrimaryImage(productId, imageId);
      await r.audit.record(actor, {
        action: "product.image_primary",
        entityType: "product",
        entityId: productId,
        summary: "Primary photo changed",
      });
    });
  }
  async reorderImages(actor: Actor, productId: string, orderedIds: string[]) {
    requirePermission(actor, "products.write");
    return this.uow.write(async (r) => {
      const existing = new Set(
        (await r.products.images(productId)).map((i) => i.id),
      );
      if (
        orderedIds.length !== existing.size ||
        !orderedIds.every((id) => existing.has(id))
      )
        throw validation("The photo order must list every photo exactly once.");
      await r.products.reorderImages(productId, orderedIds);
    });
  }
  async removeImage(actor: Actor, productId: string, imageId: string) {
    requirePermission(actor, "products.write");
    return this.uow.write(async (r) => {
      const image = await r.products.getImage(imageId);
      if (!image || image.productId !== productId) throw notFound("Photo");
      await r.products.removeImage(imageId);
      await r.files.delete(image.fileId);
      await r.audit.record(actor, {
        action: "product.image_remove",
        entityType: "product",
        entityId: productId,
        summary: "Photo removed",
      });
    });
  }
  /** Removes stored product photos that no product refers to any more. */
  async cleanupOrphanFiles(actor: Actor): Promise<number> {
    requirePermission(actor, "settings.manage");
    return this.uow.write(async (r) => {
      const orphans = await r.files.listOrphans();
      for (const f of orphans) await r.files.delete(f.id);
      if (orphans.length)
        await r.audit.record(actor, {
          action: "files.cleanup",
          entityType: "files",
          summary: `Removed ${orphans.length} orphaned file(s)`,
        });
      return orphans.length;
    });
  }

  // ---------------- lookup (barcode / QR / quick find) ----------------
  /** Resolves a scanned or typed code to a product by SKU or any number. */
  async lookup(
    actor: Actor,
    code: string,
  ): Promise<{
    product: Product;
    available: number;
    locations: {
      locationCode: string;
      warehouseName: string;
      available: number;
    }[];
    primaryImageUrl: string | null;
  } | null> {
    requirePermission(actor, "products.read");
    const trimmed = code.trim();
    if (!trimmed || trimmed.length > 100) return null;
    return this.uow.read(async (r) => {
      const p =
        (await r.products.getBySku(trimmed)) ??
        (
          await r.products.findByNormalizedNumber(normalizeNumber(trimmed))
        )[0] ??
        null;
      if (!p) return null;
      const canStock = can(actor, "inventory.read");
      const [balances, warehouses, locations, images] = await Promise.all([
        canStock
          ? r.inventory.balances({ productId: p.id })
          : Promise.resolve([] as StockBalance[]),
        r.masterData.listWarehouses(),
        r.masterData.listLocations(),
        r.products.images(p.id),
      ]);
      const primary = images.find((i) => i.isPrimary) ?? images[0];
      return {
        product: mask(p, actor),
        available: balances.reduce((n, b) => n + b.available, 0),
        locations: balances
          .filter((b) => b.onHand > 0)
          .map((b) => ({
            locationCode:
              locations.find((l) => l.id === b.locationId)?.code ?? "",
            warehouseName:
              warehouses.find((w) => w.id === b.warehouseId)?.name ?? "",
            available: b.available,
          })),
        primaryImageUrl: primary ? imageUrl(primary.fileId) : null,
      };
    });
  }
}
