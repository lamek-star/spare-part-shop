"use client";
import Link from "next/link";
import { useSession } from "../../ui/session";
import { useApi, PageHead, Panel, Metrics, Money, Loading, ErrorBanner, Empty, DataTable } from "../../ui/kit";
import { qs } from "../../ui/api";

interface Dash {
  products: number;
  activeProducts: number;
  lowStockProducts: number;
  inventoryValueMinor: number | null;
  openEnquiries: number | null;
  openQuotations: number | null;
  openOrders: number | null;
  outstandingInvoices: number | null;
  outstandingBalanceMinor: number | null;
  salesThisMonthMinor: number | null;
  paymentsThisMonthMinor: number | null;
}
const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));

export default function Dashboard() {
  const s = useSession();
  const d = useApi<Dash>("/reports/dashboard");
  const low = useApi<{ productId: string; sku: string; name: string; available: number; reorderLevel: number }[]>(s.can("reports.inventory") ? "/reports/low-stock" : null);
  const overdue = useApi<{ invoiceId: string; number: string; customerName: string; balanceMinor: number; daysOverdue: number }[]>(s.can("reports.sales") ? "/reports/outstanding-invoices" : null);
  const recent = useApi<{ items: { id: string; number: string; status: string; contactName: string; createdAt: string }[] }>(s.can("enquiries.read") ? `/enquiries${qs({ pageSize: 5, status: "SUBMITTED" })}` : null);
  const first = !d.loading && d.data && d.data.products === 0;
  return (
    <>
      <PageHead title="Business overview" subtitle={`Signed in as ${s.me?.user.displayName} (${s.me?.user.role})`} />
      <ErrorBanner message={d.error} />
      {d.loading && !d.data && <Loading what="Loading overview" />}
      {d.data && (
        <>
          {first && (
            <div className="notice">
              <strong>Your shop is empty.</strong> Start by adding <Link href="/inventory">a warehouse</Link>, then <Link href="/products">your products</Link>
              {s.can("catalogue.import") && (
                <>
                  , or build your <Link href="/catalogue/import">reference catalogue</Link>
                </>
              )}
              .{s.me?.features?.sampleData && <SampleDataButton />}
            </div>
          )}
          <Metrics
            items={[
              { label: "Products", value: n(d.data.products), hint: `${n(d.data.activeProducts)} active` },
              { label: "Low stock", value: n(d.data.lowStockProducts), hint: "at or below reorder level" },
              { label: "Stock value (cost)", value: <Money minor={d.data.inventoryValueMinor} />, hint: d.data.inventoryValueMinor === null ? "Not visible to your role" : undefined },
              { label: "Sales this month", value: <Money minor={d.data.salesThisMonthMinor} /> },
            ]}
          />
          <Metrics
            items={[
              { label: "Open enquiries", value: n(d.data.openEnquiries) },
              { label: "Open quotations", value: n(d.data.openQuotations) },
              { label: "Open orders", value: n(d.data.openOrders) },
              { label: "Outstanding invoices", value: n(d.data.outstandingInvoices), hint: <Money minor={d.data.outstandingBalanceMinor} /> },
            ]}
          />
        </>
      )}
      <div className="dashboard-grid">
        {s.can("enquiries.read") && (
          <Panel title="New enquiries" actions={<Link className="button" href="/enquiries">All enquiries</Link>}>
            {recent.data && (
              <DataTable
                rowKey={(r) => r.id}
                rows={recent.data.items}
                empty="No enquiries waiting."
                columns={[
                  { header: "Number", cell: (r) => <Link href={`/enquiries/${r.id}`}>{r.number}</Link> },
                  { header: "Contact", cell: (r) => r.contactName },
                  { header: "Received", cell: (r) => r.createdAt.slice(0, 10) },
                ]}
              />
            )}
          </Panel>
        )}
        {s.can("reports.inventory") && (
          <Panel title="Needs reordering">
            {low.data && low.data.length === 0 && <Empty>Nothing is below its reorder level.</Empty>}
            {low.data?.slice(0, 8).map((r) => (
              <div className="top-part" key={r.productId}>
                <Link href={`/products/${r.productId}`}>
                  {r.name}
                  <small className="muted" style={{ display: "block" }}>
                    {r.sku}
                  </small>
                </Link>
                <span style={{ marginLeft: "auto" }}>
                  {r.available} <span className="muted">/ {r.reorderLevel}</span>
                </span>
              </div>
            ))}
          </Panel>
        )}
      </div>
      {s.can("reports.sales") && overdue.data && overdue.data.length > 0 && (
        <Panel title="Unpaid invoices" actions={<Link className="button" href="/invoices">Invoices</Link>}>
          <DataTable
            rowKey={(r) => r.invoiceId}
            rows={overdue.data.slice(0, 8)}
            columns={[
              { header: "Invoice", cell: (r) => <Link href={`/invoices/${r.invoiceId}`}>{r.number}</Link> },
              { header: "Customer", cell: (r) => r.customerName },
              { header: "Overdue", cell: (r) => (r.daysOverdue > 0 ? `${r.daysOverdue} days` : "Not yet due") },
              { header: "Balance", align: "right", cell: (r) => <Money minor={r.balanceMinor} /> },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

function SampleDataButton() {
  return (
    <p>
      <button
        onClick={async () => {
          const { post } = await import("../../ui/api");
          await post("/dev/sample-data");
          location.reload();
        }}
      >
        Load sample data (development only)
      </button>
    </p>
  );
}
