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
