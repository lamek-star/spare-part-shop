import type { Repositories, UnitOfWork } from "../providers/uow";
import type { SalesReturn } from "../providers/sales";
import type {
  Actor,
  DocumentLine,
  DocumentLineInput,
  Enquiry,
  EnquiryItem,
  Invoice,
  Page,
  Payment,
  Quotation,
  SalesOrder,
  SalesOrderLine,
} from "./types";
import { paymentMethods } from "./types";
import { conflict, notFound, validation } from "../kernel/errors";
import { documentTotals, lineTotal } from "../kernel/money";
import { newId, normalizeNumber, nowIso } from "../kernel/ids";
import { InventoryOps } from "./inventory";
import { requirePermission } from "./permissions";
import {
  integer,
  isoDate,
  moneyMinor,
  oneOf,
  optionalEmail,
  record,
  text,
} from "./validate";
import type { Paged } from "../providers/data";

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const LINE_REFERENCE = "SALES_ORDER_LINE";

/** Validates client-supplied lines and computes every amount here — the
 * server never trusts a client-supplied line total. */
async function buildLines(
  r: Repositories,
  raw: unknown,
  opts: { requirePrice: boolean },
): Promise<DocumentLine[]> {
  if (!Array.isArray(raw) || raw.length === 0)
    throw validation("Add at least one line.");
  if (raw.length > 200)
    throw validation("A document may have at most 200 lines.");
  const lines: DocumentLine[] = [];
  for (const [index, item] of raw.entries()) {
    const l = record(
      item,
      `Line ${index + 1}`,
    ) as unknown as DocumentLineInput & Record<string, unknown>;
    const productId =
      typeof l.productId === "string" && l.productId ? l.productId : null;
    const product = productId ? await r.products.get(productId) : null;
    if (productId && !product) throw notFound(`Product on line ${index + 1}`);
    const quantity = integer(l.quantity, `Quantity on line ${index + 1}`, {
      min: 1,
      max: 1_000_000,
    });
    const unitPriceMinor = moneyMinor(
      l.unitPriceMinor,
      `Price on line ${index + 1}`,
      { default: 0 },
    );
    if (opts.requirePrice && unitPriceMinor <= 0)
      throw validation(`Line ${index + 1} needs a price greater than zero.`);
    const discountBp = integer(l.discountBp, `Discount on line ${index + 1}`, {
      min: 0,
      max: 10000,
      default: 0,
    });
    const description =
      text(l.description, `Description on line ${index + 1}`, { max: 300 }) ||
      product?.name ||
      "";
    if (!description)
      throw validation(`Line ${index + 1} needs a description.`);
    lines.push({
      id: newId(),
      position: index,
      productId,
      sku: product?.sku ?? text(l.sku, "SKU", { max: 64 }),
      oemNumber: text(l.oemNumber, "OEM number", { max: 100 }),
      description,
      quantity,
      unitPriceMinor,
      discountBp,
      lineTotalMinor: lineTotal({
        quantity,
        unitPrice: unitPriceMinor,
        discountBp,
      }),
    });
  }
  return lines;
}
const totalsOf = (lines: DocumentLine[], taxBp: number) => {
  const t = documentTotals(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPriceMinor,
      discountBp: l.discountBp,
    })),
    taxBp,
  );
  return { subtotalMinor: t.subtotal, taxMinor: t.tax, totalMinor: t.total };
};
function taxBpOf(raw: unknown, fallback: number): number {
  return integer(raw, "Tax rate", { min: 0, max: 100000, default: fallback });
}

export class SalesService {
  constructor(private readonly uow: UnitOfWork) {}

