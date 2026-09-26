"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import { Badge, DataTable, ErrorBanner, FormModal, KeyValues, Loading, Money, PageHead, Panel, useApi } from "../../../../ui/kit";
import { formatDate, patch } from "../../../../ui/api";
import { supplierFields } from "../../../../ui/parties";

interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  country: string;
  taxNumber: string;
  currency: string;
  paymentTerms: string;
  notes: string;
  status: string;
}
export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const c = useApi<Supplier>(`/suppliers/${id}`);
  const po = useApi<{ items: { id: string; number: string; status: string; totalMinor: number; currency: string; createdAt: string }[] }>(s.can("purchasing.read") ? `/purchase-orders?supplierId=${id}&pageSize=10` : null);
  const [editing, setEditing] = useState(false);
  if (c.loading && !c.data) return <Loading />;
  if (!c.data) return <ErrorBanner message={c.error || "Supplier not found."} />;
  const x = c.data;
  return (
    <>
      <PageHead title={x.name} subtitle={`${x.code} · ${x.status.toLowerCase()}`} back={{ href: "/suppliers", label: "Suppliers" }} actions={s.can("suppliers.write") && <button onClick={() => setEditing(true)}>Edit</button>} />
      <Panel title="Details">
        <div className="detail-grid">
          <KeyValues items={[["Contact", x.contactPerson], ["Phone", x.phone], ["Email", x.email], ["Country", x.country]]} />
          <KeyValues items={[["Tax number", x.taxNumber], ["Currency", x.currency], ["Payment terms", x.paymentTerms], ["Notes", x.notes]]} />
        </div>
      </Panel>
      {po.data && (
        <Panel title="Purchase orders">
          <DataTable
            rowKey={(d) => d.id}
            rows={po.data.items}
            empty="No purchase orders."
            columns={[
              { header: "Number", cell: (d) => <Link href={`/purchasing/${d.id}`}>{d.number}</Link> },
              { header: "Date", cell: (d) => formatDate(d.createdAt) },
              { header: "Status", cell: (d) => <Badge value={d.status} /> },
              { header: "Total", align: "right", cell: (d) => <Money minor={d.totalMinor} currency={d.currency} /> },
            ]}
          />
        </Panel>
      )}
      {editing && <FormModal title="Edit supplier" fields={supplierFields} initial={x as unknown as Record<string, unknown>} onClose={() => setEditing(false)} onSubmit={async (v) => (await patch(`/suppliers/${id}`, v), c.reload())} />}
    </>
  );
}
