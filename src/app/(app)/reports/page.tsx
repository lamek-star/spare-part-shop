"use client";
import { useState } from "react";
import { useSession } from "../../../ui/session";
import {
  useApi,
  PageHead,
  Panel,
  Loading,
  ErrorBanner,
  DataTable,
  Metrics,
  Money,
} from "../../../ui/kit";
import { qs, titleCase } from "../../../ui/api";
import { apiUrl } from "@/lib/basePath";
import { useT, type Translate } from "../../../ui/i18n";
import { en } from "../../../ui/messages/en";
import type { MessageKey } from "../../../ui/messages";

const REPORTS: {
  key: string;
  /** Message key (ui/messages). */
  label: MessageKey;
  perm: string;
  ranged?: boolean;
  pharmacyOnly?: boolean;
}[] = [
  {
    key: "daily-sales",
    label: "rep.dailySalesBookAccountant",
    perm: "reports.financial",
    ranged: true,
  },
  {
    key: "batch-valuation",
    label: "rep.stockValueByBatchAnd",
    perm: "reports.financial",
  },
  {
    key: "expired-write-offs",
    label: "rep.expiredStockWrittenOffLoss",
    perm: "reports.financial",
    ranged: true,
  },
  {
    key: "prescription-register",
    label: "rep.prescriptionRegister",
    perm: "reports.sales",
    ranged: true,
    pharmacyOnly: true,
  },
  {
    key: "stock-on-hand",
    label: "stock.stockOnHand",
    perm: "reports.inventory",
  },
  { key: "low-stock", label: "dash.lowStock", perm: "reports.inventory" },
  {
    key: "inventory-valuation",
    label: "rep.inventoryValuationCost",
    perm: "reports.financial",
  },
  {
    key: "sales-by-period",
    label: "rep.salesByMonth",
    perm: "reports.sales",
    ranged: true,
  },
  {
    key: "sales-by-product",
    label: "rep.salesByProduct",
    perm: "reports.sales",
    ranged: true,
  },
  {
    key: "customer-activity",
    label: "rep.customerActivity",
    perm: "reports.sales",
    ranged: true,
  },
  {
    key: "outstanding-invoices",
    label: "dash.outstandingInvoices",
    perm: "reports.sales",
  },
  {
    key: "quotation-conversion",
    label: "rep.quotationConversion",
    perm: "reports.sales",
    ranged: true,
  },
  {
    key: "supplier-overview",
    label: "rep.supplierOverview",
    perm: "suppliers.read",
  },
];
const isMoney = (k: string) => /Minor$/.test(k);
/** A report column's name: col.<field> in the person's language, else the field name in Title Case. */
const heading = (k: string, t: Translate) => {
  const base = k.replace(/Minor$/, "");
  const key = `col.${base}`;
  if (key in en) return t(key as MessageKey);
  return titleCase(base.replace(/([A-Z])/g, " $1").trim());
};

export default function Reports() {
  const t = useT();
  const s = useSession();
  const available = REPORTS.filter(
    (r) => s.can(r.perm) && (!r.pharmacyOnly || s.edition === "pharmacy"),
  );
  // Report rows carry amounts only; they are in the shop's currency.
  const settings = useApi<{ currency: string }>("/settings");
  const currency = settings.data?.currency;
  const [key, setKey] = useState(available[0]?.key ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const def = REPORTS.find((r) => r.key === key);
  const query = qs(def?.ranged ? { from, to } : {});
  const r = useApi<unknown>(key ? `/reports/${key}${query}` : null);
  const rows = Array.isArray(r.data)
    ? (r.data as Record<string, unknown>[])
    : null;
  const headers = rows?.length
    ? Object.keys(rows[0]).filter((k) => !/Id$/.test(k))
    : [];
  return (
    <>
      <PageHead
        title={t("nav.reports")}
        subtitle={t("rep.calculatedLiveFromYourStock")}
        actions={
          rows && rows.length > 0 ? (
            <a
              className="button"
              href={apiUrl(
                `/reports/${key}${qs({ format: "csv", ...(def?.ranged ? { from, to } : {}) })}`,
              )}
            >
              {t("rep.exportCsv")}
            </a>
          ) : undefined
        }
      />
      <div className="toolbar">
        <select
          aria-label={t("rep.report")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {available.map((x) => (
            <option key={x.key} value={x.key}>
              {t(x.label)}
            </option>
          ))}
        </select>
        {def?.ranged && (
          <>
            <label>
              From{" "}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To{" "}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <ErrorBanner message={r.error} />
      {r.loading && <Loading what={t("rep.runningReport")} />}
      <Panel title={def ? t(def.label) : undefined}>
        {rows && (
          <DataTable
            rowKey={(row) => JSON.stringify(row)}
            rows={rows}
            empty={t("rep.noDataForThisReport")}
            columns={headers.map((h) => ({
              header: heading(h, t),
              align:
                typeof rows[0][h] === "number" ? ("right" as const) : undefined,
              cell: (row: Record<string, unknown>) =>
                isMoney(h) ? (
                  <Money minor={row[h] as number} currency={currency} />
                ) : typeof row[h] === "boolean" ? (
                  row[h] ? (
                    "Yes"
                  ) : (
                    "No"
                  )
                ) : (
                  String(row[h] ?? "")
                ),
            }))}
          />
        )}
        {Boolean(r.data) && !rows && (
          <Metrics
            items={Object.entries(r.data as Record<string, number>).map(
              ([k, v]) => ({ label: heading(k, t), value: String(v) }),
            )}
          />
        )}
      </Panel>
    </>
  );
}
