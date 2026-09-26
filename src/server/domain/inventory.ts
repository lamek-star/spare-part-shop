import type { Repositories, UnitOfWork } from "../providers/uow";
import type {
  Actor,
  MovementType,
  Page,
  Reservation,
  StockBalance,
  StockMovement,
} from "./types";
import { conflict, notFound, validation } from "../kernel/errors";
import { newId, nowIso } from "../kernel/ids";
import { requirePermission } from "./permissions";
import { integer, record, text } from "./validate";

const positive = (q: number, field = "Quantity") => {
  if (!Number.isInteger(q) || q <= 0)
    throw validation(`${field} must be a whole number greater than zero.`);
  return q;
};
export interface ReserveRequest {
  productId: string;
  quantity: number;
  referenceType: string;
  referenceId: string;
  preferredLocationId?: string | null;
}

/**
 * Stock rules, as pure operations over a Repositories bundle so that any
 * workflow (sales, purchasing, manual adjustment) can run them inside its
 * own transaction. Stock is never edited in place: every change is an
 * immutable movement plus a checked balance update, and the database
 * itself rejects negative on-hand or reserved > on-hand.
 *
 *   available = on_hand - reserved
 *   reserve  : reserved += q          (order confirmed)
 *   release  : reserved -= q          (order/quote cancelled)
 *   fulfill  : on_hand -= q, reserved -= q, SALE movement (goods issued)
 */
export class InventoryOps {
  constructor(private readonly r: Repositories) {}

  private async requireProduct(productId: string) {
    const p = await this.r.products.get(productId);
    if (!p) throw notFound("Product");
    return p;
  }
  private async requireLocation(locationId: string) {
    const l = await this.r.masterData.getLocation(locationId);
    if (!l) throw notFound("Location");
    return l;
  }
  private async move(
    actor: Pick<Actor, "id"> | null,
    m: {
      productId: string;
      locationId: string;
      type: MovementType;
      quantity: number;
      referenceType?: string;
      referenceId?: string | null;
      note?: string;
      transferId?: string;
    },
  ) {
    await this.r.inventory.insertMovement({
      id: newId(),
      productId: m.productId,
      locationId: m.locationId,
      type: m.type,
      quantity: m.quantity,
      referenceType: m.referenceType ?? "",
      referenceId: m.referenceId ?? null,
      note: (m.note ?? "").slice(0, 500),
      createdAt: nowIso(),
      createdBy: actor?.id ?? null,
      transferId: m.transferId ?? null,
    });
    await this.r.inventory.applyDelta(m.productId, m.locationId, m.quantity, 0);
  }

  async receive(
    actor: Pick<Actor, "id"> | null,
    i: {
      productId: string;
      locationId: string;
      quantity: number;
      type?: "RECEIPT" | "OPENING_BALANCE";
      referenceType?: string;
      referenceId?: string | null;
      note?: string;
    },
  ) {
    positive(i.quantity);
    await this.requireProduct(i.productId);
    await this.requireLocation(i.locationId);
    await this.move(actor, { ...i, type: i.type ?? "RECEIPT" });
  }

  async adjust(
    actor: Pick<Actor, "id"> | null,
    i: { productId: string; locationId: string; delta: number; reason: string },
  ) {
    if (!Number.isInteger(i.delta) || i.delta === 0)
      throw validation("Adjustment must be a non-zero whole number.");
    if (!i.reason.trim())
      throw validation("Give a reason for the stock adjustment.");
    await this.requireProduct(i.productId);
    await this.requireLocation(i.locationId);
    if (i.delta < 0) {
      const b = await this.r.inventory.balance(i.productId, i.locationId);
      const onHand = b?.onHand ?? 0;
      const reserved = b?.reserved ?? 0;
      if (onHand + i.delta < 0)
        throw conflict(
          `Only ${onHand} on hand at this location.`,
          "INSUFFICIENT_STOCK",
        );
      if (onHand + i.delta < reserved)
        throw conflict(
          `${reserved} of the stock here is reserved for orders; release those first.`,
          "INSUFFICIENT_STOCK",
        );
    }
    await this.move(actor, {
      productId: i.productId,
      locationId: i.locationId,
      type: i.delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: i.delta,
      referenceType: "ADJUSTMENT",
      note: i.reason,
    });
  }

