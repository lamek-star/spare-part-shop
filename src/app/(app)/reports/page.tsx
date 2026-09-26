"use client";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import { useApi, PageHead, Panel, Loading, ErrorBanner, DataTable, Metrics, Money } from "../../../ui/kit";
import { qs, titleCase } from "../../../ui/api";

const REPORTS: { key: string; label: string; perm: string; ranged?: boolean }[] = [
  { key: "stock-on-hand", label: "Stock on hand", perm: "reports.inventory" },
  { key: "low-stock", label: "Low stock", perm: "reports.inventory" },
  { key: "inventory-valuation", label: "Inventory valuation (cost)", perm: "reports.financial" },
  { key: "sales-by-period", label: "Sales by month", perm: "reports.sales", ranged: true },
  { key: "sales-by-product", label: "Sales by product", perm: "reports.sales", ranged: true },
  { key: "customer-activity", label: "Customer activity", perm: "reports.sales", ranged: true },
  { key: "outstanding-invoices", label: "Outstanding invoices", perm: "reports.sales" },
  { key: "quotation-conversion", label: "Quotation conversion", perm: "reports.sales", ranged: true },
  { key: "supplier-overview", label: "Supplier overview", perm: "suppliers.read" },
];
const isMoney = (k: string) => /Minor$/.test(k);
const heading = (k: string) => titleCase(k.replace(/Minor$/, "").replace(/([A-Z])/g, " $1").trim());

export default function Reports() {
  const s = useSession();
  const available = REPORTS.filter((r) => s.can(r.perm));
  const [key, setKey] = useState(available[0]?.key ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const def = REPORTS.find((r) => r.key === key);
  const query = qs(def?.ranged ? { from, to } : {});
  const r = useApi<unknown>(key ? `/reports/${key}${query}` : null);
  const rows = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : null;
  const headers = rows?.length ? Object.keys(rows[0]).filter((k) => !/Id$/.test(k)) : [];
  return (
    <>
      <PageHead
        title="Reports"
        subtitle="Calculated live from your stock movements, invoices and payments."
        actions={rows && rows.length > 0 ? <a className="button" href={`/api/v1/reports/${key}${qs({ format: "csv", ...(def?.ranged ? { from, to } : {}) })}`}>Export CSV</a> : undefined}
      />
      <div className="toolbar">
        <select aria-label="Report" value={key} onChange={(e) => setKey(e.target.value)}>
          {available.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        {def?.ranged && (
          <>
            <label>
              From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <ErrorBanner message={r.error} />
      {r.loading && <Loading what="Running report" />}
      <Panel title={def?.label}>
        {rows && (
          <DataTable
            rowKey={(row) => JSON.stringify(row)}
            rows={rows}
            empty="No data for this report yet."
            columns={headers.map((h) => ({
              header: heading(h),
              align: typeof rows[0][h] === "number" ? ("right" as const) : undefined,
              cell: (row: Record<string, unknown>) => (isMoney(h) ? <Money minor={row[h] as number} /> : String(row[h] ?? "")),
            }))}
          />
        )}
        {Boolean(r.data) && !rows && (
          <Metrics items={Object.entries(r.data as Record<string, number>).map(([k, v]) => ({ label: heading(k), value: String(v) }))} />
        )}
      </Panel>
    </>
  );
}
