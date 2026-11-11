import type { Repositories, UnitOfWork } from "../providers/uow";
import type {
  Actor,
  MovementType,
  Page,
  Product,
  Reservation,
  StockBalance,
  StockBatch,
  StockMovement,
} from "./types";
import { conflict, notFound, validation } from "../kernel/errors";
import { newId, nowIso } from "../kernel/ids";
import { requirePermission } from "./permissions";
import { integer, isoDate, record, text } from "./validate";

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

/** A supplier batch as written on the pack: its number and its expiry date. */
export interface BatchInput {
  batchNo: string;
  expiryDate: string;
}

/** Today as YYYY-MM-DD. A batch is sellable up to and including its expiry day. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Validates a batch number and expiry date, or returns undefined when neither is given. */
export function batchInput(
  batchNo: unknown,
  expiryDate: unknown,
): BatchInput | undefined {
  const no = text(batchNo, "Batch number", { max: 60 });
  const expiry = isoDate(expiryDate, "Expiry date");
  if (!no && !expiry) return undefined;
  if (!no) throw validation("Enter the batch number printed on the pack.");
  if (!expiry) throw validation("Enter the expiry date printed on the pack.");
  return { batchNo: no, expiryDate: expiry };
}

interface MoveInput {
  productId: string;
  locationId: string;
  type: MovementType;
  quantity: number;
  referenceType?: string;
  referenceId?: string | null;
  note?: string;
  transferId?: string;
  /** Batch-tracked products: the batch received (positive movements). */
  batch?: BatchInput;
  /** Batch-tracked products: an existing batch to take from or add to. */
  batchId?: string | null;
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
 *
 * A product that tracks batches (medicines) also keeps, per location, batches with an expiry date that
 * always add up to its on-hand: every movement of it names one batch, stock leaves earliest expiry
 * first, and expired batches are never sold or reserved (they can only be written off or moved).
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

