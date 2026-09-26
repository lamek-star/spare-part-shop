import type { Database, Handle } from "../../db/connection";
import type { Page, PurchaseLine, PurchaseOrder } from "../../domain/types";
import type { Paged } from "../../providers/data";
import type { PurchasingRepository } from "../../providers/sales";
import { likeTerm, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const n = (v: unknown) => Number(v ?? 0);

export class SqlitePurchasingRepository implements PurchasingRepository {
  constructor(private readonly db: Database) {}

  private from(h: Handle, r: Row): PurchaseOrder {
    return {
      id: s(r.id),
      number: s(r.number),
      status: r.status as PurchaseOrder["status"],
      supplierId: s(r.supplier_id),
      locationId: s(r.location_id),
      currency: s(r.currency),
      taxBp: n(r.tax_bp),
      expectedDate: (r.expected_date as string | null) ?? null,
      notes: s(r.notes),
      subtotalMinor: n(r.subtotal_minor),
      taxMinor: n(r.tax_minor),
      totalMinor: n(r.total_minor),
      lines: h
        .all<Row>(
          "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY position",
          [s(r.id)],
        )
        .map((l): PurchaseLine => ({
          id: s(l.id),
          position: n(l.position),
          productId: s(l.product_id),
          quantity: n(l.quantity),
          quantityReceived: n(l.quantity_received),
          unitCostMinor: n(l.unit_cost_minor),
          discountBp: n(l.discount_bp),
          lineTotalMinor: n(l.line_total_minor),
        })),
      createdBy: (r.created_by as string | null) ?? null,
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
    };
  }
  private writeLines(h: Handle, o: PurchaseOrder) {
    for (const l of o.lines)
      h.run(
        `INSERT INTO purchase_order_items(id,purchase_order_id,position,product_id,quantity,quantity_received,unit_cost_minor,discount_bp,line_total_minor)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          l.id,
          o.id,
          l.position,
          l.productId,
          l.quantity,
          l.quantityReceived,
          l.unitCostMinor,
          l.discountBp,
          l.lineTotalMinor,
        ],
      );
  }
  async insertOrder(o: PurchaseOrder) {
    await this.db.write((h) => {
      h.run(
        `INSERT INTO purchase_orders(id,number,supplier_id,location_id,status,currency,tax_bp,expected_date,notes,subtotal_minor,tax_minor,total_minor,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          o.id,
          o.number,
          o.supplierId,
          o.locationId,
          o.status,
          o.currency,
          o.taxBp,
          o.expectedDate,
          o.notes,
          o.subtotalMinor,
          o.taxMinor,
          o.totalMinor,
          o.createdBy,
          o.createdAt,
          o.updatedAt,
        ],
      );
      this.writeLines(h, o);
    });
  }
  async saveOrder(o: PurchaseOrder) {
    await this.db.write((h) => {
      h.run(
        `UPDATE purchase_orders SET supplier_id=?,location_id=?,status=?,currency=?,tax_bp=?,expected_date=?,notes=?,subtotal_minor=?,tax_minor=?,total_minor=?,updated_at=? WHERE id=?`,
        [
          o.supplierId,
          o.locationId,
          o.status,
          o.currency,
          o.taxBp,
          o.expectedDate,
          o.notes,
          o.subtotalMinor,
          o.taxMinor,
          o.totalMinor,
          o.updatedAt,
          o.id,
        ],
      );
      // Draft orders may have their lines replaced; otherwise only the
      // received quantities change.
      if (o.status === "DRAFT") {
        h.run("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", [
          o.id,
        ]);
        this.writeLines(h, o);
      } else {
        for (const l of o.lines)
          h.run(
            "UPDATE purchase_order_items SET quantity_received = ? WHERE id = ?",
            [l.quantityReceived, l.id],
          );
      }
    });
  }
  getOrder(id: string) {
    return this.db.read((h) => {
      const r = h.get<Row>("SELECT * FROM purchase_orders WHERE id = ?", [id]);
      return r ? this.from(h, r) : null;
    });
  }
  listOrders(
    q: Paged & { status?: string; supplierId?: string },
  ): Promise<Page<PurchaseOrder>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.supplierId)
      (where.push("supplier_id = ?"), params.push(q.supplierId));
    if (q.q?.trim())
      (where.push("number LIKE ? ESCAPE '\\'"), params.push(likeTerm(q.q)));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read((h) => ({
      items: h
        .all<Row>(
          `SELECT * FROM purchase_orders ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        )
        .map((r) => this.from(h, r)),
      total: h.count(
        `SELECT COUNT(*) AS n FROM purchase_orders ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  async insertReceipt(r: Parameters<PurchasingRepository["insertReceipt"]>[0]) {
    await this.db.write((h) => {
      h.run(
        "INSERT INTO goods_receipts(id,number,purchase_order_id,location_id,received_at,notes,received_by) VALUES (?,?,?,?,?,?,?)",
        [
          r.id,
          r.number,
          r.purchaseOrderId,
          r.locationId,
          r.receivedAt,
          r.notes,
          r.receivedBy,
        ],
      );
      r.lines.forEach((l, i) =>
        h.run(
          "INSERT INTO goods_receipt_items(id,receipt_id,purchase_item_id,product_id,quantity) VALUES (?,?,?,?,?)",
          [`${r.id}:${i}`, r.id, l.purchaseLineId, l.productId, l.quantity],
        ),
      );
    });
  }
  receiptsForOrder(orderId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM goods_receipts WHERE purchase_order_id = ? ORDER BY received_at",
          [orderId],
        )
        .map((r) => ({
          id: s(r.id),
          number: s(r.number),
          receivedAt: s(r.received_at),
          locationId: s(r.location_id),
          lines: h
            .all<Row>(
              "SELECT * FROM goods_receipt_items WHERE receipt_id = ?",
              [s(r.id)],
            )
            .map((l) => ({
              purchaseLineId: s(l.purchase_item_id),
              productId: s(l.product_id),
              quantity: n(l.quantity),
            })),
        })),
    );
  }
}