  async transfer(
    actor: Pick<Actor, "id"> | null,
    i: {
      productId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      note?: string;
    },
  ) {
    positive(i.quantity);
    if (i.fromLocationId === i.toLocationId)
      throw validation("Choose two different locations.");
    await this.requireProduct(i.productId);
    await this.requireLocation(i.fromLocationId);
    await this.requireLocation(i.toLocationId);
    const b = await this.r.inventory.balance(i.productId, i.fromLocationId);
    const available = (b?.onHand ?? 0) - (b?.reserved ?? 0);
    if (available < i.quantity)
      throw conflict(
        `Only ${available} available to transfer from this location.`,
        "INSUFFICIENT_STOCK",
      );
    const transferId = newId();
    await this.move(actor, {
      productId: i.productId,
      locationId: i.fromLocationId,
      type: "TRANSFER_OUT",
      quantity: -i.quantity,
      referenceType: "TRANSFER",
      referenceId: transferId,
      note: i.note,
      transferId,
    });
    await this.move(actor, {
      productId: i.productId,
      locationId: i.toLocationId,
      type: "TRANSFER_IN",
      quantity: i.quantity,
      referenceType: "TRANSFER",
      referenceId: transferId,
      note: i.note,
      transferId,
    });
    return transferId;
  }

  /** Total available across every location. */
  async availableFor(productId: string): Promise<number> {
    return (await this.r.inventory.balances({ productId })).reduce(
      (n, b) => n + b.available,
      0,
    );
  }

  async reserve(req: ReserveRequest): Promise<Reservation[]> {
    positive(req.quantity);
    const product = await this.requireProduct(req.productId);
    if (product.status !== "ACTIVE")
      throw conflict(`${product.sku} is inactive and cannot be reserved.`);
    const balances = (
      await this.r.inventory.balances({ productId: req.productId })
    ).filter((b) => b.available > 0);
    const preferred = req.preferredLocationId ?? product.defaultLocationId;
    balances.sort(
      (a, b) =>
        Number(b.locationId === preferred) -
          Number(a.locationId === preferred) || b.available - a.available,
    );
    const total = balances.reduce((n, b) => n + b.available, 0);
    if (total < req.quantity)
      throw conflict(
        `Insufficient available stock for ${product.sku}: ${req.quantity} requested, ${total} available.`,
        "INSUFFICIENT_STOCK",
      );
    let remaining = req.quantity;
    const made: Reservation[] = [];
    for (const b of balances) {
      if (remaining === 0) break;
      const take = Math.min(remaining, b.available);
      const reservation: Reservation = {
        id: newId(),
        productId: req.productId,
        locationId: b.locationId,
        quantity: take,
        status: "ACTIVE",
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        createdAt: nowIso(),
        closedAt: null,
      };
      await this.r.inventory.insertReservation(reservation);
      await this.r.inventory.applyDelta(req.productId, b.locationId, 0, take);
      made.push(reservation);
      remaining -= take;
    }
    return made;
  }

  /** Releases every active reservation held for a reference. */
  async releaseAll(
    referenceType: string,
    referenceId: string,
  ): Promise<number> {
    const held = await this.r.inventory.activeReservations(
      referenceType,
      referenceId,
    );
    for (const res of held) {
      await this.r.inventory.applyDelta(
        res.productId,
        res.locationId,
        0,
        -res.quantity,
      );
      await this.r.inventory.closeReservation(res.id, "RELEASED", nowIso());
    }
    return held.reduce((n, x) => n + x.quantity, 0);
  }

  /** Issues goods against a reservation: on-hand and reserved both drop and
   * a SALE movement is written at the location the stock came from. */
  async fulfill(
    actor: Pick<Actor, "id"> | null,
    i: {
      referenceType: string;
      referenceId: string;
      movementReferenceType: string;
      movementReferenceId: string;
      quantity: number;
      note?: string;
    },
  ) {
    positive(i.quantity);
    const held = await this.r.inventory.activeReservations(
      i.referenceType,
      i.referenceId,
    );
    const reservedTotal = held.reduce((n, x) => n + x.quantity, 0);
    if (reservedTotal < i.quantity)
      throw conflict(
        "There is not enough reserved stock to fulfil that quantity.",
        "INSUFFICIENT_STOCK",
      );
    let remaining = i.quantity;
    for (const res of held) {
      if (remaining === 0) break;
      const take = Math.min(res.quantity, remaining);
      await this.r.inventory.fulfillReservation(
        res.id,
        take,
        nowIso(),
        newId(),
      );
      await this.r.inventory.insertMovement({
        id: newId(),
        productId: res.productId,
        locationId: res.locationId,
        type: "SALE",
        quantity: -take,
        referenceType: i.movementReferenceType,
        referenceId: i.movementReferenceId,
        note: (i.note ?? "").slice(0, 500),
        createdAt: nowIso(),
        createdBy: actor?.id ?? null,
      });
      await this.r.inventory.applyDelta(
        res.productId,
        res.locationId,
        -take,
        -take,
      );
      remaining -= take;
    }
  }

