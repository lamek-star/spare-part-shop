"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Empty,
  ErrorBanner,
  FieldBox,
  Loading,
  PageHead,
  Panel,
  DataTable,
  useAction,
  useApi,
  useToast,
} from "../../../../ui/kit";
import { del, post } from "../../../../ui/api";
import { useT } from "../../../../ui/i18n";

interface Item {
  id: string;
  oemNumber: string;
  partName: string;
  vehicleDescription: string;
  quantity: number;
  referencePartId: string | null;
}
interface Enquiry {
  id: string;
  items: Item[];
}
interface Customer {
  id: string;
  name: string;
}
export default function EnquiryCart() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const cart = useApi<Enquiry | null>("/enquiries/current");
  const customers = useApi<{ items: Customer[] }>(
    "/customers?pageSize=100&status=ACTIVE",
  );
  const act = useAction(cart.reload);
  const [form, setForm] = useState({
    customerId: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    vin: "",
    notes: "",
  });
  const set =
    (k: keyof typeof form) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const items = cart.data?.items ?? [];
  return (
    <>
      <PageHead
        title={t("enq.enquiryCart")}
        subtitle={t("enq.partsCollectedForOneCustomer")}
        back={{ href: "/enquiries", label: t("nav.enquiries") }}
      />
      <ErrorBanner message={cart.error || act.error} />
      {cart.loading && !cart.data && <Loading />}
      <Panel title={`Items (${items.length})`}>
        <DataTable
          rowKey={(i) => i.id}
          rows={items}
          empty={t("enq.theCartIsEmptyFind")}
          columns={[
            {
              header: t("enq.partNumber"),
              cell: (i) =>
                i.referencePartId ? (
                  <Link href={`/catalogue/parts/${i.referencePartId}`}>
                    {i.oemNumber}
                  </Link>
                ) : (
                  i.oemNumber
                ),
            },
            { header: t("lines.description"), cell: (i) => i.partName },
            { header: t("enq.vehicle"), cell: (i) => i.vehicleDescription },
            { header: t("doc.qty"), align: "right", cell: (i) => i.quantity },
            {
              header: "",
              cell: (i) => (
                <button
                  onClick={() =>
                    act.run(
                      () => del(`/enquiries/${cart.data!.id}/items/${i.id}`),
                      "Removed",
                    )
                  }
                >
                  {t("prod.remove")}
                </button>
              ),
            },
          ]}
        />
      </Panel>
      {items.length > 0 && (
        <Panel title={t("enq.submitEnquiry")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await act.run(() =>
                post<{ id: string }>(`/enquiries/${cart.data!.id}/submit`, {
                  ...form,
                  customerId: form.customerId || undefined,
                }),
              );
              if (done) {
                toast("Enquiry submitted");
                router.push(`/enquiries/${done.id}`);
              }
            }}
          >
            <div className="form-grid">
              <FieldBox label={t("enq.existingCustomerOptional")}>
                <select value={form.customerId} onChange={set("customerId")}>
                  <option value="">{t("enq.notLinkedToACustomer")}</option>
                  {customers.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FieldBox>
              <FieldBox label={t("enq.contactName")}>
                <input
                  value={form.contactName}
                  onChange={set("contactName")}
                  required
                />
              </FieldBox>
              <FieldBox label={t("auth.email")}>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={set("contactEmail")}
                />
              </FieldBox>
              <FieldBox label={t("settings.phone")}>
                <input
                  value={form.contactPhone}
                  onChange={set("contactPhone")}
                />
              </FieldBox>
              <FieldBox label={t("enq.vinChassisNumber")}>
                <input value={form.vin} onChange={set("vin")} />
              </FieldBox>
              <FieldBox label={t("docs.notes")}>
                <textarea rows={2} value={form.notes} onChange={set("notes")} />
              </FieldBox>
            </div>
            <div className="form-actions">
              <button className="primary" disabled={act.busy}>
                {t("enq.submitEnquiry")}
              </button>
            </div>
          </form>
        </Panel>
      )}
      {!cart.loading && items.length === 0 && (
        <Empty>{t("enq.nothingInTheCart")}</Empty>
      )}
    </>
  );
}
