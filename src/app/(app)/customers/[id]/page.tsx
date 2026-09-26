"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import { Badge, DataTable, ErrorBanner, FormModal, KeyValues, Loading, Money, PageHead, Panel, useApi } from "../../../../ui/kit";
import { formatDate, patch } from "../../../../ui/api";
import { customerFields } from "../../../../ui/parties";

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
export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const c = useApi<Customer>(`/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const q = useApi<{ items: Doc[] }>(s.can("quotations.read") ? `/quotations?customerId=${id}&pageSize=10` : null);
  const o = useApi<{ items: Doc[] }>(s.can("orders.read") ? `/orders?customerId=${id}&pageSize=10` : null);
  const i = useApi<{ items: Doc[] }>(s.can("invoices.read") ? `/invoices?customerId=${id}&pageSize=10` : null);
  const docTable = (rows: Doc[] | undefined, base: string, showBalance = false) =>
    rows && (
      <DataTable
        rowKey={(d) => d.id}
        rows={rows}
        empty="None yet."
        columns={[
          { header: "Number", cell: (d) => <Link href={`${base}/${d.id}`}>{d.number}</Link> },
          { header: "Date", cell: (d) => formatDate(d.createdAt) },
          { header: "Status", cell: (d) => <Badge value={d.status} /> },
          { header: "Total", align: "right", cell: (d) => <Money minor={d.totalMinor} currency={d.currency} /> },
          ...(showBalance ? [{ header: "Balance", align: "right" as const, cell: (d: Doc) => <Money minor={d.balanceMinor} currency={d.currency} /> }] : []),
        ]}
      />
    );
  if (c.loading && !c.data) return <Loading />;
  if (!c.data) return <ErrorBanner message={c.error || "Customer not found."} />;
  const x = c.data;
  return (
    <>
      <PageHead title={x.name} subtitle={`${x.code} · ${x.status.toLowerCase()}`} back={{ href: "/customers", label: "Customers" }} actions={s.can("customers.write") && <button onClick={() => setEditing(true)}>Edit</button>} />
      <Panel title="Details">
        <div className="detail-grid">
          <KeyValues items={[["Contact", x.contactPerson], ["Phone", x.phone], ["Email", x.email], ["Country", x.country], ["Tax number", x.taxNumber]]} />
          <KeyValues items={[["Billing address", x.billingAddress], ["Shipping address", x.shippingAddress], ["Payment terms", x.paymentTerms], ["Credit limit", <Money key="c" minor={x.creditLimitMinor} currency={x.currency} />], ["Notes", x.notes]]} />
        </div>
      </Panel>
      {q.data && <Panel title="Quotations">{docTable(q.data.items, "/quotations")}</Panel>}
      {o.data && <Panel title="Orders">{docTable(o.data.items, "/orders")}</Panel>}
      {i.data && <Panel title="Invoices">{docTable(i.data.items, "/invoices", true)}</Panel>}
      {editing && <FormModal title="Edit customer" fields={customerFields} initial={x as unknown as Record<string, unknown>} onClose={() => setEditing(false)} onSubmit={async (v) => (await patch(`/customers/${id}`, v), c.reload())} />}
    </>
  );
}
