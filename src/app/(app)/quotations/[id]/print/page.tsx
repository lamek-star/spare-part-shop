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

interface Quotation {
  number: string;
  status: string;
  customerId: string;
  currency: string;
  taxBp: number;
  validUntil: string | null;
  issuedAt: string | null;
  notes: string;
  terms: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: DocLine[];
}

/** The quotation laid out for printing in the person's language (ui/printDoc). */
export default function QuotationPrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const q = useApi<Quotation>(`/quotations/${id}`);
  const shop = useApi<PrintShop>("/settings");
  const customer = useApi<PrintCustomer>(
    q.data ? `/customers/${q.data.customerId}` : null,
  );
  if (q.error || shop.error)
    return (
      <ErrorBanner
        message={q.error || shop.error || t("quotations.notFound")}
      />
    );
  if (!q.data || !shop.data) return <Loading />;
  const x = q.data;
  return (
    <PrintDocument
      backHref={`/quotations/${id}`}
      shop={shop.data}
      customer={customer.data}
      doc={{
        kind: "QUOTATION",
        number: x.number,
        status: x.status,
        currency: x.currency,
        taxBp: x.taxBp,
        issued: x.issuedAt,
        date: x.validUntil,
        lines: x.lines,
        subtotalMinor: x.subtotalMinor,
        taxMinor: x.taxMinor,
        totalMinor: x.totalMinor,
        notes: x.notes,
        terms: x.terms,
      }}
    />
  );
}
