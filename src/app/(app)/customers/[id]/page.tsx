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
import { formatDate, patch } from "../../../../ui/api";
import { customerFields } from "../../../../ui/parties";
import { useT } from "../../../../ui/i18n";

interface Customer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  shippingAddress: string;
  country: string;
  taxNumber: string;
  currency: string;
  paymentTerms: string;
  creditLimitMinor: number;
  notes: string;
  status: string;
}
interface Doc {
  id: string;
  number: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  balanceMinor?: number;
}
export default function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const s = useSession();
  const c = useApi<Customer>(`/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const q = useApi<{ items: Doc[] }>(
    s.can("quotations.read")
      ? `/quotations?customerId=${id}&pageSize=10`
      : null,
  );
  const o = useApi<{ items: Doc[] }>(
    s.can("orders.read") ? `/orders?customerId=${id}&pageSize=10` : null,
  );
  const i = useApi<{ items: Doc[] }>(
    s.can("invoices.read") ? `/invoices?customerId=${id}&pageSize=10` : null,
  );
  const docTable = (
    rows: Doc[] | undefined,
    base: string,
    showBalance = false,
  ) =>
    rows && (
      <DataTable
        rowKey={(d) => d.id}
        rows={rows}
        empty={t("customers.noneYet")}
        columns={[
          {
            header: t("docs.number"),
            cell: (d) => <Link href={`${base}/${d.id}`}>{d.number}</Link>,
          },
          { header: t("invoices.date"), cell: (d) => formatDate(d.createdAt) },
          {
            header: t("common.status"),
            cell: (d) => <Badge value={d.status} />,
          },
          {
            header: t("doc.total"),
            align: "right",
            cell: (d) => <Money minor={d.totalMinor} currency={d.currency} />,
          },
          ...(showBalance
            ? [
                {
                  header: t("docs.balance"),
                  align: "right" as const,
                  cell: (d: Doc) => (
                    <Money minor={d.balanceMinor} currency={d.currency} />
                  ),
                },
              ]
            : []),
        ]}
      />
    );
  if (c.loading && !c.data) return <Loading />;
  if (!c.data)
    return <ErrorBanner message={c.error || t("customers.notFound")} />;
  const x = c.data;
  return (
    <>
      <PageHead
        title={x.name}
        subtitle={`${x.code} · ${x.status.toLowerCase()}`}
        back={{ href: "/customers", label: t("nav.customers") }}
        actions={
          s.can("customers.write") && (
            <button onClick={() => setEditing(true)}>
              {t("customers.edit")}
            </button>
          )
        }
      />
      <Panel title={t("customers.details")}>
        <div className="detail-grid">
          <KeyValues
            items={[
              [t("party.contact"), x.contactPerson],
              [t("party.phone"), x.phone],
              [t("party.email"), x.email],
              [t("party.country"), x.country],
              [t("party.taxNumber"), x.taxNumber],
            ]}
          />
          <KeyValues
            items={[
              [t("party.billingAddress"), x.billingAddress],
              [t("party.shippingAddress"), x.shippingAddress],
              [t("party.paymentTerms"), x.paymentTerms],
              [
                t("party.creditLimit"),
                <Money
                  key="c"
                  minor={x.creditLimitMinor}
                  currency={x.currency}
                />,
              ],
              ["Notes", x.notes],
            ]}
          />
        </div>
      </Panel>
      {q.data && (
        <Panel title={t("nav.quotations")}>
          {docTable(q.data.items, "/quotations")}
        </Panel>
      )}
      {o.data && (
        <Panel title={t("nav.orders")}>
          {docTable(o.data.items, "/orders")}
        </Panel>
      )}
      {i.data && (
        <Panel title={t("customers.invoices")}>
          {docTable(i.data.items, "/invoices", true)}
        </Panel>
      )}
      {editing && (
        <FormModal
          title={t("customers.editCustomer")}
          fields={customerFields}
          initial={x as unknown as Record<string, unknown>}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => (
            await patch(`/customers/${id}`, v),
            c.reload()
          )}
        />
      )}
    </>
  );
}
