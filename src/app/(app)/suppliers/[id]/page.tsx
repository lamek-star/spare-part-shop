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
import { supplierFields } from "../../../../ui/parties";
import { useT } from "../../../../ui/i18n";

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
export default function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const s = useSession();
  const c = useApi<Supplier>(`/suppliers/${id}`);
  const po = useApi<{
    items: {
      id: string;
      number: string;
      status: string;
      totalMinor: number;
      currency: string;
      createdAt: string;
    }[];
  }>(
    s.can("purchasing.read")
      ? `/purchase-orders?supplierId=${id}&pageSize=10`
      : null,
  );
  const [editing, setEditing] = useState(false);
  if (c.loading && !c.data) return <Loading />;
  if (!c.data)
    return <ErrorBanner message={c.error || t("suppliers.notFound")} />;
  const x = c.data;
  return (
    <>
      <PageHead
        title={x.name}
        subtitle={`${x.code} · ${x.status.toLowerCase()}`}
        back={{ href: "/suppliers", label: t("nav.suppliers") }}
        actions={
          s.can("suppliers.write") && (
            <button onClick={() => setEditing(true)}>
              {t("suppliers.edit")}
            </button>
          )
        }
      />
      <Panel title={t("suppliers.details")}>
        <div className="detail-grid">
          <KeyValues
            items={[
              [t("party.contact"), x.contactPerson],
              [t("party.phone"), x.phone],
              [t("party.email"), x.email],
              [t("party.country"), x.country],
            ]}
          />
          <KeyValues
            items={[
              [t("party.taxNumber"), x.taxNumber],
              [t("party.currency"), x.currency],
              [t("party.paymentTerms"), x.paymentTerms],
              [t("docs.notes"), x.notes],
            ]}
          />
        </div>
      </Panel>
      {po.data && (
        <Panel title={t("suppliers.purchaseOrders")}>
          <DataTable
            rowKey={(d) => d.id}
            rows={po.data.items}
            empty={t("suppliers.noPurchaseOrders")}
            columns={[
              {
                header: t("docs.number"),
                cell: (d) => (
                  <Link href={`/purchasing/${d.id}`}>{d.number}</Link>
                ),
              },
              {
                header: t("invoices.date"),
                cell: (d) => formatDate(d.createdAt),
              },
              {
                header: t("common.status"),
                cell: (d) => <Badge value={d.status} />,
              },
              {
                header: t("doc.total"),
                align: "right",
                cell: (d) => (
                  <Money minor={d.totalMinor} currency={d.currency} />
                ),
              },
            ]}
          />
        </Panel>
      )}
      {editing && (
        <FormModal
          title={t("suppliers.editSupplier")}
          fields={supplierFields}
          initial={x as unknown as Record<string, unknown>}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => (
            await patch(`/suppliers/${id}`, v),
            c.reload()
          )}
        />
      )}
    </>
  );
}
