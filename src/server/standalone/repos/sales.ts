import type { SqlDatabase, SqlHandle } from "../../db/connection";
import type {
  DocumentLine,
  Enquiry,
  EnquiryItem,
  Invoice,
  Page,
  Payment,
  Quotation,
  SalesOrder,
  SalesOrderLine,
} from "../../domain/types";
import type { Paged } from "../../providers/data";
import type { SalesRepository, SalesReturn } from "../../providers/sales";
import { likeTerm, mapSeq, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : String(v));

const docLine = (r: Row): DocumentLine => ({
  id: s(r.id),
  position: n(r.position),
  productId: nn(r.product_id),
  sku: s(r.sku),
  oemNumber: s(r.oem_number),
  description: s(r.description),
  quantity: n(r.quantity),
  unitPriceMinor: n(r.unit_price_minor),
  discountBp: n(r.discount_bp),
  lineTotalMinor: n(r.line_total_minor),
  ...(r.order_item_id !== undefined
    ? { orderItemId: nn(r.order_item_id) }
    : {}),
});

async function insertLines(
  h: SqlHandle,
  table: string,
  fk: string,
  ownerId: string,
  lines: DocumentLine[],
  extra?: (l: DocumentLine) => Record<string, unknown>,
) {
  for (const l of lines) {
    const e = extra?.(l) ?? {};
    const cols = [
      "id",
      fk,
      "position",
      "product_id",
      "sku",
      "oem_number",
      "description",
      "quantity",
      "unit_price_minor",
      "discount_bp",
      "line_total_minor",
      ...Object.keys(e),
    ];
    const vals = [
      l.id,
      ownerId,
      l.position,
      l.productId,
      l.sku,
      l.oemNumber,
      l.description,
      l.quantity,
      l.unitPriceMinor,
      l.discountBp,
      l.lineTotalMinor,
      ...Object.values(e),
    ];
    await h.run(
      `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      vals as never,
    );
  }
}

export class SqliteSalesRepository implements SalesRepository {
  constructor(private readonly db: SqlDatabase) {}

  // ---------------- enquiries ----------------
  private async enquiryFrom(h: SqlHandle, r: Row): Promise<Enquiry> {
    const items = (
      await h.all<Row>(
        "SELECT * FROM enquiry_items WHERE enquiry_id = ? ORDER BY position",
        [s(r.id)],
      )
    ).map((i): EnquiryItem => ({
      id: s(i.id),
      enquiryId: s(i.enquiry_id),
      position: n(i.position),
      oemNumber: s(i.oem_number),
      partName: s(i.part_name),
      vehicleDescription: s(i.vehicle_description),
      quantity: n(i.quantity),
      referencePartId: nn(i.reference_part_id),
      providerKey: s(i.provider_key),
      sourceUrl: s(i.source_url),
      notes: s(i.notes),
      addedAt: s(i.added_at),
    }));
    return {
      id: s(r.id),
      number: s(r.number),
      status: r.status as Enquiry["status"],
      customerId: nn(r.customer_id),
      contactName: s(r.contact_name),
      contactEmail: s(r.contact_email),
      contactPhone: s(r.contact_phone),
      vin: s(r.vin),
      notes: s(r.notes),
      items,
      createdBy: nn(r.created_by),
      createdAt: s(r.created_at),
      submittedAt: nn(r.submitted_at),
      updatedAt: s(r.updated_at),
    };
  }
  private async writeEnquiryItems(h: SqlHandle, e: Enquiry) {
    await h.run("DELETE FROM enquiry_items WHERE enquiry_id = ?", [e.id]);
    for (const [index, i] of e.items.entries())
      await h.run(
        `INSERT INTO enquiry_items(id,enquiry_id,position,oem_number,part_name,vehicle_description,quantity,reference_part_id,provider_key,source_url,notes,added_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          i.id,
          e.id,
          index,
          i.oemNumber,
          i.partName,
          i.vehicleDescription,
          i.quantity,
          i.referencePartId,
          i.providerKey,
          i.sourceUrl,
          i.notes,
          i.addedAt,
        ],
      );
  }
  async insertEnquiry(e: Enquiry) {
    await this.db.write(async (h) => {
      await h.run(
        `INSERT INTO enquiries(id,number,status,customer_id,contact_name,contact_email,contact_phone,vin,notes,created_by,created_at,submitted_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          e.id,
          e.number,
          e.status,
          e.customerId,
          e.contactName,
          e.contactEmail,
          e.contactPhone,
          e.vin,
          e.notes,
          e.createdBy,
          e.createdAt,
          e.submittedAt,
          e.updatedAt,
        ],
      );
      await this.writeEnquiryItems(h, e);
    });
  }
  async saveEnquiry(e: Enquiry) {
    await this.db.write(async (h) => {
      await h.run(
        `UPDATE enquiries SET status=?,customer_id=?,contact_name=?,contact_email=?,contact_phone=?,vin=?,notes=?,submitted_at=?,updated_at=? WHERE id=?`,
        [
          e.status,
          e.customerId,
          e.contactName,
          e.contactEmail,
          e.contactPhone,
          e.vin,
          e.notes,
          e.submittedAt,
          e.updatedAt,
          e.id,
        ],
      );
      await this.writeEnquiryItems(h, e);
    });
  }
  getEnquiry(id: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>("SELECT * FROM enquiries WHERE id = ?", [id]);
      return r ? this.enquiryFrom(h, r) : null;
    });
  }
  async listEnquiries(
    q: Paged & { status?: string; createdBy?: string },
  ): Promise<Page<Enquiry>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.createdBy) (where.push("created_by = ?"), params.push(q.createdBy));
    if (q.q?.trim()) {
      where.push(
        "(number LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\' OR contact_email LIKE ? ESCAPE '\\')",
      );
      const t = likeTerm(q.q);
      params.push(t, t, t);
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read(async (h) => ({
      items: await mapSeq(
        await h.all<Row>(
          `SELECT * FROM enquiries ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        ),
        (r) => this.enquiryFrom(h, r),
      ),
      total: await h.count(
        `SELECT COUNT(*) AS n FROM enquiries ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  draftEnquiryFor(createdBy: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>(
        "SELECT * FROM enquiries WHERE created_by = ? AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1",
        [createdBy],
      );
      return r ? this.enquiryFrom(h, r) : null;
    });
  }

  // ---------------- quotations ----------------
  private async quotationFrom(h: SqlHandle, r: Row): Promise<Quotation> {
    return {
      id: s(r.id),
      number: s(r.number),
      status: r.status as Quotation["status"],
      enquiryId: nn(r.enquiry_id),
      customerId: s(r.customer_id),
      currency: s(r.currency),
      taxBp: n(r.tax_bp),
      validUntil: nn(r.valid_until),
      notes: s(r.notes),
      terms: s(r.terms),
      subtotalMinor: n(r.subtotal_minor),
      taxMinor: n(r.tax_minor),
      totalMinor: n(r.total_minor),
      lines: (
        await h.all<Row>(
          "SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY position",
          [s(r.id)],
        )
      ).map(docLine),
      issuedAt: nn(r.issued_at),
      acceptedAt: nn(r.accepted_at),
      createdBy: nn(r.created_by),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
    };
  }
  async insertQuotation(x: Quotation) {
    await this.db.write(async (h) => {
      await h.run(
        `INSERT INTO quotations(id,number,enquiry_id,customer_id,status,currency,tax_bp,valid_until,notes,terms,subtotal_minor,tax_minor,total_minor,issued_at,accepted_at,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          x.id,
          x.number,
          x.enquiryId,
          x.customerId,
          x.status,
          x.currency,
          x.taxBp,
          x.validUntil,
          x.notes,
          x.terms,
          x.subtotalMinor,
          x.taxMinor,
          x.totalMinor,
          x.issuedAt,
          x.acceptedAt,
          x.createdBy,
          x.createdAt,
          x.updatedAt,
        ],
      );
      await insertLines(h, "quotation_items", "quotation_id", x.id, x.lines);
    });
  }
  async saveQuotation(x: Quotation) {
    await this.db.write(async (h) => {
      await h.run(
        `UPDATE quotations SET customer_id=?,status=?,currency=?,tax_bp=?,valid_until=?,notes=?,terms=?,subtotal_minor=?,tax_minor=?,total_minor=?,issued_at=?,accepted_at=?,updated_at=? WHERE id=?`,
        [
          x.customerId,
          x.status,
          x.currency,
          x.taxBp,
          x.validUntil,
          x.notes,
          x.terms,
          x.subtotalMinor,
          x.taxMinor,
          x.totalMinor,
          x.issuedAt,
          x.acceptedAt,
          x.updatedAt,
          x.id,
        ],
      );
      await h.run("DELETE FROM quotation_items WHERE quotation_id = ?", [x.id]);
      await insertLines(h, "quotation_items", "quotation_id", x.id, x.lines);
    });
  }
  getQuotation(id: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>("SELECT * FROM quotations WHERE id = ?", [id]);
      return r ? this.quotationFrom(h, r) : null;
    });
  }
  listQuotations(
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<Quotation>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.customerId)
      (where.push("customer_id = ?"), params.push(q.customerId));
    if (q.q?.trim())
      (where.push("number LIKE ? ESCAPE '\\'"), params.push(likeTerm(q.q)));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read(async (h) => ({
      items: await mapSeq(
        await h.all<Row>(
          `SELECT * FROM quotations ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        ),
        (r) => this.quotationFrom(h, r),
      ),
      total: await h.count(
        `SELECT COUNT(*) AS n FROM quotations ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  quotationsForEnquiry(enquiryId: string) {
    return this.db.read(
      async (h) =>
        await mapSeq(
          await h.all<Row>(
            "SELECT * FROM quotations WHERE enquiry_id = ? ORDER BY created_at",
            [enquiryId],
          ),
          (r) => this.quotationFrom(h, r),
        ),
    );
  }

  // ---------------- sales orders ----------------
  private async orderFrom(h: SqlHandle, r: Row): Promise<SalesOrder> {
    return {
      id: s(r.id),
      number: s(r.number),
      status: r.status as SalesOrder["status"],
      quotationId: nn(r.quotation_id),
      enquiryId: nn(r.enquiry_id),
      customerId: s(r.customer_id),
      currency: s(r.currency),
      taxBp: n(r.tax_bp),
      notes: s(r.notes),
      subtotalMinor: n(r.subtotal_minor),
      taxMinor: n(r.tax_minor),
      totalMinor: n(r.total_minor),
      lines: (
        await h.all<Row>(
          "SELECT * FROM sales_order_items WHERE order_id = ? ORDER BY position",
          [s(r.id)],
        )
      ).map((l): SalesOrderLine => ({
        ...docLine(l),
        quantityFulfilled: n(l.quantity_fulfilled),
        quantityReturned: n(l.quantity_returned),
        quantityInvoiced: n(l.quantity_invoiced),
      })),
      createdBy: nn(r.created_by),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
    };
  }
  private async writeOrderLines(h: SqlHandle, o: SalesOrder) {
    const lines = new Map(o.lines.map((l) => [l.id, l]));
    await insertLines(
      h,
      "sales_order_items",
      "order_id",
      o.id,
      o.lines,
      (l) => {
        const full = lines.get(l.id)!;
        return {
          quantity_fulfilled: full.quantityFulfilled,
          quantity_returned: full.quantityReturned,
          quantity_invoiced: full.quantityInvoiced,
        };
      },
    );
  }
  async insertOrder(o: SalesOrder) {
    await this.db.write(async (h) => {
      await h.run(
        `INSERT INTO sales_orders(id,number,quotation_id,enquiry_id,customer_id,status,currency,tax_bp,notes,subtotal_minor,tax_minor,total_minor,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          o.id,
          o.number,
          o.quotationId,
          o.enquiryId,
          o.customerId,
          o.status,
          o.currency,
          o.taxBp,
          o.notes,
          o.subtotalMinor,
          o.taxMinor,
          o.totalMinor,
          o.createdBy,
          o.createdAt,
          o.updatedAt,
        ],
      );
      await this.writeOrderLines(h, o);
    });
  }
  async saveOrder(o: SalesOrder) {
    await this.db.write(async (h) => {
      await h.run(
        "UPDATE sales_orders SET status=?, notes=?, updated_at=? WHERE id=?",
        [o.status, o.notes, o.updatedAt, o.id],
      );
      for (const l of o.lines)
        await h.run(
          "UPDATE sales_order_items SET quantity_fulfilled=?, quantity_returned=?, quantity_invoiced=? WHERE id=?",
          [l.quantityFulfilled, l.quantityReturned, l.quantityInvoiced, l.id],
        );
    });
  }
  getOrder(id: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>("SELECT * FROM sales_orders WHERE id = ?", [
        id,
      ]);
      return r ? this.orderFrom(h, r) : null;
    });
  }
  listOrders(
    q: Paged & { status?: string; customerId?: string },
  ): Promise<Page<SalesOrder>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.customerId)
      (where.push("customer_id = ?"), params.push(q.customerId));
    if (q.q?.trim())
      (where.push("number LIKE ? ESCAPE '\\'"), params.push(likeTerm(q.q)));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read(async (h) => ({
      items: await mapSeq(
        await h.all<Row>(
          `SELECT * FROM sales_orders ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        ),
        (r) => this.orderFrom(h, r),
      ),
      total: await h.count(
        `SELECT COUNT(*) AS n FROM sales_orders ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  orderForQuotation(quotationId: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>(
        "SELECT * FROM sales_orders WHERE quotation_id = ?",
        [quotationId],
      );
      return r ? this.orderFrom(h, r) : null;
    });
  }

  // ---------------- invoices & payments ----------------
  private async invoiceFrom(h: SqlHandle, r: Row): Promise<Invoice> {
    const total = n(r.total_minor);
    const paid = n(r.amount_paid_minor);
    return {
      id: s(r.id),
      number: s(r.number),
      status: r.status as Invoice["status"],
      salesOrderId: nn(r.sales_order_id),
      quotationId: nn(r.quotation_id),
      customerId: s(r.customer_id),
      currency: s(r.currency),
      taxBp: n(r.tax_bp),
      issueDate: s(r.issue_date),
      dueDate: nn(r.due_date),
      subtotalMinor: n(r.subtotal_minor),
      taxMinor: n(r.tax_minor),
      totalMinor: total,
      amountPaidMinor: paid,
      balanceMinor: total - paid,
      notes: s(r.notes),
      lines: (
        await h.all<Row>(
          "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position",
          [s(r.id)],
        )
      ).map(docLine),
      createdBy: nn(r.created_by),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
    };
  }
  async insertInvoice(i: Invoice) {
    await this.db.write(async (h) => {
      await h.run(
        `INSERT INTO invoices(id,number,sales_order_id,quotation_id,customer_id,status,currency,tax_bp,issue_date,due_date,subtotal_minor,tax_minor,total_minor,amount_paid_minor,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          i.id,
          i.number,
          i.salesOrderId,
          i.quotationId,
          i.customerId,
          i.status,
          i.currency,
          i.taxBp,
          i.issueDate,
          i.dueDate,
          i.subtotalMinor,
          i.taxMinor,
          i.totalMinor,
          i.amountPaidMinor,
          i.notes,
          i.createdBy,
          i.createdAt,
          i.updatedAt,
        ],
      );
      await insertLines(
        h,
        "invoice_items",
        "invoice_id",
        i.id,
        i.lines,
        (l) => ({
          order_item_id: l.orderItemId ?? null,
        }),
      );
    });
  }
  async saveInvoice(i: Invoice) {
    await this.db.write(async (h) =>
      h.run(
        "UPDATE invoices SET status=?, amount_paid_minor=?, due_date=?, notes=?, updated_at=? WHERE id=?",
        [i.status, i.amountPaidMinor, i.dueDate, i.notes, i.updatedAt, i.id],
      ),
    );
  }
  getInvoice(id: string) {
    return this.db.read(async (h) => {
      const r = await h.get<Row>("SELECT * FROM invoices WHERE id = ?", [id]);
      return r ? this.invoiceFrom(h, r) : null;
    });
  }
  listInvoices(
    q: Paged & {
      status?: string;
      customerId?: string;
      unpaidOnly?: boolean;
      overdueBefore?: string;
    },
  ): Promise<Page<Invoice>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.customerId)
      (where.push("customer_id = ?"), params.push(q.customerId));
    if (q.unpaidOnly) where.push("status IN ('ISSUED','PARTIALLY_PAID')");
    if (q.overdueBefore)
      (where.push(
        "status IN ('ISSUED','PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date < ?",
      ),
        params.push(q.overdueBefore));
    if (q.q?.trim())
      (where.push("number LIKE ? ESCAPE '\\'"), params.push(likeTerm(q.q)));
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.read(async (h) => ({
      items: await mapSeq(
        await h.all<Row>(
          `SELECT * FROM invoices ${clause} ORDER BY issue_date DESC, number DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset] as never,
        ),
        (r) => this.invoiceFrom(h, r),
      ),
      total: await h.count(
        `SELECT COUNT(*) AS n FROM invoices ${clause}`,
        params,
      ),
      page,
      pageSize,
    }));
  }
  invoicesForOrder(orderId: string) {
    return this.db.read(
      async (h) =>
        await mapSeq(
          await h.all<Row>(
            "SELECT * FROM invoices WHERE sales_order_id = ? ORDER BY created_at",
            [orderId],
          ),
          (r) => this.invoiceFrom(h, r),
        ),
    );
  }
  async insertPayment(p: Payment) {
    await this.db.write(async (h) =>
      h.run(
        "INSERT INTO payments(id,invoice_id,amount_minor,method,reference,paid_at,notes,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          p.id,
          p.invoiceId,
          p.amountMinor,
          p.method,
          p.reference,
          p.paidAt,
          p.notes,
          p.recordedBy,
          p.createdAt,
        ],
      ),
    );
  }
  paymentsForInvoice(invoiceId: string) {
    return this.db.read(async (h) =>
      (
        await h.all<Row>(
          "SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at, created_at",
          [invoiceId],
        )
      ).map((r): Payment => ({
        id: s(r.id),
        invoiceId: s(r.invoice_id),
        amountMinor: n(r.amount_minor),
        method: r.method as Payment["method"],
        reference: s(r.reference),
        paidAt: s(r.paid_at),
        notes: s(r.notes),
        recordedBy: nn(r.recorded_by),
        createdAt: s(r.created_at),
      })),
    );
  }

  // ---------------- returns ----------------
  async insertReturn(r: SalesReturn) {
    await this.db.write(async (h) => {
      await h.run(
        "INSERT INTO sales_returns(id,number,sales_order_id,reason,created_by,created_at) VALUES (?,?,?,?,?,?)",
        [r.id, r.number, r.salesOrderId, r.reason, r.createdBy, r.createdAt],
      );
      for (const [i, l] of r.lines.entries())
        await h.run(
          "INSERT INTO sales_return_items(id,return_id,order_item_id,product_id,location_id,quantity) VALUES (?,?,?,?,?,?)",
          [
            `${r.id}:${i}`,
            r.id,
            l.orderLineId,
            l.productId,
            l.locationId,
            l.quantity,
          ],
        );
    });
  }
  private async returnFrom(h: SqlHandle, r: Row): Promise<SalesReturn> {
    return {
      id: s(r.id),
      number: s(r.number),
      salesOrderId: s(r.sales_order_id),
      reason: s(r.reason),
      lines: (
        await h.all<Row>(
          "SELECT * FROM sales_return_items WHERE return_id = ?",
          [s(r.id)],
        )
      ).map((l) => ({
        orderLineId: s(l.order_item_id),
        productId: s(l.product_id),
        quantity: n(l.quantity),
        locationId: s(l.location_id),
      })),
      createdBy: nn(r.created_by),
      createdAt: s(r.created_at),
    };
  }
  returnsForOrder(orderId: string) {
    return this.db.read(
      async (h) =>
        await mapSeq(
          await h.all<Row>(
            "SELECT * FROM sales_returns WHERE sales_order_id = ? ORDER BY created_at",
            [orderId],
          ),
          (r) => this.returnFrom(h, r),
        ),
    );
  }
  listReturns(q: Paged): Promise<Page<SalesReturn>> {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize);
    return this.db.read(async (h) => ({
      items: await mapSeq(
        await h.all<Row>(
          "SELECT * FROM sales_returns ORDER BY created_at DESC LIMIT ? OFFSET ?",
          [pageSize, offset],
        ),
        (r) => this.returnFrom(h, r),
      ),
      total: await h.count("SELECT COUNT(*) AS n FROM sales_returns"),
      page,
      pageSize,
    }));
  }
}
