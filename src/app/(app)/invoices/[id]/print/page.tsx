"use client";
import { use } from "react";
import type { DocLine } from "../../../../../ui/doc";
import { ErrorBanner, Loading, useApi } from "../../../../../ui/kit";
import { useT } from "../../../../../ui/i18n";
import {
  PrintDocument,
  type PrintCustomer,
  type PrintShop,
} from "../../../../../ui/printDoc";

interface Invoice {
  number: string;
  status: string;
  customerId: string;
  currency: string;
  taxBp: number;
  issueDate: string;
  dueDate: string | null;
  amountPaidMinor: number;
  balanceMinor: number;
  notes: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: DocLine[];
}

/** The invoice laid out for printing in the person's language (ui/printDoc). */
export default function InvoicePrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const r = useApi<{ invoice: Invoice }>(`/invoices/${id}`);
  const shop = useApi<PrintShop>("/settings");
  const customer = useApi<PrintCustomer>(
    r.data ? `/customers/${r.data.invoice.customerId}` : null,
  );
  if (r.error || shop.error)
    return (
      <ErrorBanner message={r.error || shop.error || t("invoices.notFound")} />
    );
  if (!r.data || !shop.data) return <Loading />;
  const x = r.data.invoice;
  return (
    <PrintDocument
      backHref={`/invoices/${id}`}
      shop={shop.data}
      customer={customer.data}
      doc={{
        kind: "INVOICE",
        number: x.number,
        status: x.status,
        currency: x.currency,
        taxBp: x.taxBp,
        issued: x.issueDate,
        date: x.dueDate,
        lines: x.lines,
        subtotalMinor: x.subtotalMinor,
        taxMinor: x.taxMinor,
        totalMinor: x.totalMinor,
        amountPaidMinor: x.amountPaidMinor,
        balanceMinor: x.balanceMinor,
        notes: x.notes,
      }}
    />
  );
}
