import type { Database } from "../../db/connection";
import type {
  Page,
  Reservation,
  StockBalance,
  StockMovement,
} from "../../domain/types";
import type {
  BalanceQuery,
  InventoryRepository,
  MovementQuery,
} from "../../providers/data";
import { nowIso } from "../../kernel/ids";
import { conflict } from "../../kernel/errors";
import { pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const movement = (r: Row): StockMovement => ({
  id: s(r.id),
  productId: s(r.product_id),
  locationId: s(r.location_id),
  type: r.type as StockMovement["type"],
  quantity: Number(r.quantity),
  referenceType: s(r.reference_type),
  referenceId: (r.reference_id as string | null) ?? null,
  note: s(r.note),
  createdAt: s(r.created_at),
  createdBy: (r.created_by as string | null) ?? null,
});
const reservation = (r: Row): Reservation => ({
  id: s(r.id),
  productId: s(r.product_id),
  locationId: s(r.location_id),
  quantity: Number(r.quantity),
  status: r.status as Reservation["status"],
  referenceType: s(r.reference_type),
  referenceId: s(r.reference_id),
  createdAt: s(r.created_at),
  closedAt: (r.closed_at as string | null) ?? null,
});
const balance = (r: Row): StockBalance => ({
  productId: s(r.product_id),
  locationId: s(r.location_id),
  warehouseId: s(r.warehouse_id),
  onHand: Number(r.on_hand),
  reserved: Number(r.reserved),
  available: Number(r.on_hand) - Number(r.reserved),
});

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Database) {}

  async balance(productId: string, locationId: string) {
    const r = await this.db.read((h) =>
      h.get<Row>(
        `SELECT b.*, l.warehouse_id FROM stock_balances b JOIN locations l ON l.id = b.location_id
          WHERE b.product_id = ? AND b.location_id = ?`,
        [productId, locationId],
      ),
    );
    return r ? balance(r) : null;
  }
  async balances(q: BalanceQuery) {
    const where: string[] = [];
    const params: string[] = [];
    if (q.productId) (where.push("b.product_id = ?"), params.push(q.productId));
    if (q.locationId)
      (where.push("b.location_id = ?"), params.push(q.locationId));
    if (q.warehouseId)
      (where.push("l.warehouse_id = ?"), params.push(q.warehouseId));
    if (q.onlyPositive) where.push("b.on_hand > 0");
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT b.*, l.warehouse_id FROM stock_balances b JOIN locations l ON l.id = b.location_id
            ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY b.product_id, l.code`,
          params,
        )
        .map(balance),
    );
  }
  async applyDelta(
    productId: string,
    locationId: string,
    onHandDelta: number,
    reservedDelta: number,
  ) {
    try {
      await this.db.write((h) => {
        h.run(
          `INSERT INTO stock_balances(product_id, location_id, on_hand, reserved, updated_at) VALUES (?,?,0,0,?)
           ON CONFLICT(product_id, location_id) DO NOTHING`,
          [productId, locationId, nowIso()],
        );
        h.run(
          `UPDATE stock_balances SET on_hand = on_hand + ?, reserved = reserved + ?, updated_at = ?
            WHERE product_id = ? AND location_id = ?`,
          [onHandDelta, reservedDelta, nowIso(), productId, locationId],
        );
      });
    } catch (error) {
      if (/CHECK constraint/i.test(String((error as Error).message)))
        throw conflict("Insufficient available stock.", "INSUFFICIENT_STOCK");
      throw error;
    }
  }
  async insertMovement(m: StockMovement & { transferId?: string | null }) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO stock_movements(id,product_id,location_id,type,quantity,reference_type,reference_id,transfer_id,note,created_at,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          m.id,
          m.productId,
          m.locationId,
          m.type,
          m.quantity,
          m.referenceType,
          m.referenceId,
          m.transferId ?? null,
          m.note,
          m.createdAt,
          m.createdBy,
        ],
      ),
    );
  }
  async listMovements(q: MovementQuery): Promise<Page<StockMovement>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize, 500);
    const where: string[] = [];
    const params: string[] = [];
    if (q.productId) (where.push("product_id = ?"), params.push(q.productId));
    if (q.locationId)
      (where.push("location_id = ?"), params.push(q.locationId));
    if (q.referenceType)
      (where.push("reference_type = ?"), params.push(q.referenceType));
    if (q.referenceId)
      (where.push("reference_id = ?"), params.push(q.referenceId));
    if (q.type) (where.push("type = ?"), params.push(q.type));
    if (q.from) (where.push("created_at >= ?"), params.push(q.from));
    if (q.to) (where.push("created_at <= ?"), params.push(q.to));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read((h) => ({
      items: h
        .all<Row>(
          `SELECT * FROM stock_movements ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        )
        .map(movement),
      total: h.count(
        `SELECT COUNT(*) AS n FROM stock_movements ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  async insertReservation(r: Reservation) {
    await this.db.write((h) =>
      h.run(
        `INSERT INTO reservations(id,product_id,location_id,quantity,status,reference_type,reference_id,created_at,closed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          r.id,
          r.productId,
          r.locationId,
          r.quantity,
          r.status,
          r.referenceType,
          r.referenceId,
          r.createdAt,
          r.closedAt,
        ],
      ),
    );
  }
  activeReservations(referenceType: string, referenceId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM reservations WHERE reference_type = ? AND reference_id = ? AND status = 'ACTIVE' ORDER BY created_at",
          [referenceType, referenceId],
        )
        .map(reservation),
    );
  }
  reservationsFor(referenceType: string, referenceId: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          "SELECT * FROM reservations WHERE reference_type = ? AND reference_id = ? ORDER BY created_at",
          [referenceType, referenceId],
        )
        .map(reservation),
    );
  }
  async closeReservation(
    id: string,
    status: "RELEASED" | "FULFILLED",
    closedAt: string,
  ) {
    await this.db.write((h) =>
      h.run(
        "UPDATE reservations SET status = ?, closed_at = ? WHERE id = ? AND status = 'ACTIVE'",
        [status, closedAt, id],
      ),
    );
  }
  async fulfillReservation(
    id: string,
    quantity: number,
    closedAt: string,
    newId: string,
  ) {
    await this.db.write((h) => {
      const r = h.get<Row>(
        "SELECT * FROM reservations WHERE id = ? AND status = 'ACTIVE'",
        [id],
      );
      if (!r) throw conflict("Reservation is no longer active.");
      const total = Number(r.quantity);
      if (quantity <= 0 || quantity > total)
        throw conflict("Invalid quantity for this reservation.");
      h.run(
        "UPDATE reservations SET quantity = ?, status = 'FULFILLED', closed_at = ? WHERE id = ?",
        [quantity, closedAt, id],
      );
      if (quantity < total)
        h.run(
          `INSERT INTO reservations(id,product_id,location_id,quantity,status,reference_type,reference_id,created_at,closed_at)
           VALUES (?,?,?,?, 'ACTIVE', ?,?,?,NULL)`,
          [
            newId,
            r.product_id as string,
            r.location_id as string,
            total - quantity,
            r.reference_type as string,
            r.reference_id as string,
            r.created_at as string,
          ],
        );
    });
  }
  async verifyIntegrity() {
    return this.db.read((h) => {
      const problems: {
        productId: string;
        locationId: string;
        field: "on_hand" | "reserved";
        stored: number;
        expected: number;
      }[] = [];
      const rows = h.all<{
        product_id: string;
        location_id: string;
        on_hand: number;
        reserved: number;
        m: number;
        r: number;
      }>(
        `SELECT b.product_id, b.location_id, b.on_hand, b.reserved,
                COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id = b.product_id AND m.location_id = b.location_id), 0) AS m,
                COALESCE((SELECT SUM(quantity) FROM reservations r WHERE r.product_id = b.product_id AND r.location_id = b.location_id AND r.status = 'ACTIVE'), 0) AS r
           FROM stock_balances b`,
      );
      for (const r of rows) {
        if (r.on_hand !== r.m)
          problems.push({
            productId: r.product_id,
            locationId: r.location_id,
            field: "on_hand",
            stored: r.on_hand,
            expected: r.m,
          });
        if (r.reserved !== r.r)
          problems.push({
            productId: r.product_id,
            locationId: r.location_id,
            field: "reserved",
            stored: r.reserved,
            expected: r.r,
          });
      }
      return problems;
    });
  }
}