  /** The batch a positive movement adds to: an existing batch, or the one named, created if new. */
  private async batchFor(
    product: Pick<Product, "id" | "sku">,
    locationId: string,
    batch: BatchInput | undefined,
    batchId: string | null | undefined,
  ): Promise<StockBatch> {
    let identity = batch;
    if (batchId) {
      const existing = await this.r.inventory.getBatch(batchId);
      if (!existing || existing.productId !== product.id)
        throw notFound("Batch");
      if (existing.locationId === locationId) return existing;
      identity = { batchNo: existing.batchNo, expiryDate: existing.expiryDate };
    }
    if (!identity)
      throw validation(
        `${product.sku} is kept in batches: enter the batch number and expiry date.`,
      );
    const found = await this.r.inventory.findBatch(
      product.id,
      locationId,
      identity.batchNo,
      identity.expiryDate,
    );
    if (found) return found;
    const now = nowIso();
    const created: StockBatch = {
      id: newId(),
      productId: product.id,
      locationId,
      batchNo: identity.batchNo,
      expiryDate: identity.expiryDate,
      onHand: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.r.inventory.insertBatch(created);
    return created;
  }

  /** Which batches `quantity` leaves from: the one named, or earliest expiry first. */
  private async allocate(
    product: Pick<Product, "id" | "sku">,
    locationId: string,
    quantity: number,
    opts: { batchId?: string | null; sellableOnly?: boolean },
  ): Promise<[StockBatch, number][]> {
    if (opts.batchId) {
      const b = await this.r.inventory.getBatch(opts.batchId);
      if (!b || b.productId !== product.id || b.locationId !== locationId)
        throw notFound("Batch");
      if (opts.sellableOnly && b.expiryDate < todayIso())
        throw conflict(
          `Batch ${b.batchNo} of ${product.sku} expired on ${b.expiryDate} and cannot be sold.`,
          "EXPIRED",
        );
      if (b.onHand < quantity)
        throw conflict(
          `Only ${b.onHand} left in batch ${b.batchNo}.`,
          "INSUFFICIENT_STOCK",
        );
      return [[b, quantity]];
    }
    const all = await this.r.inventory.batches({
      productId: product.id,
      locationId,
      onlyPositive: true,
    });
    const today = todayIso();
    const usable = opts.sellableOnly
      ? all.filter((b) => b.expiryDate >= today)
      : all;
    const total = usable.reduce((n, b) => n + b.onHand, 0);
    if (total < quantity) {
      const expired = all
        .filter((b) => b.expiryDate < today)
        .reduce((n, b) => n + b.onHand, 0);
      throw conflict(
        opts.sellableOnly && expired
          ? `Only ${total} of ${product.sku} in unexpired batches here; ${expired} more are expired and cannot be sold.`
          : `Only ${total} of ${product.sku} in stock here.`,
        "INSUFFICIENT_STOCK",
      );
    }
    const taken: [StockBatch, number][] = [];
    let remaining = quantity;
    for (const b of usable) {
      if (remaining === 0) break;
      const take = Math.min(remaining, b.onHand);
      taken.push([b, take]);
      remaining -= take;
    }
    return taken;
  }

  /** Units of a batch-tracked product at a location that may be sold: unexpired batches, less reservations. */
  private async sellable(
    productId: string,
    balance: StockBalance,
  ): Promise<number> {
    const today = todayIso();
    const unexpired = (
      await this.r.inventory.batches({
        productId,
        locationId: balance.locationId,
        onlyPositive: true,
      })
    )
      .filter((b) => b.expiryDate >= today)
      .reduce((n, b) => n + b.onHand, 0);
    return Math.max(
      0,
      Math.min(balance.available, unexpired - balance.reserved),
    );
  }

  private async insert(
    actor: Pick<Actor, "id"> | null,
    m: MoveInput,
    batchId: string | null,
    quantity: number,
  ) {
    await this.r.inventory.insertMovement({
      id: newId(),
      productId: m.productId,
      locationId: m.locationId,
      type: m.type,
      quantity,
      referenceType: m.referenceType ?? "",
      referenceId: m.referenceId ?? null,
      note: (m.note ?? "").slice(0, 500),
      createdAt: nowIso(),
      createdBy: actor?.id ?? null,
      transferId: m.transferId ?? null,
      batchId,
    });
    if (batchId) await this.r.inventory.applyBatchDelta(batchId, quantity);
  }

  private async move(actor: Pick<Actor, "id"> | null, m: MoveInput) {
    const product = await this.requireProduct(m.productId);
    if (!product.trackBatches) {
      await this.insert(actor, m, null, m.quantity);
    } else if (m.quantity > 0) {
      const b = await this.batchFor(product, m.locationId, m.batch, m.batchId);
      await this.insert(actor, m, b.id, m.quantity);
    } else {
      for (const [b, q] of await this.allocate(
        product,
        m.locationId,
        -m.quantity,
        { batchId: m.batchId },
      ))
        await this.insert(actor, m, b.id, -q);
    }
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
      batch?: BatchInput;
      batchId?: string | null;
    },
  ) {
    positive(i.quantity);
    await this.requireProduct(i.productId);
    await this.requireLocation(i.locationId);
    await this.move(actor, { ...i, type: i.type ?? "RECEIPT" });
  }

