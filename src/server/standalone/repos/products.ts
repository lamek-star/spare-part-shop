import type { Database } from "../../db/connection";
import type {
  Page,
  ProductImage,
  ProductNumber,
  ProductSupplier,
  ReferenceLink,
} from "../../domain/types";
import type {
  ProductQuery,
  ProductRepository,
  ProductRow,
} from "../../providers/data";
import { normalizeNumber } from "../../kernel/ids";
import { likeTerm, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const product = (r: Row): ProductRow => ({
  id: s(r.id),
  sku: s(r.sku),
  name: s(r.name),
  brand: s(r.brand),
  manufacturer: s(r.manufacturer),
  category: s(r.category),
  description: s(r.description),
  condition: r.condition as ProductRow["condition"],
  unit: s(r.unit),
  weightGrams: Number(r.weight_grams),
  origin: s(r.origin),
  status: r.status as ProductRow["status"],
  costMinor: Number(r.cost_minor),
  priceMinor: Number(r.price_minor),
  currency: s(r.currency),
  taxCategory: s(r.tax_category),
  reorderLevel: Number(r.reorder_level),
  minimumLevel: Number(r.minimum_level),
  defaultSupplierId: (r.default_supplier_id as string | null) ?? null,
  defaultLocationId: (r.default_location_id as string | null) ?? null,
  notes: s(r.notes),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});
const number = (r: Row): ProductNumber => ({
  id: s(r.id),
  productId: s(r.product_id),
  display: s(r.display),
  normalized: s(r.normalized),
  type: s(r.type),
  brand: s(r.brand),
  source: s(r.source),
  market: s(r.market),
  active: Boolean(r.active),
  primary: Boolean(r.primary_flag),
  notes: s(r.notes),
  supplierId: (r.supplier_id as string | null) ?? null,
  supersededByNumber: (r.superseded_by_number as string | null) ?? null,
});

export class SqliteProductRepository implements ProductRepository {
  constructor(private readonly db: Database) {}

  async list(query: ProductQuery): Promise<Page<ProductRow>> {
    const { page, pageSize, offset } = pageArgs(query.page, query.pageSize);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.q?.trim()) {
      const t = likeTerm(query.q);
      const n = normalizeNumber(query.q);
      where.push(
        `(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM product_numbers n WHERE n.product_id = p.id AND n.normalized LIKE ? ESCAPE '\\'))`,
      );
      params.push(
        t,
        t,
        t,
        t,
        n ? `%${n.replace(/[\\%_]/g, (c) => "\\" + c)}%` : t,
      );
    }
    if (query.status) (where.push("p.status = ?"), params.push(query.status));
    if (query.category)
      (where.push("p.category = ? COLLATE NOCASE"),
        params.push(query.category));
    if (query.brand)
      (where.push("p.brand = ? COLLATE NOCASE"), params.push(query.brand));
    if (query.lowStockOnly)
      where.push(
        `p.reorder_level > 0 AND p.status = 'ACTIVE' AND
         COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM stock_balances b WHERE b.product_id = p.id), 0) <= p.reorder_level`,
      );
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read((h) => ({
      items: h
        .all<Row>(
          `SELECT p.* FROM products p ${clause} ORDER BY p.name COLLATE NOCASE, p.sku LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        )
        .map(product),
      total: h.count(`SELECT COUNT(*) AS n FROM products p ${clause}`, params),
      page,
      pageSize,
    }));
  }
  async get(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM products WHERE id = ?", [id]),
    );
    return r ? product(r) : null;
  }
  async getBySku(sku: string) {
    const r = await this.db.read((h) =>
      h.get<Row>("SELECT * FROM products WHERE sku = ? COLLATE NOCASE", [sku]),
    );
    return r ? product(r) : null;
  }
  async findByNormalizedNumber(normalized: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT DISTINCT p.* FROM products p JOIN product_numbers n ON n.product_id = p.id WHERE n.normalized = ? ORDER BY p.name`,
          [normalized],
        )
        .map(product),
    );
  }
  async insert(p: ProductRow, createdBy: string | null) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO products(id,sku,name,brand,manufacturer,category,description,condition,unit,weight_grams,origin,status,cost_minor,price_minor,currency,tax_category,reorder_level,minimum_level,default_supplier_id,default_location_id,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          p.id,
          p.sku,
          p.name,
          p.brand,
          p.manufacturer,
          p.category,
          p.description,
          p.condition,
          p.unit,
          p.weightGrams,
          p.origin,
          p.status,
          p.costMinor,
          p.priceMinor,
          p.currency,
          p.taxCategory,
          p.reorderLevel,
          p.minimumLevel,
          p.defaultSupplierId,
          p.defaultLocationId,
          p.notes,
          createdBy,
          p.createdAt,
          p.updatedAt,
        ],
      ),
    );
  }
  async update(p: ProductRow) {
    await this.db.write((h) =>
      h.run(
        `UPDATE products SET sku=?,name=?,brand=?,manufacturer=?,category=?,description=?,condition=?,unit=?,weight_grams=?,origin=?,status=?,cost_minor=?,price_minor=?,currency=?,tax_category=?,reorder_level=?,minimum_level=?,default_supplier_id=?,default_location_id=?,notes=?,updated_at=? WHERE id=?`,
        [
          p.sku,
          p.name,
          p.brand,
          p.manufacturer,
          p.category,
          p.description,
          p.condition,
          p.unit,
          p.weightGrams,
          p.origin,
          p.status,
          p.costMinor,
          p.priceMinor,
          p.currency,
          p.taxCategory,
          p.reorderLevel,
          p.minimumLevel,
          p.defaultSupplierId,
          p.defaultLocationId,
          p.notes,
          p.updatedAt,
          p.id,
        ],
      ),
    );
  }
  categories() {
    return this.db.read((h) =>
      h
        .all<{ category: string }>(
          "SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category COLLATE NOCASE",
        )
        .map((r) => r.category),
    );
  }

  numbers(productId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM product_numbers WHERE product_id = ? ORDER BY primary_flag DESC, type, display",
          [productId],
        )
        .map(number),
    );
  }
  async upsertNumber(n: ProductNumber) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO product_numbers(id,product_id,display,normalized,type,brand,source,market,active,primary_flag,notes,supplier_id,superseded_by_number)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET display=excluded.display, normalized=excluded.normalized, type=excluded.type, brand=excluded.brand,
           source=excluded.source, market=excluded.market, active=excluded.active, primary_flag=excluded.primary_flag, notes=excluded.notes,
           supplier_id=excluded.supplier_id, superseded_by_number=excluded.superseded_by_number`,
        [
          n.id,
          n.productId,
          n.display,
          n.normalized,
          n.type,
          n.brand,
          n.source,
          n.market,
          n.active,
          n.primary,
          n.notes,
          n.supplierId,
          n.supersededByNumber,
        ],
      ),
    );
  }
  async removeNumber(id: string) {
    await this.db.write((h) =>
      h.run("DELETE FROM product_numbers WHERE id = ?", [id]),
    );
  }

  suppliers(productId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM product_suppliers WHERE product_id = ? ORDER BY is_default DESC, supplier_id",
          [productId],
        )
        .map((r) => ({
          id: s(r.id),
          productId: s(r.product_id),
          supplierId: s(r.supplier_id),
          supplierPartNumber: s(r.supplier_part_number),
          costMinor: Number(r.cost_minor),
          currency: s(r.currency),
          isDefault: Boolean(r.is_default),
          notes: s(r.notes),
        })),
    ) as Promise<(ProductSupplier & { costMinor: number })[]>;
  }
  async upsertSupplier(x: ProductSupplier & { costMinor: number }) {
    await this.db.write((h) => {
      if (x.isDefault)
        h.run(
          "UPDATE product_suppliers SET is_default = 0 WHERE product_id = ? AND id <> ?",
          [x.productId, x.id],
        );
      h.run(
        `INSERT INTO product_suppliers(id,product_id,supplier_id,supplier_part_number,cost_minor,currency,is_default,notes)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET supplier_part_number=excluded.supplier_part_number, cost_minor=excluded.cost_minor,
           currency=excluded.currency, is_default=excluded.is_default, notes=excluded.notes`,
        [
          x.id,
          x.productId,
          x.supplierId,
          x.supplierPartNumber,
          x.costMinor,
          x.currency,
          x.isDefault,
          x.notes,
        ],
      );
    });
  }
  async removeSupplier(id: string) {
    await this.db.write((h) =>
      h.run("DELETE FROM product_suppliers WHERE id = ?", [id]),
    );
  }

  private image = (r: Row): Omit<ProductImage, "url"> => ({
    id: s(r.id),
    productId: s(r.product_id),
    fileId: s(r.file_id),
    position: Number(r.position),
    isPrimary: Boolean(r.is_primary),
    caption: s(r.caption),
    mime: s(r.mime),
    size: Number(r.size),
  });
  images(productId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT i.*, f.mime, f.size FROM product_images i JOIN files f ON f.id = i.file_id
            WHERE i.product_id = ? ORDER BY i.position, i.created_at`,
          [productId],
        )
        .map(this.image),
    );
  }
  async getImage(id: string) {
    const r = await this.db.read((h) =>
      h.get<Row>(
        "SELECT i.*, f.mime, f.size FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.id = ?",
        [id],
      ),
    );
    return r ? this.image(r) : null;
  }
  async addImage(i: Omit<ProductImage, "url">, createdAt: string) {
    await this.db.write((h) => {
      const next = h.get<{ n: number }>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM product_images WHERE product_id = ?",
        [i.productId],
      )!.n;
      const hasPrimary =
        h.count(
          "SELECT COUNT(*) AS n FROM product_images WHERE product_id = ? AND is_primary = 1",
          [i.productId],
        ) > 0;
      h.run(
        "INSERT INTO product_images(id,product_id,file_id,position,is_primary,caption,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          i.id,
          i.productId,
          i.fileId,
          next,
          i.isPrimary || !hasPrimary ? 1 : 0,
          i.caption,
          createdAt,
        ],
      );
      if (i.isPrimary && hasPrimary) {
        h.run(
          "UPDATE product_images SET is_primary = 0 WHERE product_id = ? AND id <> ?",
          [i.productId, i.id],
        );
      }
    });
  }
  async setPrimaryImage(productId: string, imageId: string) {
    await this.db.write((h) => {
      h.run("UPDATE product_images SET is_primary = 0 WHERE product_id = ?", [
        productId,
      ]);
      h.run(
        "UPDATE product_images SET is_primary = 1 WHERE product_id = ? AND id = ?",
        [productId, imageId],
      );
    });
  }
  async reorderImages(productId: string, orderedIds: string[]) {
    await this.db.write((h) => {
      orderedIds.forEach((id, index) =>
        h.run(
          "UPDATE product_images SET position = ? WHERE product_id = ? AND id = ?",
          [index, productId, id],
        ),
      );
    });
  }
  async removeImage(id: string) {
    await this.db.write((h) => {
      const row = h.get<{ product_id: string; is_primary: number }>(
        "SELECT product_id, is_primary FROM product_images WHERE id = ?",
        [id],
      );
      h.run("DELETE FROM product_images WHERE id = ?", [id]);
      if (row?.is_primary) {
        const next = h.get<{ id: string }>(
          "SELECT id FROM product_images WHERE product_id = ? ORDER BY position LIMIT 1",
          [row.product_id],
        );
        if (next)
          h.run("UPDATE product_images SET is_primary = 1 WHERE id = ?", [
            next.id,
          ]);
      }
    });
  }

  private link = (r: Row): ReferenceLink => ({
    id: s(r.id),
    productId: s(r.product_id),
    referencePartId: s(r.reference_part_id),
    oemNumber: s(r.oem_number),
    linkedAt: s(r.linked_at),
  });
  links(productId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM product_reference_links WHERE product_id = ? ORDER BY linked_at",
          [productId],
        )
        .map(this.link),
    );
  }
  linksForReference(referencePartId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM product_reference_links WHERE reference_part_id = ? ORDER BY linked_at",
          [referencePartId],
        )
        .map(this.link),
    );
  }
  async addLink(
    l: ReferenceLink & { snapshot: unknown; linkedBy: string | null },
  ) {
    await this.db.write((h) =>
      h.run(
        "INSERT INTO product_reference_links(id,product_id,reference_part_id,oem_number,snapshot,linked_at,linked_by) VALUES (?,?,?,?,?,?,?)",
        [
          l.id,
          l.productId,
          l.referencePartId,
          l.oemNumber,
          JSON.stringify(l.snapshot ?? null),
          l.linkedAt,
          l.linkedBy,
        ],
      ),
    );
  }
  async removeLink(id: string) {
    await this.db.write((h) =>
      h.run("DELETE FROM product_reference_links WHERE id = ?", [id]),
    );
  }
}
