"use client";
import Link from "next/link";
import { DataTable, Money, type Column } from "./kit";

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
  return (
    <DataTable
      rowKey={(l) => l.id}
      rows={lines}
      columns={[
        {
          header: "Item",
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
        { header: "Qty", align: "right", cell: (l) => l.quantity },
        ...extra,
        {
          header: "Unit price",
          align: "right",
          cell: (l) => <Money minor={l.unitPriceMinor} currency={currency} />,
        },
        {
          header: "Disc.",
          align: "right",
          cell: (l) => (l.discountBp ? `${l.discountBp / 100}%` : ""),
        },
        {
          header: "Total",
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
      {line("Subtotal", subtotalMinor)}
      {line(`Tax (${taxBp / 100}%)`, taxMinor)}
      {line("Total", totalMinor, true)}
      {rows.map(([l, m, b]) => line(l, m, b))}
    </div>
  );
}