  // =================== enquiries ===================
  async currentEnquiry(actor: Actor): Promise<Enquiry | null> {
    requirePermission(actor, "enquiries.read");
    return this.uow.read((r) => r.sales.draftEnquiryFor(actor.id));
  }
  async listEnquiries(
    actor: Actor,
    q: Paged & { status?: string },
  ): Promise<Page<Enquiry>> {
    requirePermission(actor, "enquiries.read");
    return this.uow.read((r) => r.sales.listEnquiries(q));
  }
  async getEnquiry(actor: Actor, id: string): Promise<Enquiry> {
    requirePermission(actor, "enquiries.read");
    const e = await this.uow.read((r) => r.sales.getEnquiry(id));
    if (!e) throw notFound("Enquiry");
    return e;
  }
  async addEnquiryItem(actor: Actor, raw: unknown): Promise<Enquiry> {
    requirePermission(actor, "enquiries.write");
    const i = record(raw);
    const oemNumber = text(i.oemNumber, "OEM number", {
      required: true,
      max: 100,
    });
    const vehicle = text(i.vehicleDescription, "Vehicle", { max: 200 });
    const quantity = integer(i.quantity, "Quantity", {
      min: 1,
      max: 100000,
      default: 1,
    });
    return this.uow.write(async (r) => {
      const now = nowIso();
      let enquiry = await r.sales.draftEnquiryFor(actor.id);
      if (!enquiry) {
        enquiry = {
          id: newId(),
          number: await r.config.nextNumber("enquiry", "ENQ"),
          status: "DRAFT",
          customerId: null,
          contactName: "",
          contactEmail: "",
          contactPhone: "",
          vin: "",
          notes: "",
          items: [],
          createdBy: actor.id,
          createdAt: now,
          submittedAt: null,
          updatedAt: now,
        };
        await r.sales.insertEnquiry(enquiry);
      }
      const key = normalizeNumber(oemNumber);
      const same = enquiry.items.find(
        (x) =>
          normalizeNumber(x.oemNumber) === key &&
          x.vehicleDescription === vehicle,
      );
      if (same) same.quantity += quantity;
      else {
        if (enquiry.items.length >= 200)
          throw validation("An enquiry may have at most 200 items.");
        const item: EnquiryItem = {
          id: newId(),
          enquiryId: enquiry.id,
          position: enquiry.items.length,
          oemNumber,
          partName: text(i.partName, "Part name", { max: 300 }),
          vehicleDescription: vehicle,
          quantity,
          referencePartId:
            typeof i.referencePartId === "string" && i.referencePartId
              ? i.referencePartId
              : null,
          providerKey: text(i.providerKey, "Source", { max: 60 }),
          sourceUrl: text(i.sourceUrl, "Source URL", { max: 500 }),
          notes: text(i.notes, "Notes", { max: 500 }),
          addedAt: now,
        };
        enquiry.items.push(item);
      }
      enquiry.updatedAt = now;
      await r.sales.saveEnquiry(enquiry);
      await r.audit.record(actor, {
        action: "enquiry.add_item",
        entityType: "enquiry",
        entityId: enquiry.id,
        summary: `${oemNumber} added to ${enquiry.number}`,
      });
      return (await r.sales.getEnquiry(enquiry.id))!;
    });
  }
  async removeEnquiryItem(
    actor: Actor,
    enquiryId: string,
    itemId: string,
  ): Promise<Enquiry> {
    requirePermission(actor, "enquiries.write");
    return this.uow.write(async (r) => {
      const e = await r.sales.getEnquiry(enquiryId);
      if (!e) throw notFound("Enquiry");
      if (e.status !== "DRAFT")
        throw conflict("Only a draft enquiry can be edited.");
      e.items = e.items.filter((x) => x.id !== itemId);
      e.updatedAt = nowIso();
      await r.sales.saveEnquiry(e);
      await r.audit.record(actor, {
        action: "enquiry.remove_item",
        entityType: "enquiry",
        entityId: e.id,
        summary: `Item removed from ${e.number}`,
      });
      return (await r.sales.getEnquiry(e.id))!;
    });
  }
  async submitEnquiry(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<Enquiry> {
    requirePermission(actor, "enquiries.write");
    const c = record(raw);
    return this.uow.write(async (r) => {
      const e = await r.sales.getEnquiry(id);
      if (!e) throw notFound("Enquiry");
      if (e.status !== "DRAFT")
        throw conflict("This enquiry has already been submitted.");
      if (e.items.length === 0)
        throw validation("Add at least one part before submitting.");
      const customerId =
        typeof c.customerId === "string" && c.customerId ? c.customerId : null;
      if (customerId && !(await r.masterData.getCustomer(customerId)))
        throw notFound("Customer");
      const contactName = text(c.contactName, "Contact name", { max: 200 });
      if (!customerId && !contactName)
        throw validation("Choose a customer or enter a contact name.");
      Object.assign(e, {
        customerId,
        contactName,
        contactEmail: optionalEmail(c.contactEmail),
        contactPhone: text(c.contactPhone, "Phone", { max: 60 }),
        vin: text(c.vin, "VIN", { max: 40 }),
        notes: text(c.notes, "Notes", { max: 2000 }),
        status: "SUBMITTED",
        submittedAt: nowIso(),
        updatedAt: nowIso(),
      });
      await r.sales.saveEnquiry(e);
      await r.audit.record(actor, {
        action: "enquiry.submit",
        entityType: "enquiry",
        entityId: e.id,
        summary: `${e.number} submitted`,
        metadata: { items: e.items.length },
      });
      return (await r.sales.getEnquiry(e.id))!;
    });
  }
  async cancelEnquiry(actor: Actor, id: string): Promise<Enquiry> {
    requirePermission(actor, "enquiries.write");
    return this.uow.write(async (r) => {
      const e = await r.sales.getEnquiry(id);
      if (!e) throw notFound("Enquiry");
      if (["QUOTED", "CLOSED", "CANCELLED"].includes(e.status))
        throw conflict(
          `A ${e.status.toLowerCase()} enquiry cannot be cancelled.`,
        );
      e.status = "CANCELLED";
      e.updatedAt = nowIso();
      await r.sales.saveEnquiry(e);
      await r.audit.record(actor, {
        action: "enquiry.cancel",
        entityType: "enquiry",
        entityId: id,
        summary: `${e.number} cancelled`,
      });
      return e;
    });
  }

  // =================== quotations ===================
  async listQuotations(
    actor: Actor,
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<Quotation>> {
    requirePermission(actor, "quotations.read");
    await this.expireOverdue();
    return this.uow.read((r) => r.sales.listQuotations(q));
  }
  async getQuotation(actor: Actor, id: string): Promise<Quotation> {
    requirePermission(actor, "quotations.read");
    await this.expireOverdue();
    const x = await this.uow.read((r) => r.sales.getQuotation(id));
    if (!x) throw notFound("Quotation");
    return x;
  }
  /** Marks ISSUED quotations past their valid-until date as EXPIRED. */
  async expireOverdue(): Promise<number> {
    return this.uow.write(async (r) => {
      const due = await r.sales.listQuotations({
        status: "ISSUED",
        pageSize: 200,
      });
      let n = 0;
      for (const x of due.items) {
        if (x.validUntil && x.validUntil < today()) {
          x.status = "EXPIRED";
          x.updatedAt = nowIso();
          await r.sales.saveQuotation(x);
          await r.audit.record(null, {
            action: "quotation.expire",
            entityType: "quotation",
            entityId: x.id,
            summary: `${x.number} expired`,
          });
          n++;
        }
      }
      return n;
    });
  }

  /** Enquiry → quotation: carries the customer and every line forward. */
  async createQuotationFromEnquiry(
    actor: Actor,
    enquiryId: string,
    raw: unknown = {},
  ): Promise<Quotation> {
    requirePermission(actor, "quotations.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const e = await r.sales.getEnquiry(enquiryId);
      if (!e) throw notFound("Enquiry");
      if (["CANCELLED", "CLOSED"].includes(e.status))
        throw conflict(`A ${e.status.toLowerCase()} enquiry cannot be quoted.`);
      if (e.items.length === 0) throw validation("This enquiry has no items.");
      const customerId =
        (typeof input.customerId === "string" && input.customerId) ||
        e.customerId;
      if (!customerId)
        throw validation("Choose the customer this quotation is for.");
      const customer = await r.masterData.getCustomer(customerId);
      if (!customer) throw notFound("Customer");
      if (customer.status !== "ACTIVE")
        throw conflict("That customer is inactive.");
      const cfg = await r.config.get();
      const lines: DocumentLine[] = [];
      for (const [index, item] of e.items.entries()) {
        // Pre-fill from the shop's own product when the OEM number matches
        // one; otherwise the line carries the OEM number and no price yet.
        const product = (
          await r.products.findByNormalizedNumber(
            normalizeNumber(item.oemNumber),
          )
        )[0];
        const unitPriceMinor = product?.priceMinor ?? 0;
        lines.push({
          id: newId(),
          position: index,
          productId: product?.id ?? null,
          sku: product?.sku ?? "",
          oemNumber: item.oemNumber,
          description: product?.name || item.partName || item.oemNumber,
          quantity: item.quantity,
          unitPriceMinor,
          discountBp: 0,
          lineTotalMinor: lineTotal({
            quantity: item.quantity,
            unitPrice: unitPriceMinor,
            discountBp: 0,
          }),
        });
      }
      const now = nowIso();
      const taxBp = cfg.defaultTaxBp;
      const quotation: Quotation = {
        id: newId(),
        number: await r.config.nextNumber("quotation", "QUO"),
        status: "DRAFT",
        enquiryId: e.id,
        customerId,
        currency: cfg.currency,
        taxBp,
        validUntil: addDays(today(), cfg.quotationValidityDays),
        notes: "",
        terms: cfg.quotationTerms,
        ...totalsOf(lines, taxBp),
        lines,
        issuedAt: null,
        acceptedAt: null,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await r.sales.insertQuotation(quotation);
      e.status = "QUOTED";
      e.customerId = e.customerId ?? customerId;
      e.updatedAt = now;
      await r.sales.saveEnquiry(e);
      await r.audit.record(actor, {
        action: "quotation.create",
        entityType: "quotation",
        entityId: quotation.id,
        summary: `${quotation.number} created from ${e.number}`,
        metadata: { enquiryId: e.id, lines: lines.length },
      });
      return quotation;
    });
  }

  async createQuotation(actor: Actor, raw: unknown): Promise<Quotation> {
    requirePermission(actor, "quotations.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const customerId = text(input.customerId, "Customer", {
        required: true,
        max: 64,
      });
      const customer = await r.masterData.getCustomer(customerId);
      if (!customer) throw notFound("Customer");
      const cfg = await r.config.get();
      const lines = await buildLines(r, input.lines, { requirePrice: false });
      const taxBp = taxBpOf(input.taxBp, cfg.defaultTaxBp);
      const now = nowIso();
      const quotation: Quotation = {
        id: newId(),
        number: await r.config.nextNumber("quotation", "QUO"),
        status: "DRAFT",
        enquiryId: null,
        customerId,
        currency: cfg.currency,
        taxBp,
        validUntil:
          isoDate(input.validUntil, "Valid until") ??
          addDays(today(), cfg.quotationValidityDays),
        notes: text(input.notes, "Notes", { max: 2000 }),
        terms: text(input.terms, "Terms", { max: 4000 }) || cfg.quotationTerms,
        ...totalsOf(lines, taxBp),
        lines,
        issuedAt: null,
        acceptedAt: null,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await r.sales.insertQuotation(quotation);
      await r.audit.record(actor, {
        action: "quotation.create",
        entityType: "quotation",
        entityId: quotation.id,
        summary: `${quotation.number} created`,
      });
      return quotation;
    });
  }
  async updateQuotation(
    actor: Actor,
    id: string,
    raw: unknown,
  ): Promise<Quotation> {
    requirePermission(actor, "quotations.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const q = await r.sales.getQuotation(id);
      if (!q) throw notFound("Quotation");
      if (q.status !== "DRAFT")
        throw conflict(
          "Only a draft quotation can be edited. Cancel it and create a new one to change an issued quotation.",
        );
      if (
        typeof input.expectedUpdatedAt === "string" &&
        input.expectedUpdatedAt !== q.updatedAt
      )
        throw conflict(
          "This quotation was changed by someone else. Reload it and try again.",
          "STALE",
        );
      if (input.customerId !== undefined) {
        const c = await r.masterData.getCustomer(
          text(input.customerId, "Customer", { required: true, max: 64 }),
        );
        if (!c) throw notFound("Customer");
        q.customerId = c.id;
      }
      if (input.lines !== undefined)
        q.lines = await buildLines(r, input.lines, { requirePrice: false });
      if (input.taxBp !== undefined) q.taxBp = taxBpOf(input.taxBp, q.taxBp);
      if (input.validUntil !== undefined)
        q.validUntil = isoDate(input.validUntil, "Valid until");
      if (input.notes !== undefined)
        q.notes = text(input.notes, "Notes", { max: 2000 });
      if (input.terms !== undefined)
        q.terms = text(input.terms, "Terms", { max: 4000 });
      Object.assign(q, totalsOf(q.lines, q.taxBp), { updatedAt: nowIso() });
      await r.sales.saveQuotation(q);
      await r.audit.record(actor, {
        action: "quotation.update",
        entityType: "quotation",
        entityId: id,
        summary: `${q.number} updated`,
        metadata: { totalMinor: q.totalMinor },
      });
      return q;
    });
  }
  async issueQuotation(actor: Actor, id: string): Promise<Quotation> {
    requirePermission(actor, "quotations.write");
    return this.uow.write(async (r) => {
      const q = await r.sales.getQuotation(id);
      if (!q) throw notFound("Quotation");
      if (q.status !== "DRAFT")
        throw conflict(
          `A ${q.status.toLowerCase()} quotation cannot be issued.`,
        );
      if (q.lines.length === 0) throw validation("Add at least one line.");
      const unpriced = q.lines.find((l) => l.unitPriceMinor <= 0);
      if (unpriced)
        throw validation(
          `Price every line before issuing — "${unpriced.description}" has no price.`,
        );
      if (q.validUntil && q.validUntil < today())
        throw validation("The valid-until date is in the past.");
      q.status = "ISSUED";
      q.issuedAt = nowIso();
      q.updatedAt = q.issuedAt;
      await r.sales.saveQuotation(q);
      await r.audit.record(actor, {
        action: "quotation.issue",
        entityType: "quotation",
        entityId: id,
        summary: `${q.number} issued`,
        metadata: { totalMinor: q.totalMinor },
      });
      return q;
    });
  }
  private async transitionQuotation(
    actor: Actor,
    id: string,
    from: Quotation["status"][],
    to: Quotation["status"],
    action: string,
  ) {
    return this.uow.write(async (r) => {
      const q = await r.sales.getQuotation(id);
      if (!q) throw notFound("Quotation");
      if (!from.includes(q.status))
        throw conflict(
          `A ${q.status.toLowerCase()} quotation cannot be ${to.toLowerCase()}.`,
        );
      if (to === "ACCEPTED" && q.validUntil && q.validUntil < today()) {
        q.status = "EXPIRED";
        q.updatedAt = nowIso();
        await r.sales.saveQuotation(q);
        throw conflict(
          "This quotation has expired. Create a new one to continue.",
        );
      }
      q.status = to;
      q.updatedAt = nowIso();
      if (to === "ACCEPTED") q.acceptedAt = q.updatedAt;
      await r.sales.saveQuotation(q);
      await r.audit.record(actor, {
        action,
        entityType: "quotation",
        entityId: id,
        summary: `${q.number} ${to.toLowerCase()}`,
      });
      return q;
    });
  }
  async acceptQuotation(actor: Actor, id: string) {
    requirePermission(actor, "quotations.write");
    return this.transitionQuotation(
      actor,
      id,
      ["ISSUED"],
      "ACCEPTED",
      "quotation.accept",
    );
  }
  async rejectQuotation(actor: Actor, id: string) {
    requirePermission(actor, "quotations.write");
    return this.transitionQuotation(
      actor,
      id,
      ["ISSUED"],
      "REJECTED",
      "quotation.reject",
    );
  }
  async cancelQuotation(actor: Actor, id: string) {
    requirePermission(actor, "quotations.write");
    return this.transitionQuotation(
      actor,
      id,
      ["DRAFT", "ISSUED"],
      "CANCELLED",
      "quotation.cancel",
    );
  }

  // =================== sales orders ===================
  async listOrders(
    actor: Actor,
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<SalesOrder>> {
    requirePermission(actor, "orders.read");
    return this.uow.read((r) => r.sales.listOrders(q));
  }
  async getOrder(actor: Actor, id: string): Promise<SalesOrder> {
    requirePermission(actor, "orders.read");
    const o = await this.uow.read((r) => r.sales.getOrder(id));
    if (!o) throw notFound("Sales order");
    return o;
  }
  /** Accepted quotation → sales order, reserving stock for stocked lines.
   * `shortfall: "backorder"` lets lines without enough stock proceed
   * unreserved (to be purchased); the default refuses instead. */
  async convertToOrder(
    actor: Actor,
    quotationId: string,
    raw: unknown = {},
  ): Promise<SalesOrder> {
    requirePermission(actor, "orders.write");
    const input = record(raw);
    const shortfall = oneOf(
      input.shortfall,
      ["reject", "backorder"] as const,
      "Shortfall",
      "reject",
    );
    return this.uow.write(async (r) => {
      const q = await r.sales.getQuotation(quotationId);
      if (!q) throw notFound("Quotation");
      const existing = await r.sales.orderForQuotation(quotationId);
      if (existing) return existing;
      if (q.status !== "ACCEPTED")
        throw conflict(
          `Quotation ${q.number} is ${q.status.toLowerCase()}; only an accepted quotation can become an order.`,
        );
      const now = nowIso();
      const order: SalesOrder = {
        id: newId(),
        number: await r.config.nextNumber("order", "SO"),
        status: "CONFIRMED",
        quotationId: q.id,
        enquiryId: q.enquiryId,
        customerId: q.customerId,
        currency: q.currency,
        taxBp: q.taxBp,
        notes: q.notes,
        subtotalMinor: q.subtotalMinor,
        taxMinor: q.taxMinor,
        totalMinor: q.totalMinor,
        lines: q.lines.map((l) => ({
          ...l,
          id: newId(),
          quantityFulfilled: 0,
          quantityReturned: 0,
          quantityInvoiced: 0,
        })),
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await r.sales.insertOrder(order);
      await this.reserveLines(r, order, shortfall);
      await r.audit.record(actor, {
        action: "order.create",
        entityType: "order",
        entityId: order.id,
        summary: `${order.number} created from ${q.number}`,
        metadata: { quotationId: q.id, totalMinor: order.totalMinor },
      });
      return order;
    });
  }
  /** Direct (walk-in) order without a quotation. */
  async createOrder(actor: Actor, raw: unknown): Promise<SalesOrder> {
    requirePermission(actor, "orders.write");
    const input = record(raw);
    const shortfall = oneOf(
      input.shortfall,
      ["reject", "backorder"] as const,
      "Shortfall",
      "reject",
    );
    return this.uow.write(async (r) => {
      const customerId = text(input.customerId, "Customer", {
        required: true,
        max: 64,
      });
      const customer = await r.masterData.getCustomer(customerId);
      if (!customer) throw notFound("Customer");
      const cfg = await r.config.get();
      const lines = await buildLines(r, input.lines, { requirePrice: true });
      const taxBp = taxBpOf(input.taxBp, cfg.defaultTaxBp);
      const now = nowIso();
      const order: SalesOrder = {
        id: newId(),
        number: await r.config.nextNumber("order", "SO"),
        status: "CONFIRMED",
        quotationId: null,
        enquiryId: null,
        customerId,
        currency: cfg.currency,
        taxBp,
        notes: text(input.notes, "Notes", { max: 2000 }),
        ...totalsOf(lines, taxBp),
        lines: lines.map((l) => ({
          ...l,
          quantityFulfilled: 0,
          quantityReturned: 0,
          quantityInvoiced: 0,
        })),
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      await r.sales.insertOrder(order);
      await this.reserveLines(r, order, shortfall);
      await r.audit.record(actor, {
        action: "order.create",
        entityType: "order",
        entityId: order.id,
        summary: `${order.number} created`,
        metadata: { totalMinor: order.totalMinor },
      });
      return order;
    });
  }
  private async reserveLines(
    r: Repositories,
    order: SalesOrder,
    shortfall: "reject" | "backorder",
  ) {
    const inv = new InventoryOps(r);
    for (const line of order.lines) {
      if (!line.productId) continue;
      const available = await inv.availableFor(line.productId);
      if (available < line.quantity && shortfall === "backorder") continue;
      await inv.reserve({
        productId: line.productId,
        quantity: line.quantity,
        referenceType: LINE_REFERENCE,
        referenceId: line.id,
      });
    }
  }
  /** Reserves stock for backordered lines that now have stock. */
  async reserveShortfall(actor: Actor, orderId: string): Promise<SalesOrder> {
    requirePermission(actor, "orders.write");
    return this.uow.write(async (r) => {
      const order = await r.sales.getOrder(orderId);
      if (!order) throw notFound("Sales order");
      if (["CANCELLED", "INVOICED"].includes(order.status))
        throw conflict(
          `A ${order.status.toLowerCase()} order cannot reserve stock.`,
        );
      const inv = new InventoryOps(r);
      for (const line of order.lines) {
        if (!line.productId) continue;
        const held = (
          await r.inventory.activeReservations(LINE_REFERENCE, line.id)
        ).reduce((n, x) => n + x.quantity, 0);
        const need = line.quantity - line.quantityFulfilled - held;
        if (need > 0)
          await inv.reserve({
            productId: line.productId,
            quantity: need,
            referenceType: LINE_REFERENCE,
            referenceId: line.id,
          });
      }
      await r.audit.record(actor, {
        action: "order.reserve",
        entityType: "order",
        entityId: orderId,
        summary: `Stock reserved for ${order.number}`,
      });
      return order;
    });
  }
  /** Goods leave the shop: on-hand and reservation both drop. */
  async fulfillOrder(
    actor: Actor,
    orderId: string,
    raw: unknown,
  ): Promise<SalesOrder> {
    requirePermission(actor, "orders.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const order = await r.sales.getOrder(orderId);
      if (!order) throw notFound("Sales order");
      if (["CANCELLED", "INVOICED"].includes(order.status))
        throw conflict(
          `A ${order.status.toLowerCase()} order cannot be fulfilled.`,
        );
      const requested =
        Array.isArray(input.lines) && input.lines.length
          ? (input.lines as unknown[]).map((x) => record(x, "Line"))
          : order.lines.map((l) => ({
              lineId: l.id,
              quantity: l.quantity - l.quantityFulfilled,
            }));
      const inv = new InventoryOps(r);
      let any = false;
      for (const req of requested) {
        const line = order.lines.find((l) => l.id === req.lineId);
        if (!line) throw notFound("Order line");
        const qty = integer(req.quantity, "Quantity", {
          min: 0,
          max: 1_000_000,
        });
        if (qty === 0) continue;
        if (qty > line.quantity - line.quantityFulfilled)
          throw validation(
            `Only ${line.quantity - line.quantityFulfilled} of "${line.description}" remain to fulfil.`,
          );
        if (line.productId)
          await inv.fulfill(actor, {
            referenceType: LINE_REFERENCE,
            referenceId: line.id,
            movementReferenceType: "SALES_ORDER",
            movementReferenceId: order.id,
            quantity: qty,
            note: order.number,
          });
        line.quantityFulfilled += qty;
        any = true;
      }
      if (!any) throw validation("Nothing to fulfil.");
      const all = order.lines.every((l) => l.quantityFulfilled === l.quantity);
      order.status = all ? "FULFILLED" : "PARTIALLY_FULFILLED";
      order.updatedAt = nowIso();
      await r.sales.saveOrder(order);
      await r.audit.record(actor, {
        action: "order.fulfill",
        entityType: "order",
        entityId: orderId,
        summary: `${order.number} ${all ? "fulfilled" : "partially fulfilled"}`,
      });
      return order;
    });
  }
  async cancelOrder(
    actor: Actor,
    orderId: string,
    raw: unknown = {},
  ): Promise<SalesOrder> {
    requirePermission(actor, "orders.write");
    const reason = text(record(raw).reason, "Reason", { max: 500 });
    return this.uow.write(async (r) => {
      const order = await r.sales.getOrder(orderId);
      if (!order) throw notFound("Sales order");
      if (order.status === "CANCELLED") return order;
      if (order.lines.some((l) => l.quantityFulfilled > 0))
        throw conflict(
          "Goods have already been delivered on this order. Record a return instead of cancelling.",
        );
      const inv = new InventoryOps(r);
      for (const line of order.lines)
        await inv.releaseAll(LINE_REFERENCE, line.id);
      order.status = "CANCELLED";
      order.updatedAt = nowIso();
      await r.sales.saveOrder(order);
      await r.audit.record(actor, {
        action: "order.cancel",
        entityType: "order",
        entityId: orderId,
        summary: `${order.number} cancelled`,
        metadata: { reason },
      });
      return order;
    });
  }
  /** Delivered goods come back: stock is restored; money is not touched
   * (credit notes / refunds are outside this release — see docs). */
  async returnItems(
    actor: Actor,
    orderId: string,
    raw: unknown,
  ): Promise<SalesReturn> {
    requirePermission(actor, "orders.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const order = await r.sales.getOrder(orderId);
      if (!order) throw notFound("Sales order");
      if (!Array.isArray(input.lines) || input.lines.length === 0)
        throw validation("Choose the items being returned.");
      const inv = new InventoryOps(r);
      const number = await r.config.nextNumber("return", "RET");
      const ret: SalesReturn = {
        id: newId(),
        number,
        salesOrderId: orderId,
        reason: text(input.reason, "Reason", { required: true, max: 500 }),
        lines: [],
        createdBy: actor.id,
        createdAt: nowIso(),
      };
      for (const raw of input.lines as unknown[]) {
        const l = record(raw, "Return line");
        const line = order.lines.find((x) => x.id === l.lineId);
        if (!line) throw notFound("Order line");
        const qty = integer(l.quantity, "Quantity", { min: 1, max: 1_000_000 });
        if (qty > line.quantityFulfilled - line.quantityReturned)
          throw validation(
            `Only ${line.quantityFulfilled - line.quantityReturned} of "${line.description}" can be returned.`,
          );
        line.quantityReturned += qty;
        if (line.productId) {
          const locationId = text(l.locationId, "Return location", {
            required: true,
            max: 64,
          });
          await inv.returnIn(actor, {
            productId: line.productId,
            locationId,
            quantity: qty,
            referenceType: "SALES_RETURN",
            referenceId: ret.id,
            note: `${order.number} ${number}`,
          });
          ret.lines.push({
            orderLineId: line.id,
            productId: line.productId,
            quantity: qty,
            locationId,
          });
        }
      }
      order.updatedAt = nowIso();
      await r.sales.saveOrder(order);
      await r.sales.insertReturn(ret);
      await r.audit.record(actor, {
        action: "order.return",
        entityType: "order",
        entityId: orderId,
        summary: `${number} recorded against ${order.number}`,
      });
      return ret;
    });
  }

  // =================== invoices ===================
  async listInvoices(
    actor: Actor,
    q: Paged & { status?: string; customerId?: string; unpaidOnly?: boolean },
  ): Promise<Page<Invoice>> {
    requirePermission(actor, "invoices.read");
    return this.uow.read((r) => r.sales.listInvoices(q));
  }
  async getInvoice(
    actor: Actor,
    id: string,
  ): Promise<{ invoice: Invoice; payments: Payment[] }> {
    requirePermission(actor, "invoices.read");
    return this.uow.read(async (r) => {
      const invoice = await r.sales.getInvoice(id);
      if (!invoice) throw notFound("Invoice");
      return { invoice, payments: await r.sales.paymentsForInvoice(id) };
    });
  }
  /** Bills every delivered-but-not-yet-invoiced quantity on the order. */
  async invoiceOrder(
    actor: Actor,
    orderId: string,
    raw: unknown = {},
  ): Promise<Invoice> {
    requirePermission(actor, "invoices.write");
    const input = record(raw);
    return this.uow.write(async (r) => {
      const order = await r.sales.getOrder(orderId);
      if (!order) throw notFound("Sales order");
      if (order.status === "CANCELLED")
        throw conflict("A cancelled order cannot be invoiced.");
      const cfg = await r.config.get();
      const lines: DocumentLine[] = [];
      order.lines.forEach((l: SalesOrderLine) => {
        const qty = l.quantityFulfilled - l.quantityInvoiced;
        if (qty <= 0) return;
        lines.push({
          id: newId(),
          position: lines.length,
          productId: l.productId,
          sku: l.sku,
          oemNumber: l.oemNumber,
          description: l.description,
          quantity: qty,
          unitPriceMinor: l.unitPriceMinor,
          discountBp: l.discountBp,
          lineTotalMinor: lineTotal({
            quantity: qty,
            unitPrice: l.unitPriceMinor,
            discountBp: l.discountBp,
          }),
          orderItemId: l.id,
        });
        l.quantityInvoiced += qty;
      });
      if (lines.length === 0)
        throw conflict(
          "There is nothing delivered that has not already been invoiced. Fulfil the order first.",
        );
      const issueDate = today();
      const now = nowIso();
      const invoice: Invoice = {
        id: newId(),
        number: await r.config.nextNumber("invoice", "INV"),
        status: "ISSUED",
        salesOrderId: order.id,
        quotationId: order.quotationId,
        customerId: order.customerId,
        currency: order.currency,
        taxBp: order.taxBp,
        issueDate,
        dueDate:
          isoDate(input.dueDate, "Due date") ??
          addDays(issueDate, cfg.invoiceDueDays),
        ...totalsOf(lines, order.taxBp),
        amountPaidMinor: 0,
        balanceMinor: 0,
        notes: text(input.notes, "Notes", { max: 2000 }) || cfg.invoiceNotes,
        lines,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      invoice.balanceMinor = invoice.totalMinor;
      await r.sales.insertInvoice(invoice);
      if (order.lines.every((l) => l.quantityInvoiced === l.quantity))
        order.status = "INVOICED";
      order.updatedAt = now;
      await r.sales.saveOrder(order);
      await r.audit.record(actor, {
        action: "invoice.issue",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `${invoice.number} issued for ${order.number}`,
        metadata: { totalMinor: invoice.totalMinor, orderId: order.id },
      });
      return invoice;
    });
  }
  /** Walk-in convenience: deliver everything and bill it in one step. */
  async sellNow(actor: Actor, orderId: string): Promise<Invoice> {
    await this.fulfillOrder(actor, orderId, {});
    return this.invoiceOrder(actor, orderId, {});
  }
  async recordPayment(
    actor: Actor,
    invoiceId: string,
    raw: unknown,
  ): Promise<{ invoice: Invoice; payment: Payment }> {
    requirePermission(actor, "payments.record");
    const input = record(raw);
    const amountMinor = integer(input.amountMinor, "Amount", {
      min: 1,
      max: 9_000_000_000_000,
    });
    const method = oneOf(input.method, paymentMethods, "Payment method");
    return this.uow.write(async (r) => {
      const invoice = await r.sales.getInvoice(invoiceId);
      if (!invoice) throw notFound("Invoice");
      if (invoice.status === "VOID")
        throw conflict("A void invoice cannot take payments.");
      if (invoice.status === "PAID" || invoice.balanceMinor <= 0)
        throw conflict("This invoice is already paid in full.");
      if (amountMinor > invoice.balanceMinor)
        throw validation(
          `The payment exceeds the balance due (${invoice.balanceMinor} minor units).`,
        );
      const payment: Payment = {
        id: newId(),
        invoiceId,
        amountMinor,
        method,
        reference: text(input.reference, "Reference", { max: 120 }),
        paidAt: isoDate(input.paidAt, "Payment date") ?? today(),
        notes: text(input.notes, "Notes", { max: 500 }),
        recordedBy: actor.id,
        createdAt: nowIso(),
      };
      await r.sales.insertPayment(payment);
      invoice.amountPaidMinor += amountMinor;
      invoice.balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
      invoice.status = invoice.balanceMinor === 0 ? "PAID" : "PARTIALLY_PAID";
      invoice.updatedAt = nowIso();
      await r.sales.saveInvoice(invoice);
      await r.audit.record(actor, {
        action: "payment.record",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `Payment recorded on ${invoice.number}`,
        metadata: { amountMinor, method, paymentId: payment.id },
      });
      return { invoice, payment };
    });
  }
  async voidInvoice(
    actor: Actor,
    invoiceId: string,
    raw: unknown,
  ): Promise<Invoice> {
    requirePermission(actor, "invoices.write");
    const reason = text(record(raw).reason, "Reason", {
      required: true,
      max: 500,
    });
    return this.uow.write(async (r) => {
      const invoice = await r.sales.getInvoice(invoiceId);
      if (!invoice) throw notFound("Invoice");
      if (invoice.status === "VOID") return invoice;
      if (invoice.amountPaidMinor > 0)
        throw conflict(
          "This invoice has payments recorded and cannot be voided.",
        );
      invoice.status = "VOID";
      invoice.updatedAt = nowIso();
      await r.sales.saveInvoice(invoice);
      if (invoice.salesOrderId) {
        const order = await r.sales.getOrder(invoice.salesOrderId);
        if (order) {
          for (const il of invoice.lines) {
            const ol = order.lines.find((x) => x.id === il.orderItemId);
            if (ol)
              ol.quantityInvoiced = Math.max(
                0,
                ol.quantityInvoiced - il.quantity,
              );
          }
          if (order.status === "INVOICED")
            order.status = order.lines.every(
              (l) => l.quantityFulfilled === l.quantity,
            )
              ? "FULFILLED"
              : "PARTIALLY_FULFILLED";
          order.updatedAt = nowIso();
          await r.sales.saveOrder(order);
        }
      }
      await r.audit.record(actor, {
        action: "invoice.void",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `${invoice.number} voided`,
        metadata: { reason },
      });
      return invoice;
    });
  }
}
