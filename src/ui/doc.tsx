"use client";
import Link from "next/link";
import { DataTable, Money, type Column } from "./kit";
import { useT } from "./i18n";

export interface DocLine {
  id: string;
  productId: string | null;
  sku: string;
  oemNumber: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountBp: number;
  lineTotalMinor: number;
}
export function DocLines<T extends DocLine>({
  lines,
  currency,
  extra = [],
}: {
  lines: T[];
  currency: string;
  extra?: Column<T>[];
}) {
  const t = useT();
  return (
    <DataTable
      rowKey={(l) => l.id}
      rows={lines}
      columns={[
        {
          header: t("doc.item"),
          cell: (l) => (
            <div>
              {l.productId ? (
                <Link href={`/products/${l.productId}`}>{l.description}</Link>
              ) : (
                l.description
              )}
              <small className="muted" style={{ display: "block" }}>
                {[l.sku, l.oemNumber].filter(Boolean).join(" · ")}
              </small>
            </div>
          ),
        },
        { header: t("doc.qty"), align: "right", cell: (l) => l.quantity },
        ...extra,
        {
          header: t("doc.unitPrice"),
          align: "right",
          cell: (l) => <Money minor={l.unitPriceMinor} currency={currency} />,
        },
        {
          header: t("doc.discount"),
          align: "right",
          cell: (l) => (l.discountBp ? `${l.discountBp / 100}%` : ""),
        },
        {
          header: t("doc.total"),
          align: "right",
          cell: (l) => <Money minor={l.lineTotalMinor} currency={currency} />,
        },
      ]}
    />
  );
}
export function TotalsBox({
  subtotalMinor,
  taxMinor,
  totalMinor,
  taxBp,
  currency,
  rows = [],
}: {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxBp: number;
  currency: string;
  rows?: [string, number, boolean?][];
}) {
  const t = useT();
  const line = (label: string, minor: number, bold?: boolean) => (
    <div
      key={label}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 24,
        fontWeight: bold ? 700 : 400,
        padding: "3px 0",
      }}
    >
      <span>{label}</span>
      <Money minor={minor} currency={currency} />
    </div>
  );
  return (
    <div className="totals">
      {line(t("doc.subtotal"), subtotalMinor)}
      {line(t("doc.tax", { rate: taxBp / 100 }), taxMinor)}
      {line(t("doc.total"), totalMinor, true)}
      {rows.map(([l, m, b]) => line(l, m, b))}
    </div>
  );
}
