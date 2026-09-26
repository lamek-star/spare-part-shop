import type { UnitOfWork } from "../providers/uow";
import type { DashboardMetrics } from "../providers/sales";
import type { Actor } from "./types";
import { can, requirePermission } from "./permissions";
import { isoDate } from "./validate";

const today = () => new Date().toISOString().slice(0, 10);
const range = (from: unknown, to: unknown) => {
  const end = isoDate(to, "To") ?? today();
  const d = new Date(end + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 365);
  return {
    from: isoDate(from, "From") ?? d.toISOString().slice(0, 10),
    to: end,
  };
};

/** Every report reads persisted rows; each is gated by its own permission
 * so a role never sees figures (cost, sales, balances) it may not. */
export class ReportService {
  constructor(private readonly uow: UnitOfWork) {}

  async dashboard(actor: Actor): Promise<DashboardMetrics> {
    const m = await this.uow.read((r) => r.reports.dashboard());
    const sales =
      can(actor, "reports.sales") || can(actor, "reports.financial");
    return {
      ...m,
      inventoryValueMinor: can(actor, "reports.financial")
        ? m.inventoryValueMinor
        : null,
      openEnquiries: can(actor, "enquiries.read") ? m.openEnquiries : null,
      openQuotations: can(actor, "quotations.read") ? m.openQuotations : null,
      openOrders: can(actor, "orders.read") ? m.openOrders : null,
      outstandingInvoices: can(actor, "invoices.read")
        ? m.outstandingInvoices
        : null,
      outstandingBalanceMinor: can(actor, "invoices.read")
        ? m.outstandingBalanceMinor
        : null,
      salesThisMonthMinor: sales ? m.salesThisMonthMinor : null,
      paymentsThisMonthMinor: sales ? m.paymentsThisMonthMinor : null,
    };
  }
  async productSales(actor: Actor, productId: string) {
    requirePermission(actor, "invoices.read");
    return this.uow.read((r) => r.reports.productSales(productId, 20));
  }
  async inventoryValuation(actor: Actor) {
    requirePermission(actor, "reports.financial");
    return this.uow.read((r) => r.reports.inventoryValuation());
  }
  async stockOnHand(actor: Actor) {
    requirePermission(actor, "reports.inventory");
    return this.uow.read((r) => r.reports.stockOnHand());
  }
  async lowStock(actor: Actor) {
    requirePermission(actor, "reports.inventory");
    return this.uow.read((r) => r.reports.lowStock());
  }
  async salesByPeriod(actor: Actor, q: { from?: unknown; to?: unknown }) {
    requirePermission(actor, "reports.sales");
    const { from, to } = range(q.from, q.to);
    return this.uow.read((r) => r.reports.salesByPeriod(from, to));
  }
  async salesByProduct(actor: Actor, q: { from?: unknown; to?: unknown }) {
    requirePermission(actor, "reports.sales");
    const { from, to } = range(q.from, q.to);
    return this.uow.read((r) => r.reports.salesByProduct(from, to));
  }
  async customerActivity(actor: Actor, q: { from?: unknown; to?: unknown }) {
    requirePermission(actor, "reports.sales");
    const { from, to } = range(q.from, q.to);
    return this.uow.read((r) => r.reports.customerActivity(from, to));
  }
  async outstandingInvoices(actor: Actor) {
    requirePermission(actor, "reports.sales");
    return this.uow.read((r) => r.reports.outstandingInvoices(today()));
  }
  async quotationConversion(actor: Actor, q: { from?: unknown; to?: unknown }) {
    requirePermission(actor, "reports.sales");
    const { from, to } = range(q.from, q.to);
    return this.uow.read((r) => r.reports.quotationConversion(from, to));
  }
  async supplierOverview(actor: Actor) {
    requirePermission(actor, "suppliers.read");
    return this.uow.read((r) => r.reports.supplierOverview());
  }
}
