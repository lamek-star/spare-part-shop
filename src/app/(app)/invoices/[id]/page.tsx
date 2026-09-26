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
} from "../../../../ui/kit";
import {
  formatDate,
  formatDateTime,
  minorToInput,
  post,
  titleCase,
} from "../../../../ui/api";
import { DocLines, TotalsBox, type DocLine } from "../../../../ui/doc";

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
  const r = useApi<{ invoice: Invoice; payments: Payment[] }>(
    `/invoices/${id}`,
  );
  const customer = useApi<{ name: string }>(
    r.data ? `/customers/${r.data.invoice.customerId}` : null,
  );
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  if (r.loading && !r.data) return <Loading />;
  if (!r.data) return <ErrorBanner message={r.error || "Invoice not found."} />;
  const { invoice: x, payments } = r.data;
  const open = x.status === "ISSUED" || x.status === "PARTIALLY_PAID";
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={
          <>
            <Badge value={x.status} /> · due {formatDate(x.dueDate)}
          </>
        }
        back={{ href: "/invoices", label: "Invoices" }}
        actions={
          <>
            <a
              className="button"
              href={`/api/v1/invoices/${id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
            {s.can("payments.record") && open && (
              <button className="primary" onClick={() => setPaying(true)}>
                Record payment
              </button>
            )}
            {s.can("invoices.write") &&
              x.status !== "VOID" &&
              x.amountPaidMinor === 0 && (
                <button className="danger" onClick={() => setVoiding(true)}>
                  Void
                </button>
              )}
          </>
        }
      />
      <Panel title="Invoice">
        <KeyValues
          items={[
            [
              "Customer",
              customer.data ? (
                <Link key="c" href={`/customers/${x.customerId}`}>
                  {customer.data.name}
                </Link>
              ) : (
                ""
              ),
            ],
            [
              "Order",
              x.salesOrderId ? (
                <Link key="o" href={`/orders/${x.salesOrderId}`}>
                  Open order
                </Link>
              ) : (
                ""
              ),
            ],
            ["Issued", formatDate(x.issueDate)],
            ["Notes", x.notes],
          ]}
        />
      </Panel>
      <Panel title="Items">
        <DocLines lines={x.lines} currency={x.currency} />
        <TotalsBox
          subtotalMinor={x.subtotalMinor}
          taxMinor={x.taxMinor}
          totalMinor={x.totalMinor}
          taxBp={x.taxBp}
          currency={x.currency}
          rows={[
            ["Paid", x.amountPaidMinor],
            ["Balance due", x.balanceMinor, true],
          ]}
        />
      </Panel>
      <Panel title="Payments">
        <DataTable
          rowKey={(p) => p.id}
          rows={payments}
          empty="No payments recorded yet."
          columns={[
            { header: "Date", cell: (p) => formatDateTime(p.paidAt) },
            { header: "Method", cell: (p) => titleCase(p.method) },
            { header: "Reference", cell: (p) => p.reference },
            {
              header: "Amount",
              align: "right",
              cell: (p) => (
                <Money minor={p.amountMinor} currency={x.currency} />
              ),
            },
          ]}
        />
        <p className="muted">
          Payments are permanent records. To correct a mistake, contact an
          administrator.
        </p>
      </Panel>
      {paying && (
        <FormModal
          title="Record payment"
          submitLabel="Record payment"
          initial={{ amountMinor: x.balanceMinor, method: "CASH" }}
          fields={[
            {
              name: "amountMinor",
              label: `Amount (balance ${minorToInput(x.balanceMinor)})`,
              type: "money",
              required: true,
            },
            {
              name: "method",
              label: "Method",
              type: "select",
              options: ["CASH", "BANK_TRANSFER", "CARD", "OTHER"].map((m) => ({
                value: m,
                label: titleCase(m),
              })),
            },
            {
              name: "reference",
              label: "Reference (receipt / transfer no.)",
              optional: true,
            },
            { name: "notes", label: "Notes", type: "textarea", optional: true },
          ]}
          onClose={() => setPaying(false)}
          onSubmit={async (v) => {
            await post(`/invoices/${id}/payments`, v);
            r.reload();
          }}
        />
      )}
      {voiding && (
        <FormModal
          title="Void invoice"
          submitLabel="Void invoice"
          fields={[
            {
              name: "reason",
              label: "Reason",
              type: "textarea",
              required: true,
              help: "The delivered goods become billable again on the order.",
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
