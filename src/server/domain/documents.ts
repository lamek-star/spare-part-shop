import type { UnitOfWork } from "../providers/uow";
import type { Actor } from "./types";
import { notFound } from "../kernel/errors";
import { requirePermission } from "./permissions";
import {
  partyOfCustomer,
  renderCommercialDocument,
  type CommercialDocument,
} from "../documents/render";

export interface GeneratedDocument {
  bytes: Uint8Array;
  fileName: string;
  fileId: string;
}

/**
 * Quotation, invoice, purchase order and sales order PDFs. They are rendered from the stored records
 * (never from client input) and kept through FileStorage, one current copy
 * per document, so a later IntraForge document store can take the same
 * files over.
 */
export class DocumentService {
  constructor(private readonly uow: UnitOfWork) {}

  async quotationPdf(actor: Actor, id: string): Promise<GeneratedDocument> {
    requirePermission(actor, "quotations.read");
    requirePermission(actor, "documents.read");
    return this.uow.write(async (r) => {
      const q = await r.sales.getQuotation(id);
      if (!q) throw notFound("Quotation");
      const customer = await r.masterData.getCustomer(q.customerId);
      if (!customer) throw notFound("Customer");
      const doc: CommercialDocument = {
        ...q,
        kind: "QUOTATION",
        dateLabel: "Valid until",
        date: q.validUntil,
        issuedLabel: "Issued",
        issued: q.issuedAt ?? q.createdAt,
      };
      const bytes = renderCommercialDocument(
        doc,
        await r.config.get(),
        partyOfCustomer(customer),
      );
      return this.keep(
        r,
        "QUOTATION_PDF",
        "quotation",
        q.id,
        q.number,
        bytes,
        actor,
      );
    });
  }

  async invoicePdf(actor: Actor, id: string): Promise<GeneratedDocument> {
    requirePermission(actor, "invoices.read");
    requirePermission(actor, "documents.read");
    return this.uow.write(async (r) => {
      const inv = await r.sales.getInvoice(id);
      if (!inv) throw notFound("Invoice");
      const customer = await r.masterData.getCustomer(inv.customerId);
      if (!customer) throw notFound("Customer");
      const payments = await r.sales.paymentsForInvoice(id);
      const doc: CommercialDocument = {
        ...inv,
        kind: "INVOICE",
        dateLabel: "Due date",
        date: inv.dueDate,
        issuedLabel: "Issued",
        issued: inv.issueDate,
        terms: "",
        payments,
      };
      const bytes = renderCommercialDocument(
        doc,
        await r.config.get(),
        partyOfCustomer(customer),
      );
      return this.keep(
        r,
        "INVOICE_PDF",
        "invoice",
        inv.id,
        inv.number,
        bytes,
        actor,
      );
    });
  }

  /** The purchase order to send to the supplier: their name and contact, your SKU with their part number (else the
   * manufacturer's), quantities and costs, and where the goods go. */
  async purchaseOrderPdf(actor: Actor, id: string): Promise<GeneratedDocument> {
    requirePermission(actor, "purchasing.read");
    requirePermission(actor, "documents.read");
    return this.uow.write(async (r) => {
      const po = await r.purchasing.getOrder(id);
      if (!po) throw notFound("Purchase order");
      const supplier = await r.masterData.getSupplier(po.supplierId);
      if (!supplier) throw notFound("Supplier");
      const location = await r.masterData.getLocation(po.locationId);
      const warehouse = location ? await r.masterData.getWarehouse(location.warehouseId) : null;
      const shop = await r.config.get();
      const lines: CommercialDocument["lines"] = [];
      for (const l of po.lines) {
        const product = await r.products.get(l.productId);
        const theirs = (await r.products.suppliers(l.productId)).find((s) => s.supplierId === po.supplierId);
        const oem = (await r.products.numbers(l.productId)).find((n) => n.type === "OEM_OE");
        lines.push({
          id: l.id,
          position: l.position,
          productId: l.productId,
          sku: product?.sku ?? "",
          oemNumber: theirs?.supplierPartNumber || oem?.display || "",
          description: product?.name ?? "",
          quantity: l.quantity,
          unitPriceMinor: l.unitCostMinor,
          discountBp: l.discountBp,
          lineTotalMinor: l.lineTotalMinor,
          note: l.quantityReceived ? `Received ${l.quantityReceived} of ${l.quantity}` : "",
        });
      }
      const place = [warehouse?.name, location?.code].filter(Boolean).join(" / ");
      const doc: CommercialDocument = {
        ...po,
        kind: "PURCHASE_ORDER",
        lines,
        dateLabel: "Expected",
        date: po.expectedDate,
        issuedLabel: "Date",
        issued: po.createdAt,
        terms: supplier.paymentTerms ? `Payment terms: ${supplier.paymentTerms}` : "",
        deliverTo: [shop.shopName, place, shop.address].filter(Boolean).join(", "),
      };
      const bytes = renderCommercialDocument(doc, shop, {
        name: supplier.name,
        contactPerson: supplier.contactPerson,
        address: supplier.address,
        phone: supplier.phone,
        email: supplier.email,
        taxNumber: supplier.taxNumber,
      });
      return this.keep(r, "PURCHASE_ORDER_PDF", "purchase_order", po.id, po.number, bytes, actor);
    });
  }

  /** The customer's order in detail: every line with its price, and how much is delivered, invoiced and returned. */
  async salesOrderPdf(actor: Actor, id: string): Promise<GeneratedDocument> {
    requirePermission(actor, "orders.read");
    requirePermission(actor, "documents.read");
    return this.uow.write(async (r) => {
      const so = await r.sales.getOrder(id);
      if (!so) throw notFound("Sales order");
      const customer = await r.masterData.getCustomer(so.customerId);
      if (!customer) throw notFound("Customer");
      const doc: CommercialDocument = {
        ...so,
        kind: "SALES_ORDER",
        lines: so.lines.map((l) => ({
          ...l,
          note: [
            l.quantityFulfilled ? `Delivered ${l.quantityFulfilled} of ${l.quantity}` : "",
            l.quantityInvoiced ? `invoiced ${l.quantityInvoiced}` : "",
            l.quantityReturned ? `returned ${l.quantityReturned}` : "",
          ]
            .filter(Boolean)
            .join(", "),
        })),
        dateLabel: "Last change",
        date: so.updatedAt,
        issuedLabel: "Order date",
        issued: so.createdAt,
        terms: customer.paymentTerms ? `Payment terms: ${customer.paymentTerms}` : "",
      };
      const bytes = renderCommercialDocument(doc, await r.config.get(), partyOfCustomer(customer));
      return this.keep(r, "SALES_ORDER_PDF", "order", so.id, so.number, bytes, actor);
    });
  }

  private async keep(
    r: Parameters<Parameters<UnitOfWork["write"]>[0]>[0],
    kind: string,
    entityType: string,
    entityId: string,
    number: string,
    bytes: Uint8Array,
    actor: Actor,
  ): Promise<GeneratedDocument> {
    const previous = await r.files.listFor(entityType, entityId, kind);
    const file = await r.files.put({
      bytes,
      originalName: `${number}.pdf`,
      mime: "application/pdf",
      kind,
      entityType,
      entityId,
      createdBy: actor.id,
    });
    for (const old of previous) await r.files.delete(old.id);
    return { bytes, fileName: `${number}.pdf`, fileId: file.id };
  }
}
