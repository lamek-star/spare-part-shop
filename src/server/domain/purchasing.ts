import type { Paged } from "../providers/data";
import type { UnitOfWork } from "../providers/uow";
import type { Actor, Page, PurchaseLine, PurchaseOrder } from "./types";
import { conflict, notFound, validation } from "../kernel/errors";
import { documentTotals, lineTotal } from "../kernel/money";
import { newId, nowIso } from "../kernel/ids";
import { batchInput, InventoryOps } from "./inventory";
import { requirePermission } from "./permissions";
import { integer, isoDate, moneyMinor, record, text } from "./validate";
import type { Repositories } from "../providers/uow";

/**
 * A product's cost after goods arrive: the weighted average of the stock already on hand at the old cost and the
 * delivered quantity at the order's unit cost. A product with no cost yet, or no stock, simply takes the new cost.
 */
export interface ShortageLine {
  productId: string;
  sku: string;
  name: string;
  available: number;
  reorderLevel: number;
  minimumLevel: number;
  onOrder: number;
  quantity: number;
  unitCostMinor: number;
  supplierPartNumber: string;
}
export interface ShortageGroup {
  supplierId: string;
  supplierName: string;
  lines: ShortageLine[];
}
export interface ShortagePlan {
  groups: ShortageGroup[];
  noSupplier: ShortageLine[];
  covered: ShortageLine[];
}

/**
 * How many to order: enough to bring the available stock (plus what is already on order) up to twice the reorder
 * level -- or twice the minimum when no reorder level is set, or 1 when neither is. 0 = already covered.
 * Example: reorder level 6, 4 available, none on order -> 8 (to reach 12).
 */
export function suggestedQuantity(s: {
  available: number;
  reorderLevel: number;
  minimumLevel: number;
  onOrder: number;
}): number {
  const target = s.reorderLevel > 0 ? s.reorderLevel * 2 : s.minimumLevel > 0 ? s.minimumLevel * 2 : 1;
  return Math.max(0, target - Math.max(0, s.available) - Math.max(0, s.onOrder));
}

export function averagedCost(
  onHand: number,
  oldCostMinor: number,
  quantity: number,
  unitCostMinor: number,
): number {
  if (oldCostMinor <= 0 || onHand <= 0) return unitCostMinor;
  return Math.round(
    (onHand * oldCostMinor + quantity * unitCostMinor) / (onHand + quantity),
  );
}

/** What one unit on this line really cost, after the line's discount. */
const effectiveUnitCost = (line: PurchaseLine) =>
  Math.round((line.unitCostMinor * (10_000 - line.discountBp)) / 10_000);

async function purchaseLines(
  r: Repositories,
  raw: unknown,
): Promise<PurchaseLine[]> {
  if (!Array.isArray(raw) || raw.length === 0)
    throw validation("Add at least one line.");
  if (raw.length > 200)
    throw validation("A purchase order may have at most 200 lines.");
  const lines: PurchaseLine[] = [];
  for (const [i, item] of raw.entries()) {
    const l = record(item, `Line ${i + 1}`);
    const productId = text(l.productId, `Product on line ${i + 1}`, {
      required: true,
      max: 64,
    });
    if (!(await r.products.get(productId)))
      throw notFound(`Product on line ${i + 1}`);
    const quantity = integer(l.quantity, `Quantity on line ${i + 1}`, {
      min: 1,
      max: 1_000_000,
    });
    const unitCostMinor = moneyMinor(l.unitCostMinor, `Cost on line ${i + 1}`, {
      default: 0,
    });
    const discountBp = integer(l.discountBp, "Discount", {
      min: 0,
      max: 10000,
      default: 0,
    });
    lines.push({
      id: newId(),
      position: i,
      productId,
      quantity,
      quantityReceived: 0,
      unitCostMinor,
      discountBp,
      lineTotalMinor: lineTotal({
        quantity,
        unitPrice: unitCostMinor,
        discountBp,
      }),
    });
  }
  return lines;
}
const totals = (lines: PurchaseLine[], taxBp: number) => {
  const t = documentTotals(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitCostMinor,
      discountBp: l.discountBp,
    })),
    taxBp,
  );
  return { subtotalMinor: t.subtotal, taxMinor: t.tax, totalMinor: t.total };
};

