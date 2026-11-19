"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import {
  Badge,
  DataTable,
  ErrorBanner,
  FormModal,
  KeyValues,
  Loading,
  Money,
  PageHead,
  Panel,
  useApi,
  useMethodLabel,
} from "../../../../ui/kit";
import {
  formatDate,
  formatDateTime,
  minorToInput,
  post,
  titleCase,
} from "../../../../ui/api";
import { DocLines, TotalsBox, type DocLine } from "../../../../ui/doc";
import { PayWithPay } from "../../../../ui/payWithPay";
import { apiUrl } from "@/lib/basePath";
import { useT } from "../../../../ui/i18n";

interface Invoice {
  id: string;
  number: string;
  status: string;
  salesOrderId: string | null;
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
interface Payment {
  id: string;
  amountMinor: number;
  method: string;
  reference: string;
  paidAt: string;
  notes: string;
}
export default function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const s = useSession();
  const t = useT();
  const methodLabel = useMethodLabel();
  const r = useApi<{ invoice: Invoice; payments: Payment[] }>(
    `/invoices/${id}`,
  );
  const customer = useApi<{ name: string }>(
    r.data ? `/customers/${r.data.invoice.customerId}` : null,
  );
  // IntraForge Pay in the same shop (platform mode): offered when available.
  const payInfo = useApi<{ available: boolean }>(`/invoices/${id}/pay`);
  const [paying, setPaying] = useState(false);
  const [payingWithPay, setPayingWithPay] = useState(false);
  const [voiding, setVoiding] = useState(false);
  if (r.loading && !r.data) return <Loading />;
  if (!r.data)
    return <ErrorBanner message={r.error || t("invoices.notFound")} />;
  const { invoice: x, payments } = r.data;
  const open = x.status === "ISSUED" || x.status === "PARTIALLY_PAID";
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={
          <>
            <Badge value={x.status} /> ·{" "}
            {t("invoices.dueOn", { date: formatDate(x.dueDate) })}
          </>
        }
        back={{ href: "/invoices", label: t("invoices.title") }}
        actions={
          <>
            <Link className="button" href={`/invoices/${id}/print`}>
              {t("docs.print")}
            </Link>
            <a
              className="button"
              href={apiUrl(`/invoices/${id}/pdf`)}
              target="_blank"
              rel="noreferrer"
            >
              {t("docs.downloadPdf")}
            </a>
            {s.can("payments.record") && open && payInfo.data?.available && (
              <button
                className="primary"
                onClick={() => setPayingWithPay(true)}
              >
                {t("pay.title")}
              </button>
            )}
            {s.can("payments.record") && open && (
              <button className="primary" onClick={() => setPaying(true)}>
                {t("invoices.recordPayment")}
              </button>
            )}
            {s.can("invoices.write") &&
              x.status !== "VOID" &&
              x.amountPaidMinor === 0 && (
                <button className="danger" onClick={() => setVoiding(true)}>
                  {t("invoices.void")}
                </button>
              )}
          </>
        }
      />
      <Panel title={t("invoices.invoice")}>
        <KeyValues
          items={[
            [
              t("docs.customer"),
              customer.data ? (
                <Link key="c" href={`/customers/${x.customerId}`}>
                  {customer.data.name}
                </Link>
              ) : (
                ""
              ),
            ],
            [
              t("invoices.order"),
              x.salesOrderId ? (
                <Link key="o" href={`/orders/${x.salesOrderId}`}>
                  {t("invoices.openOrder")}
                </Link>
              ) : (
                ""
              ),
            ],
            [t("docs.issued"), formatDate(x.issueDate)],
            [t("docs.notes"), x.notes],
          ]}
        />
      </Panel>
      <Panel title={t("docs.items")}>
        <DocLines lines={x.lines} currency={x.currency} />
        <TotalsBox
          subtotalMinor={x.subtotalMinor}
          taxMinor={x.taxMinor}
          totalMinor={x.totalMinor}
          taxBp={x.taxBp}
          currency={x.currency}
          rows={[
            [t("invoices.paid"), x.amountPaidMinor],
            [t("invoices.balanceDue"), x.balanceMinor, true],
          ]}
        />
      </Panel>
      <Panel title={t("invoices.payments")}>
        <DataTable
          rowKey={(p) => p.id}
          rows={payments}
          empty={t("invoices.noPayments")}
          columns={[
            {
              header: t("invoices.date"),
              cell: (p) => formatDateTime(p.paidAt),
            },
            {
              header: t("invoices.method"),
              cell: (p) => methodLabel(p.method),
            },
            { header: t("invoices.reference"), cell: (p) => p.reference },
            {
              header: t("invoices.amount"),
              align: "right",
              cell: (p) => (
                <Money minor={p.amountMinor} currency={x.currency} />
              ),
            },
          ]}
        />
        <p className="muted">{t("invoices.paymentsPermanent")}</p>
      </Panel>
      {paying && (
        <FormModal
          title={t("invoices.recordPayment")}
          submitLabel={t("invoices.recordPayment")}
          initial={{ amountMinor: x.balanceMinor, method: "CASH" }}
          fields={[
            {
              name: "amountMinor",
              label: t("invoices.amountBalance", {
                balance: minorToInput(x.balanceMinor),
              }),
              type: "money",
              required: true,
            },
            {
              name: "method",
              label: t("invoices.method"),
              type: "select",
              options: ["CASH", "BANK_TRANSFER", "CARD", "OTHER"].map((m) => ({
                value: m,
                label: methodLabel(m),
              })),
            },
            {
              name: "reference",
              label: t("invoices.referenceHelp"),
              optional: true,
            },
            {
              name: "notes",
              label: t("docs.notes"),
              type: "textarea",
              optional: true,
            },
          ]}
          onClose={() => setPaying(false)}
          onSubmit={async (v) => {
            await post(`/invoices/${id}/payments`, v);
            r.reload();
          }}
        />
      )}
      {payingWithPay && (
        <PayWithPay
          invoiceId={id}
          currency={x.currency}
          onPaid={r.reload}
          onClose={() => {
            setPayingWithPay(false);
            r.reload();
          }}
        />
      )}
      {voiding && (
        <FormModal
          title={t("invoices.voidInvoice")}
          submitLabel={t("invoices.voidInvoice")}
          fields={[
            {
              name: "reason",
              label: t("orders.reason"),
              type: "textarea",
              required: true,
              help: t("invoices.voidHelp"),
            },
          ]}
          onClose={() => setVoiding(false)}
          onSubmit={async (v) => {
            await post(`/invoices/${id}/void`, v);
            r.reload();
          }}
        />
      )}
    </>
  );
}