  async returnIn(
    actor: Pick<Actor, "id"> | null,
    i: {
      productId: string;
      locationId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      note?: string;
    },
  ) {
    positive(i.quantity);
    await this.requireLocation(i.locationId);
    await this.move(actor, {
      productId: i.productId,
      locationId: i.locationId,
      type: "RETURN_IN",
      quantity: i.quantity,
      referenceType: i.referenceType,
      referenceId: i.referenceId,
      note: i.note,
    });
  }
}

export class InventoryService {
  constructor(private readonly uow: UnitOfWork) {}

  async receive(actor: Actor, raw: unknown) {
    requirePermission(actor, "inventory.write");
    const i = record(raw);
    const args = {
      productId: text(i.productId, "Product", { required: true, max: 64 }),
      locationId: text(i.locationId, "Location", { required: true, max: 64 }),
      quantity: integer(i.quantity, "Quantity", { min: 1, max: 1_000_000 }),
      note: text(i.note, "Note", { max: 500 }),
    };
    return this.uow.write(async (r) => {
      await new InventoryOps(r).receive(actor, {
        ...args,
        referenceType: "MANUAL_RECEIPT",
      });
      await r.audit.record(actor, {
        action: "stock.receive",
        entityType: "product",
        entityId: args.productId,
        summary: `Received ${args.quantity} units`,
        metadata: { locationId: args.locationId, quantity: args.quantity },
      });
    });
  }
  async adjust(actor: Actor, raw: unknown) {
    requirePermission(actor, "inventory.write");
    const i = record(raw);
    const args = {
      productId: text(i.productId, "Product", { required: true, max: 64 }),
      locationId: text(i.locationId, "Location", { required: true, max: 64 }),
      delta: integer(i.delta, "Adjustment", {
        min: -1_000_000,
        max: 1_000_000,
      }),
      reason: text(i.reason, "Reason", { required: true, max: 500 }),
    };
    return this.uow.write(async (r) => {
      await new InventoryOps(r).adjust(actor, args);
      await r.audit.record(actor, {
        action: "stock.adjust",
        entityType: "product",
        entityId: args.productId,
        summary: `Stock adjusted by ${args.delta}: ${args.reason}`,
        metadata: { locationId: args.locationId, delta: args.delta },
      });
    });
  }
  async transfer(actor: Actor, raw: unknown) {
    requirePermission(actor, "inventory.write");
    const i = record(raw);
    const args = {
      productId: text(i.productId, "Product", { required: true, max: 64 }),
      fromLocationId: text(i.fromLocationId, "From location", {
        required: true,
        max: 64,
      }),
      toLocationId: text(i.toLocationId, "To location", {
        required: true,
        max: 64,
      }),
      quantity: integer(i.quantity, "Quantity", { min: 1, max: 1_000_000 }),
      note: text(i.note, "Note", { max: 500 }),
    };
    return this.uow.write(async (r) => {
      const id = await new InventoryOps(r).transfer(actor, args);
      await r.audit.record(actor, {
        action: "stock.transfer",
        entityType: "product",
        entityId: args.productId,
        summary: `Transferred ${args.quantity} units`,
        metadata: {
          from: args.fromLocationId,
          to: args.toLocationId,
          transferId: id,
        },
      });
      return { transferId: id };
    });
  }
  async stockFor(actor: Actor, productId: string): Promise<StockBalance[]> {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.inventory.balances({ productId }));
  }
  async balances(
    actor: Actor,
    q: { warehouseId?: string; locationId?: string },
  ): Promise<StockBalance[]> {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.inventory.balances({ ...q }));
  }
  async movements(
    actor: Actor,
    q: {
      productId?: string;
      locationId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Page<StockMovement>> {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.inventory.listMovements(q));
  }
  async stockLevels(actor: Actor, q: { q?: string; warehouseId?: string; page?: number; pageSize?: number }) {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.reports.stockLevels(q));
  }
  async verifyIntegrity(actor: Actor) {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.inventory.verifyIntegrity());
  }
}