  async adjust(
    actor: Pick<Actor, "id"> | null,
    i: {
      productId: string;
      locationId: string;
      delta: number;
      reason: string;
      batch?: BatchInput;
      batchId?: string | null;
    },
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
      batch: i.batch,
      batchId: i.batchId,
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
      batchId?: string | null;
    },
  ) {
    positive(i.quantity);
    if (i.fromLocationId === i.toLocationId)
      throw validation("Choose two different locations.");
    const product = await this.requireProduct(i.productId);
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
    const common = {
      productId: i.productId,
      referenceType: "TRANSFER",
      referenceId: transferId,
      note: i.note,
      transferId,
    };
    if (!product.trackBatches) {
      await this.move(actor, {
        ...common,
        locationId: i.fromLocationId,
        type: "TRANSFER_OUT",
        quantity: -i.quantity,
      });
      await this.move(actor, {
        ...common,
        locationId: i.toLocationId,
        type: "TRANSFER_IN",
        quantity: i.quantity,
      });
      return transferId;
    }
    // Each batch moves as itself: the same batch number and expiry date at the destination.
    for (const [batch, q] of await this.allocate(
      product,
      i.fromLocationId,
      i.quantity,
      { batchId: i.batchId },
    )) {
      await this.move(actor, {
        ...common,
        locationId: i.fromLocationId,
        type: "TRANSFER_OUT",
        quantity: -q,
        batchId: batch.id,
      });
      await this.move(actor, {
        ...common,
        locationId: i.toLocationId,
        type: "TRANSFER_IN",
        quantity: q,
        batchId: batch.id,
      });
    }
    return transferId;
  }

  /** Units that may be reserved at each location: for batch-tracked products, unexpired stock only. */
  private async reservable(productId: string, product?: Product) {
    const p = product ?? (await this.requireProduct(productId));
    const balances = await this.r.inventory.balances({ productId });
    if (!p.trackBatches)
      return balances.map((b) => ({ balance: b, available: b.available }));
    const out: { balance: StockBalance; available: number }[] = [];
    for (const b of balances)
      out.push({ balance: b, available: await this.sellable(productId, b) });
    return out;
  }

  /** Total available across every location. */
  async availableFor(productId: string): Promise<number> {
    return (await this.reservable(productId)).reduce(
      (n, b) => n + b.available,
      0,
    );
  }

  async reserve(req: ReserveRequest): Promise<Reservation[]> {
    positive(req.quantity);
    const product = await this.requireProduct(req.productId);
    if (product.status !== "ACTIVE")
      throw conflict(`${product.sku} is inactive and cannot be reserved.`);
    const balances = (await this.reservable(req.productId, product)).filter(
      (b) => b.available > 0,
    );
    const preferred = req.preferredLocationId ?? product.defaultLocationId;
    balances.sort(
      (a, b) =>
        Number(b.balance.locationId === preferred) -
          Number(a.balance.locationId === preferred) ||
        b.available - a.available,
    );
    const total = balances.reduce((n, b) => n + b.available, 0);
    if (total < req.quantity)
      throw conflict(
        `Insufficient available stock for ${product.sku}: ${req.quantity} requested, ${total} available${product.trackBatches ? " (expired batches are not counted)" : ""}.`,
        "INSUFFICIENT_STOCK",
      );
    let remaining = req.quantity;
    const made: Reservation[] = [];
    for (const { balance: b, available } of balances) {
      if (remaining === 0) break;
      const take = Math.min(remaining, available);
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
   * a SALE movement is written at the location the stock came from (for a
   * batch-tracked product, one per batch, earliest unexpired expiry first). */
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
      const product = await this.requireProduct(res.productId);
      await this.r.inventory.fulfillReservation(
        res.id,
        take,
        nowIso(),
        newId(),
      );
      const sale: MoveInput = {
        productId: res.productId,
        locationId: res.locationId,
        type: "SALE",
        quantity: -take,
        referenceType: i.movementReferenceType,
        referenceId: i.movementReferenceId,
        note: i.note,
      };
      if (product.trackBatches)
        for (const [b, q] of await this.allocate(
          product,
          res.locationId,
          take,
          { sellableOnly: true },
        ))
          await this.insert(actor, sale, b.id, -q);
      else await this.insert(actor, sale, null, -take);
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
      batch?: BatchInput;
      batchId?: string | null;
      /** The movements the goods originally left under (a batch-tracked
       * return without a named batch goes back to the latest-expiry batch sold). */
      soldUnder?: { referenceType: string; referenceId: string };
    },
  ) {
    positive(i.quantity);
    await this.requireLocation(i.locationId);
    const product = await this.requireProduct(i.productId);
    let batchId = i.batchId ?? null;
    if (product.trackBatches && !i.batch && !batchId && i.soldUnder) {
      const sold = (
        await this.r.inventory.listMovements({
          productId: i.productId,
          referenceType: i.soldUnder.referenceType,
          referenceId: i.soldUnder.referenceId,
          type: "SALE",
          pageSize: 500,
        })
      ).items.filter((m) => m.batchId);
      let latest: StockBatch | null = null;
      for (const m of sold) {
        const b = await this.r.inventory.getBatch(m.batchId!);
        if (b && (!latest || b.expiryDate > latest.expiryDate)) latest = b;
      }
      batchId = latest?.id ?? null;
    }
    await this.move(actor, {
      productId: i.productId,
      locationId: i.locationId,
      type: "RETURN_IN",
      quantity: i.quantity,
      referenceType: i.referenceType,
      referenceId: i.referenceId,
      note: i.note,
      batch: i.batch,
      batchId,
    });
  }

  /** Takes expired stock out of the shop (it can never be sold): every expired batch, or one batch. */
  async writeOffExpired(
    actor: Pick<Actor, "id"> | null,
    i: { batchId?: string | null },
  ): Promise<{ batch: StockBatch; quantity: number }[]> {
    const today = todayIso();
    const targets = i.batchId
      ? [await this.r.inventory.getBatch(i.batchId)].filter(
          (b): b is StockBatch => !!b,
        )
      : (await this.r.inventory.batches({ onlyPositive: true })).filter(
          (b) => b.expiryDate < today,
        );
    if (i.batchId && targets.length === 0) throw notFound("Batch");
    const done: { batch: StockBatch; quantity: number }[] = [];
    for (const b of targets) {
      if (b.expiryDate >= today)
        throw conflict(
          `Batch ${b.batchNo} expires on ${b.expiryDate}; it has not expired yet.`,
        );
      if (b.onHand === 0) continue;
      const balance = await this.r.inventory.balance(b.productId, b.locationId);
      if ((balance?.onHand ?? 0) - b.onHand < (balance?.reserved ?? 0))
        throw conflict(
          `Stock of batch ${b.batchNo} is held for an order; cancel or change that order first.`,
          "INSUFFICIENT_STOCK",
        );
      await this.move(actor, {
        productId: b.productId,
        locationId: b.locationId,
        type: "ADJUSTMENT_OUT",
        quantity: -b.onHand,
        referenceType: "EXPIRED_WRITE_OFF",
        note: `Expired ${b.expiryDate}: batch ${b.batchNo}`,
        batchId: b.id,
      });
      done.push({ batch: b, quantity: b.onHand });
    }
    return done;
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
      batch: batchInput(i.batchNo, i.expiryDate),
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
        summary: `Received ${args.quantity} units${args.batch ? ` of batch ${args.batch.batchNo} (expires ${args.batch.expiryDate})` : ""}`,
        metadata: {
          locationId: args.locationId,
          quantity: args.quantity,
          ...(args.batch ?? {}),
        },
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
      batch: batchInput(i.batchNo, i.expiryDate),
      batchId: text(i.batchId, "Batch", { max: 64 }) || null,
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
      batchId: text(i.batchId, "Batch", { max: 64 }) || null,
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
  async stockLevels(
    actor: Actor,
    q: { q?: string; warehouseId?: string; page?: number; pageSize?: number },
  ) {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.reports.stockLevels(q));
  }
  /** A product's batches (all locations, with stock), earliest expiry first. */
  async batches(actor: Actor, productId: string): Promise<StockBatch[]> {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) =>
      r.inventory.batches({ productId, onlyPositive: true }),
    );
  }
  /** Batches in stock that have expired or expire within `days` days, with their product. */
  async expiring(actor: Actor, q: { days?: unknown }) {
    requirePermission(actor, "inventory.read");
    const days = integer(q.days ?? 90, "Days", { min: 0, max: 3650 });
    const until = new Date(todayIso() + "T00:00:00Z");
    until.setUTCDate(until.getUTCDate() + days);
    const limit = until.toISOString().slice(0, 10);
    const today = todayIso();
    return this.uow.read(async (r) => {
      const rows = await r.inventory.batches({
        onlyPositive: true,
        expiringOnOrBefore: limit,
      });
      const out = [];
      for (const b of rows) {
        const p = await r.products.get(b.productId);
        const l = await r.masterData.getLocation(b.locationId);
        const daysLeft = Math.round(
          (Date.parse(b.expiryDate) - Date.parse(today)) / 86_400_000,
        );
        out.push({
          ...b,
          sku: p?.sku ?? "",
          name: p?.name ?? "",
          genericName: p?.genericName ?? "",
          locationCode: l?.code ?? "",
          daysLeft,
          expired: b.expiryDate < today,
        });
      }
      return { until: limit, today, items: out };
    });
  }
  /** Writes off expired stock: one batch (`batchId`) or every expired batch. */
  async writeOffExpired(actor: Actor, raw: unknown) {
    requirePermission(actor, "inventory.write");
    const batchId = text(record(raw).batchId, "Batch", { max: 64 }) || null;
    return this.uow.write(async (r) => {
      const done = await new InventoryOps(r).writeOffExpired(actor, {
        batchId,
      });
      for (const { batch, quantity } of done)
        await r.audit.record(actor, {
          action: "stock.write_off_expired",
          entityType: "product",
          entityId: batch.productId,
          summary: `Wrote off ${quantity} expired units of batch ${batch.batchNo} (expired ${batch.expiryDate})`,
          metadata: {
            batchId: batch.id,
            locationId: batch.locationId,
            quantity,
          },
        });
      return {
        batches: done.length,
        units: done.reduce((n, d) => n + d.quantity, 0),
      };
    });
  }
  async verifyIntegrity(actor: Actor) {
    requirePermission(actor, "inventory.read");
    return this.uow.read((r) => r.inventory.verifyIntegrity());
  }
}
