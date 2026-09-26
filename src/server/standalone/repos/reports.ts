import type { Database } from "../../db/connection";
import type {
  DashboardMetrics,
  ProductSalesHistory,
  ReportRepository,
  StockLevelRow,
} from "../../providers/sales";
import { likeTerm, pageArgs } from "./util";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const n = (v: unknown) => Number(v ?? 0);

/** All report figures come straight from persisted rows — no seeded or
 * cached numbers. Sales figures are on an invoiced (non-void) basis; cash
 * figures are on a payments-received basis. */
export class SqliteReportRepository implements ReportRepository {
  constructor(private readonly db: Database) {}

  dashboard(): Promise<DashboardMetrics> {
    return this.db.read((h) => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      const start = monthStart.toISOString().slice(0, 10);
      const one = (sql: string, params: string[] = []) =>
        n(h.get<{ v: number }>(sql, params)?.v);
      return {
        products: one("SELECT COUNT(*) AS v FROM products"),
        activeProducts: one(
          "SELECT COUNT(*) AS v FROM products WHERE status = 'ACTIVE'",
        ),
        lowStockProducts: one(
          `SELECT COUNT(*) AS v FROM products p WHERE p.reorder_level > 0 AND p.status = 'ACTIVE' AND
             COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM stock_balances b WHERE b.product_id = p.id), 0) <= p.reorder_level`,
        ),
        inventoryValueMinor: one(
          `SELECT COALESCE(SUM(b.on_hand * p.cost_minor), 0) AS v FROM stock_balances b JOIN products p ON p.id = b.product_id`,
        ),
        openEnquiries: one(
          "SELECT COUNT(*) AS v FROM enquiries WHERE status = 'SUBMITTED'",
        ),
        openQuotations: one(
          "SELECT COUNT(*) AS v FROM quotations WHERE status IN ('DRAFT','ISSUED')",
        ),
        openOrders: one(
          "SELECT COUNT(*) AS v FROM sales_orders WHERE status IN ('CONFIRMED','PARTIALLY_FULFILLED')",
        ),
        outstandingInvoices: one(
          "SELECT COUNT(*) AS v FROM invoices WHERE status IN ('ISSUED','PARTIALLY_PAID')",
        ),
        outstandingBalanceMinor: one(
          "SELECT COALESCE(SUM(total_minor - amount_paid_minor), 0) AS v FROM invoices WHERE status IN ('ISSUED','PARTIALLY_PAID')",
        ),
        salesThisMonthMinor: one(
          "SELECT COALESCE(SUM(total_minor), 0) AS v FROM invoices WHERE status <> 'VOID' AND issue_date >= ?",
          [start],
        ),
        paymentsThisMonthMinor: one(
          "SELECT COALESCE(SUM(amount_minor), 0) AS v FROM payments WHERE paid_at >= ?",
          [start],
        ),
      };
    });
  }
  inventoryValuation() {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT p.id, p.sku, p.name, p.cost_minor,
                  COALESCE(SUM(b.on_hand),0) AS on_hand, COALESCE(SUM(b.reserved),0) AS reserved
             FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id
            GROUP BY p.id HAVING on_hand > 0 ORDER BY p.name COLLATE NOCASE`,
        )
        .map((r) => ({
          productId: s(r.id),
          sku: s(r.sku),
          name: s(r.name),
          onHand: n(r.on_hand),
          reserved: n(r.reserved),
          unitCostMinor: n(r.cost_minor),
          valueMinor: n(r.on_hand) * n(r.cost_minor),
        })),
    );
  }
  stockLevels(q: {
    q?: string;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, offset } = pageArgs(q.page, q.pageSize, 200);
    const where = ["(b.on_hand > 0 OR b.reserved > 0)"];
    const params: (string | number)[] = [];
    if (q.q?.trim()) {
      where.push(
        "(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR l.code LIKE ? ESCAPE '\\')",
      );
      const t = likeTerm(q.q);
      params.push(t, t, t);
    }
    if (q.warehouseId) (where.push("w.id = ?"), params.push(q.warehouseId));
    const from = `FROM stock_balances b JOIN products p ON p.id = b.product_id JOIN locations l ON l.id = b.location_id JOIN warehouses w ON w.id = l.warehouse_id WHERE ${where.join(" AND ")}`;
    return this.db.read((h) => ({
      items: h
        .all<Row>(
          `SELECT p.id, p.sku, p.name, w.id AS wid, w.name AS warehouse, l.id AS lid, l.code AS location, b.on_hand, b.reserved ${from} ORDER BY p.name COLLATE NOCASE, w.name, l.code LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        )
        .map((r): StockLevelRow => ({
          productId: s(r.id),
          sku: s(r.sku),
          name: s(r.name),
          warehouseId: s(r.wid),
          warehouse: s(r.warehouse),
          locationId: s(r.lid),
          location: s(r.location),
          onHand: n(r.on_hand),
          reserved: n(r.reserved),
          available: n(r.on_hand) - n(r.reserved),
        })),
      total: h.count(`SELECT COUNT(*) AS n ${from}`, params),
      page,
      pageSize,
    }));
  }
  stockOnHand() {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT p.id, p.sku, p.name, w.name AS warehouse, l.code AS location, b.on_hand, b.reserved
             FROM stock_balances b JOIN products p ON p.id = b.product_id
             JOIN locations l ON l.id = b.location_id JOIN warehouses w ON w.id = l.warehouse_id
            WHERE b.on_hand > 0 ORDER BY p.name COLLATE NOCASE, w.name, l.code`,
        )
        .map((r) => ({
          productId: s(r.id),
          sku: s(r.sku),
          name: s(r.name),
          warehouse: s(r.warehouse),
          location: s(r.location),
          onHand: n(r.on_hand),
          reserved: n(r.reserved),
          available: n(r.on_hand) - n(r.reserved),
        })),
    );
  }
  lowStock() {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT p.id, p.sku, p.name, p.reorder_level,
                  COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM stock_balances b WHERE b.product_id = p.id), 0) AS available
             FROM products p WHERE p.reorder_level > 0 AND p.status = 'ACTIVE'
              AND COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM stock_balances b WHERE b.product_id = p.id), 0) <= p.reorder_level
            ORDER BY available, p.name COLLATE NOCASE`,
        )
        .map((r) => ({
          productId: s(r.id),
          sku: s(r.sku),
          name: s(r.name),
          available: n(r.available),
          reorderLevel: n(r.reorder_level),
        })),
    );
  }
  salesByPeriod(from: string, to: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT substr(issue_date,1,7) AS period, COUNT(*) AS invoices, SUM(total_minor) AS total, SUM(amount_paid_minor) AS paid
             FROM invoices WHERE status <> 'VOID' AND issue_date >= ? AND issue_date <= ? GROUP BY period ORDER BY period`,
          [from, to],
        )
        .map((r) => ({
          period: s(r.period),
          invoices: n(r.invoices),
          totalMinor: n(r.total),
          paidMinor: n(r.paid),
        })),
    );
  }
  productSales(productId: string, limit: number): Promise<ProductSalesHistory> {
    return this.db.read((h) => {
      const totals = h.get<Row>(
        `SELECT COALESCE(SUM(ii.quantity),0) AS q, COALESCE(SUM(ii.line_total_minor),0) AS t, COUNT(DISTINCT i.id) AS c, MAX(i.issue_date) AS last
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE ii.product_id = ? AND i.status <> 'VOID'`,
        [productId],
      )!;
      const recent = h
        .all<Row>(
          `SELECT i.id, i.number, i.issue_date, c.name AS customer, ii.quantity, ii.unit_price_minor, ii.line_total_minor
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN customers c ON c.id = i.customer_id
            WHERE ii.product_id = ? AND i.status <> 'VOID'
            ORDER BY i.issue_date DESC, i.number DESC LIMIT ?`,
          [productId, limit],
        )
        .map((r) => ({
          invoiceId: s(r.id),
          number: s(r.number),
          issueDate: s(r.issue_date),
          customerName: s(r.customer),
          quantity: n(r.quantity),
          unitPriceMinor: n(r.unit_price_minor),
          totalMinor: n(r.line_total_minor),
        }));
      return {
        quantity: n(totals.q),
        totalMinor: n(totals.t),
        invoices: n(totals.c),
        lastSoldAt: totals.last ? s(totals.last) : null,
        recent,
      };
    });
  }
  salesByProduct(from: string, to: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT ii.product_id, ii.sku, MIN(ii.description) AS description, SUM(ii.quantity) AS quantity, SUM(ii.line_total_minor) AS total
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.status <> 'VOID' AND i.issue_date >= ? AND i.issue_date <= ?
            GROUP BY COALESCE(ii.product_id, ii.description) ORDER BY total DESC LIMIT 200`,
          [from, to],
        )
        .map((r) => ({
          productId: (r.product_id as string | null) ?? null,
          sku: s(r.sku),
          description: s(r.description),
          quantity: n(r.quantity),
          totalMinor: n(r.total),
        })),
    );
  }
  customerActivity(from: string, to: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT c.id, c.name, COUNT(i.id) AS invoices, COALESCE(SUM(i.total_minor),0) AS total,
                  COALESCE(SUM(i.total_minor - i.amount_paid_minor),0) AS balance
             FROM customers c JOIN invoices i ON i.customer_id = c.id
            WHERE i.status <> 'VOID' AND i.issue_date >= ? AND i.issue_date <= ?
            GROUP BY c.id ORDER BY total DESC LIMIT 200`,
          [from, to],
        )
        .map((r) => ({
          customerId: s(r.id),
          name: s(r.name),
          invoices: n(r.invoices),
          totalMinor: n(r.total),
          balanceMinor: n(r.balance),
        })),
    );
  }
  outstandingInvoices(asOf: string) {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT i.id, i.number, c.name AS customer, i.issue_date, i.due_date, i.total_minor, i.total_minor - i.amount_paid_minor AS balance,
                  CASE WHEN i.due_date IS NOT NULL AND i.due_date < ? THEN CAST(julianday(?) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS overdue
             FROM invoices i JOIN customers c ON c.id = i.customer_id
            WHERE i.status IN ('ISSUED','PARTIALLY_PAID') ORDER BY i.due_date IS NULL, i.due_date, i.number`,
          [asOf, asOf],
        )
        .map((r) => ({
          invoiceId: s(r.id),
          number: s(r.number),
          customerName: s(r.customer),
          issueDate: s(r.issue_date),
          dueDate: (r.due_date as string | null) ?? null,
          totalMinor: n(r.total_minor),
          balanceMinor: n(r.balance),
          daysOverdue: n(r.overdue),
        })),
    );
  }
  quotationConversion(from: string, to: string) {
    return this.db.read((h) => {
      const c = (status: string) =>
        n(
          h.get<{ v: number }>(
            "SELECT COUNT(*) AS v FROM quotations WHERE status = ? AND created_at >= ? AND created_at <= ?",
            [status, from, to + "T23:59:59.999Z"],
          )?.v,
        );
      return {
        issued: n(
          h.get<{ v: number }>(
            "SELECT COUNT(*) AS v FROM quotations WHERE issued_at IS NOT NULL AND created_at >= ? AND created_at <= ?",
            [from, to + "T23:59:59.999Z"],
          )?.v,
        ),
        accepted: c("ACCEPTED"),
        rejected: c("REJECTED"),
        expired: c("EXPIRED"),
        cancelled: c("CANCELLED"),
      };
    });
  }
  supplierOverview() {
    return this.db.read((h) =>
      h
        .all<Row>(
          `SELECT s.id, s.name,
                  (SELECT COUNT(*) FROM product_suppliers ps WHERE ps.supplier_id = s.id) AS products,
                  (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('CONFIRMED','PARTIALLY_RECEIVED')) AS open_pos
             FROM suppliers s ORDER BY s.name COLLATE NOCASE`,
        )
        .map((r) => ({
          supplierId: s(r.id),
          name: s(r.name),
          products: n(r.products),
          openPurchaseOrders: n(r.open_pos),
        })),
    );
  }
}