export class PurchasingService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(
    actor: Actor,
    q: Paged & { status?: string; supplierId?: string },
  ): Promise<Page<PurchaseOrder>> {
    requirePermission(actor, "purchasing.read");
    return this.uow.read((r) => r.purchasing.listOrders(q));
  }
  async get(actor: Actor, id: string): Promise<PurchaseOrder> {
    requirePermission(actor, "purchasing.read");
    const o = await this.uow.read((r) => r.purchasing.getOrder(id));
    if (!o) throw notFound("Purchase order");
    return o;
  }
  /**
   * What "Order what needs ordering" would order: every product that needs ordering (the dashboard's red and amber),
   * grouped by its default supplier, with a suggested quantity (see suggestedQuantity) and the supplier's cost (else
   * the product's). Products with no default supplier, and those already covered by open purchase orders, are listed
   * apart. Nothing is created here.
   */
  async shortagePlan(actor: Actor): Promise<ShortagePlan> {
    requirePermission(actor, "purchasing.read");
    return this.uow.read(async (r) => {
      const rows = await r.reports.shortages();
      const groups = new Map<string, ShortageGroup>();
      const plan: ShortagePlan = { groups: [], noSupplier: [], covered: [] };
      for (const row of rows) {
        const quantity = suggestedQuantity(row);
        const item: ShortageLine = {
          productId: row.productId,
          sku: row.sku,
          name: row.name,
          available: row.available,
          reorderLevel: row.reorderLevel,
          minimumLevel: row.minimumLevel,
          onOrder: row.onOrder,
          quantity,
          unitCostMinor: row.supplierCostMinor || row.costMinor,
          supplierPartNumber: row.supplierPartNumber,
        };
        if (quantity === 0) plan.covered.push(item);
        else if (!row.defaultSupplierId) plan.noSupplier.push(item);
        else {
          let g = groups.get(row.defaultSupplierId);
          if (!g) {
            const supplier = await r.masterData.getSupplier(row.defaultSupplierId);
            g = { supplierId: row.defaultSupplierId, supplierName: supplier?.name ?? "", lines: [] };
            groups.set(row.defaultSupplierId, g);
          }
          g.lines.push(item);
        }
      }
      plan.groups = [...groups.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
      return plan;
    });
  }

  /** Makes one DRAFT purchase order per supplier from shortagePlan (optionally only some suppliers). Drafts can be
   * edited before they are confirmed; each is audited like any purchase order. */
  async orderShortages(
    actor: Actor,
    raw: unknown,
  ): Promise<{ orders: PurchaseOrder[]; noSupplier: ShortageLine[]; covered: ShortageLine[] }> {
    requirePermission(actor, "purchasing.write");
    const input = record(raw);
    const locationId = text(input.locationId, "Receiving location", { required: true, max: 64 });
    const only = Array.isArray(input.supplierIds)
      ? new Set(input.supplierIds.filter((v): v is string => typeof v === "string"))
      : null;
    const plan = await this.shortagePlan(actor);
    const chosen = plan.groups.filter((g) => !only || only.has(g.supplierId));
    if (chosen.length === 0) throw validation("Nothing to order: no item that needs ordering has a supplier.");
    const orders: PurchaseOrder[] = [];
    for (const g of chosen)
      orders.push(
        await this.create(actor, {
          supplierId: g.supplierId,
          locationId,
          notes: "Made from the items that need ordering.",
          lines: g.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCostMinor: l.unitCostMinor,
          })),
        }),
      );
    return { orders, noSupplier: plan.noSupplier, covered: plan.covered };
  }

  async create(actor: Actor, raw: unknown): Promise<PurchaseOrder> {
    requirePermission(actor, "purchasing.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const supplierId = text(input.supplierId, "Supplier", {
        required: true,
        max: 64,
      });
      if (!(await r.masterData.getSupplier(supplierId)))
        throw notFound("Supplier");
      const locationId = text(input.locationId, "Receiving location", {
        required: true,
        max: 64,
      });
      if (!(await r.masterData.getLocation(locationId)))
        throw notFound("Location");
      const cfg = await r.config.get();
      const lines = await purchaseLines(r, input.lines);
      const taxBp = integer(input.taxBp, "Tax rate", {
        min: 0,
        max: 100000,
        default: cfg.defaultTaxBp,
      });
      const now = nowIso();
      const order: PurchaseOrder = {
        id: newId(),
        number: await r.config.nextNumber("purchase", "PO"),
        status: "DRAFT",
        supplierId,
        locationId,
        currency: cfg.currency,
        taxBp,
        expectedDate: isoDate(input.expectedDate, "Expected date"),
        notes: text(input.notes, "Notes", { max: 2000 }),
        ...totals(lines, taxBp),
        lines,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await r.purchasing.insertOrder(order);
      await r.audit.record(actor, {
        action: "purchase.create",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `${order.number} created`,
        metadata: { totalMinor: order.totalMinor },
      });
      return order;
    });
  }
  async update(actor: Actor, id: string, raw: unknown): Promise<PurchaseOrder> {
    requirePermission(actor, "purchasing.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const o = await r.purchasing.getOrder(id);
      if (!o) throw notFound("Purchase order");
      if (o.status !== "DRAFT")
        throw conflict("Only a draft purchase order can be edited.");
      if (input.lines !== undefined)
        o.lines = await purchaseLines(r, input.lines);
      if (input.taxBp !== undefined)
        o.taxBp = integer(input.taxBp, "Tax rate", { min: 0, max: 100000 });
      if (input.expectedDate !== undefined)
        o.expectedDate = isoDate(input.expectedDate, "Expected date");
      if (input.notes !== undefined)
        o.notes = text(input.notes, "Notes", { max: 2000 });
      if (input.locationId !== undefined) {
        const locationId = text(input.locationId, "Location", {
          required: true,
          max: 64,
        });
        if (!(await r.masterData.getLocation(locationId)))
          throw notFound("Location");
        o.locationId = locationId;
      }
      Object.assign(o, totals(o.lines, o.taxBp), { updatedAt: nowIso() });
      await r.purchasing.saveOrder(o);
      await r.audit.record(actor, {
        action: "purchase.update",
        entityType: "purchase_order",
        entityId: id,
        summary: `${o.number} updated`,
      });
      return o;
    });
  }
  private async move(
    actor: Actor,
    id: string,
    from: PurchaseOrder["status"][],
    to: PurchaseOrder["status"],
    action: string,
  ) {
    return this.uow.write(async (r) => {
      const o = await r.purchasing.getOrder(id);
      if (!o) throw notFound("Purchase order");
      if (!from.includes(o.status))
        throw conflict(
          `A ${o.status.toLowerCase().replace("_", " ")} purchase order cannot be ${to.toLowerCase().replace("_", " ")}.`,
        );
      if (to === "CANCELLED" && o.lines.some((l) => l.quantityReceived > 0))
        throw conflict("Goods have already been received on this order.");
      o.status = to;
      o.updatedAt = nowIso();
      await r.purchasing.saveOrder(o);
      await r.audit.record(actor, {
        action,
        entityType: "purchase_order",
        entityId: id,
        summary: `${o.number} ${to.toLowerCase().replace("_", " ")}`,
      });
      return o;
    });
  }
  async confirm(actor: Actor, id: string) {
    requirePermission(actor, "purchasing.write");
    return this.move(actor, id, ["DRAFT"], "CONFIRMED", "purchase.confirm");
  }
  async cancel(actor: Actor, id: string) {
    requirePermission(actor, "purchasing.write");
    return this.move(
      actor,
      id,
      ["DRAFT", "CONFIRMED"],
      "CANCELLED",
      "purchase.cancel",
    );
  }
  async close(actor: Actor, id: string) {
    requirePermission(actor, "purchasing.write");
    return this.move(
      actor,
      id,
      ["PARTIALLY_RECEIVED", "RECEIVED"],
      "CLOSED",
      "purchase.close",
    );
  }
  /** Goods received: adds stock (RECEIPT movements) at the chosen location. */
  async receive(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<PurchaseOrder> {
    requirePermission(actor, "purchasing.write");
    requirePermission(actor, "inventory.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const o = await r.purchasing.getOrder(id);
      if (!o) throw notFound("Purchase order");
      if (!["CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status))
        throw conflict(
          `A ${o.status.toLowerCase().replace("_", " ")} purchase order cannot receive goods.`,
        );
      const locationId =
        typeof input.locationId === "string" && input.locationId
          ? input.locationId
          : o.locationId;
      if (!(await r.masterData.getLocation(locationId)))
        throw notFound("Location");
      const requested =
        Array.isArray(input.lines) && input.lines.length
          ? (input.lines as unknown[]).map((x) => record(x, "Line"))
          : o.lines.map((l) => ({
              lineId: l.id,
              quantity: l.quantity - l.quantityReceived,
            }));
      const inv = new InventoryOps(r);
      const receiptLines: {
        purchaseLineId: string;
        productId: string;
        quantity: number;
      }[] = [];
      const number = await r.config.nextNumber("receipt", "GRN");
      const receiptId = newId();
      for (const req of requested) {
        const line = o.lines.find((l) => l.id === req.lineId);
        if (!line) throw notFound("Order line");
        const qty = integer(req.quantity, "Quantity", {
          min: 0,
          max: 1_000_000,
        });
        if (qty === 0) continue;
        if (qty > line.quantity - line.quantityReceived)
          throw validation(
            `Only ${line.quantity - line.quantityReceived} more expected on this line.`,
          );
        const onHandBefore = (
          await r.inventory.balances({ productId: line.productId })
        ).reduce((sum, b) => sum + b.onHand, 0);
        await inv.receive(actor, {
          productId: line.productId,
          locationId,
          quantity: qty,
          referenceType: "GOODS_RECEIPT",
          referenceId: receiptId,
          note: `${o.number} ${number}`,
          // Medicines: the batch number and expiry date printed on the delivered packs.
          batch: batchInput(
            (req as Record<string, unknown>).batchNo,
            (req as Record<string, unknown>).expiryDate,
          ),
        });
        line.quantityReceived += qty;
        await updateCostFromReceipt(r, actor, o, line, qty, onHandBefore);
        receiptLines.push({
          purchaseLineId: line.id,
          productId: line.productId,
          quantity: qty,
        });
      }
      if (receiptLines.length === 0) throw validation("Nothing to receive.");
      o.status = o.lines.every((l) => l.quantityReceived === l.quantity)
        ? "RECEIVED"
        : "PARTIALLY_RECEIVED";
      o.updatedAt = nowIso();
      await r.purchasing.saveOrder(o);
      await r.purchasing.insertReceipt({
        id: receiptId,
        number,
        purchaseOrderId: o.id,
        locationId,
        receivedAt: nowIso(),
        notes: text(input.notes, "Notes", { max: 500 }),
        receivedBy: actor.id,
        lines: receiptLines,
      });
      await r.audit.record(actor, {
        action: "purchase.receive",
        entityType: "purchase_order",
        entityId: id,
        summary: `${number} received against ${o.number}`,
        metadata: { lines: receiptLines.length },
      });
      return o;
    });
  }
}

/**
 * Received goods set the product's cost (weighted average), so stock value and gross profit use what the shop paid.
 * Skipped when the order is in another currency than the product, or the line has no cost (free or unknown).
 */
async function updateCostFromReceipt(
  r: Repositories,
  actor: Actor,
  order: PurchaseOrder,
  line: PurchaseLine,
  quantity: number,
  onHandBefore: number,
) {
  const unitCost = effectiveUnitCost(line);
  if (unitCost <= 0) return;
  const product = await r.products.get(line.productId);
  if (!product || product.currency !== order.currency) return;
  const costMinor = averagedCost(
    onHandBefore,
    product.costMinor ?? 0,
    quantity,
    unitCost,
  );
  if (costMinor === product.costMinor) return;
  await r.products.update({ ...product, costMinor, updatedAt: nowIso() });
  await r.audit.record(actor, {
    action: "product.cost_change",
    entityType: "product",
    entityId: product.id,
    summary: `Cost of ${product.sku} set from ${order.number}`,
    metadata: {
      fromMinor: product.costMinor,
      toMinor: costMinor,
      purchaseOrder: order.number,
      quantity,
      unitCostMinor: unitCost,
    },
  });
}
