import type { UnitOfWork } from "../providers/uow";
import type { Actor } from "./types";
import { notFound } from "../kernel/errors";
import { requirePermission } from "./permissions";
import {
  renderCommercialDocument,
  type CommercialDocument,
} from "../documents/render";

export interface GeneratedDocument {
  bytes: Uint8Array;
  fileName: string;
  fileId: string;
}

/**
 * Quotation and invoice PDFs. They are rendered from the stored records
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
        customer,
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
        customer,
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
