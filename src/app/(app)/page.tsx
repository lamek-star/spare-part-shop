"use client";
import Link from "next/link";
import { useSession } from "../../ui/session";
import {
  useApi,
  PageHead,
  Panel,
  Metrics,
  Money,
  Loading,
  ErrorBanner,
  Empty,
  DataTable,
} from "../../ui/kit";
import { qs } from "../../ui/api";
import { useT } from "../../ui/i18n";
import { StockStatusPanel } from "../../ui/stockStatus";
import type { MessageKey } from "../../ui/messages";

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
  const t = useT();
  const s = useSession();
  const d = useApi<Dash>("/reports/dashboard");
  const overdue = useApi<
    {
      invoiceId: string;
      number: string;
      customerName: string;
      balanceMinor: number;
      daysOverdue: number;
    }[]
  >(s.can("reports.sales") ? "/reports/outstanding-invoices" : null);
  const recent = useApi<{
    items: {
      id: string;
      number: string;
      status: string;
      contactName: string;
      createdAt: string;
    }[];
  }>(
    s.can("enquiries.read")
      ? `/enquiries${qs({ pageSize: 5, status: "SUBMITTED" })}`
      : null,
  );
  const first = !d.loading && d.data && d.data.products === 0;
  return (
    <>
      <PageHead
        title={t("dash.businessOverview")}
        subtitle={t("dash.signedInAs", {
          name: s.me?.user.displayName ?? "",
          role: s.me ? t(`role.${s.me.user.role}` as MessageKey) : "",
        })}
      />
      <ErrorBanner message={d.error} />
      {d.loading && !d.data && <Loading what={t("dash.loadingOverview")} />}
      {d.data && (
        <>
          {first && (
            <div className="notice">
              <strong>{t("dash.yourShopIsEmpty")}</strong> {t("dash.startHere")}{" "}
              <Link href="/inventory">{t("dash.addWarehouse")}</Link> ·{" "}
              <Link href="/products">{t("dash.addProducts")}</Link>
              {s.can("catalogue.import") && (
                <>
                  {" "}
                  ·{" "}
                  <Link href="/catalogue/import">
                    {t("dash.buildCatalogue")}
                  </Link>
                </>
              )}
              {s.me?.features?.sampleData && <SampleDataButton />}
            </div>
          )}
          <Metrics
            items={[
              {
                label: t("dash.products"),
                value: n(d.data.products),
                hint: `${n(d.data.activeProducts)} active`,
              },
              {
                label: t("dash.lowStock"),
                value: n(d.data.lowStockProducts),
                hint: t("dash.atOrBelowReorder"),
              },
              {
                label: t("dash.stockValueCost"),
                value: <Money minor={d.data.inventoryValueMinor} />,
                hint:
                  d.data.inventoryValueMinor === null
                    ? t("dash.notVisible")
                    : undefined,
              },
              {
                label: t("dash.salesThisMonth"),
                value: <Money minor={d.data.salesThisMonthMinor} />,
              },
            ]}
          />
          <Metrics
            items={[
              {
                label: t("dash.openEnquiries"),
                value: n(d.data.openEnquiries),
              },
              {
                label: t("dash.openQuotations"),
                value: n(d.data.openQuotations),
              },
              { label: t("dash.openOrders"), value: n(d.data.openOrders) },
              {
                label: t("dash.outstandingInvoices"),
                value: n(d.data.outstandingInvoices),
                hint: <Money minor={d.data.outstandingBalanceMinor} />,
              },
            ]}
          />
        </>
      )}
      {s.can("reports.inventory") && <StockStatusPanel />}
      <div>
        {s.can("enquiries.read") && (
          <Panel
            title={t("dash.newEnquiries")}
            actions={
              <Link className="button" href="/enquiries">
                {t("dash.allEnquiries")}
              </Link>
            }
          >
            {recent.data && (
              <DataTable
                rowKey={(r) => r.id}
                rows={recent.data.items}
                empty={t("dash.noEnquiriesWaiting")}
                columns={[
                  {
                    header: t("docs.number"),
                    cell: (r) => (
                      <Link href={`/enquiries/${r.id}`}>{r.number}</Link>
                    ),
                  },
                  { header: t("dash.contact"), cell: (r) => r.contactName },
                  {
                    header: t("status.RECEIVED"),
                    cell: (r) => r.createdAt.slice(0, 10),
                  },
                ]}
              />
            )}
          </Panel>
        )}
      </div>
      {s.can("reports.sales") && overdue.data && overdue.data.length > 0 && (
        <Panel
          title={t("dash.unpaidInvoices")}
          actions={
            <Link className="button" href="/invoices">
              {t("dash.invoices")}
            </Link>
          }
        >
          <DataTable
            rowKey={(r) => r.invoiceId}
            rows={overdue.data.slice(0, 8)}
            columns={[
              {
                header: t("invoices.invoice"),
                cell: (r) => (
                  <Link href={`/invoices/${r.invoiceId}`}>{r.number}</Link>
                ),
              },
              { header: t("docs.customer"), cell: (r) => r.customerName },
              {
                header: t("dash.overdue"),
                cell: (r) =>
                  r.daysOverdue > 0
                    ? t("dash.days", { count: r.daysOverdue })
                    : t("dash.notYetDue"),
              },
              {
                header: t("docs.balance"),
                align: "right",
                cell: (r) => <Money minor={r.balanceMinor} />,
              },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

function SampleDataButton() {
  const t = useT();
  return (
    <p>
      <button
        onClick={async () => {
          const { post } = await import("../../ui/api");
          await post("/dev/sample-data");
          location.reload();
        }}
      >
        {t("dash.loadSampleDataDevelopmentOnly")}
      </button>
    </p>
  );
}
