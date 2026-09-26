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
        title="Enquiry cart"
        subtitle="Parts collected for one customer request. Submit it to start a quotation."
        back={{ href: "/enquiries", label: "Enquiries" }}
      />
      <ErrorBanner message={cart.error || act.error} />
      {cart.loading && !cart.data && <Loading />}
      <Panel title={`Items (${items.length})`}>
        <DataTable
          rowKey={(i) => i.id}
          rows={items}
          empty="The cart is empty. Find parts in the Reference Catalogue and choose “Add to enquiry”."
          columns={[
            {
              header: "Part number",
              cell: (i) =>
                i.referencePartId ? (
                  <Link href={`/catalogue/parts/${i.referencePartId}`}>
                    {i.oemNumber}
                  </Link>
                ) : (
                  i.oemNumber
                ),
            },
            { header: "Description", cell: (i) => i.partName },
            { header: "Vehicle", cell: (i) => i.vehicleDescription },
            { header: "Qty", align: "right", cell: (i) => i.quantity },
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
                  Remove
                </button>
              ),
            },
          ]}
        />
      </Panel>
      {items.length > 0 && (
        <Panel title="Submit enquiry">
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
              <FieldBox label="Existing customer (optional)">
                <select value={form.customerId} onChange={set("customerId")}>
                  <option value="">— not linked to a customer —</option>
                  {customers.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FieldBox>
              <FieldBox label="Contact name">
                <input
                  value={form.contactName}
                  onChange={set("contactName")}
                  required
                />
              </FieldBox>
              <FieldBox label="Email">
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={set("contactEmail")}
                />
              </FieldBox>
              <FieldBox label="Phone">
                <input
                  value={form.contactPhone}
                  onChange={set("contactPhone")}
                />
              </FieldBox>
              <FieldBox label="VIN / chassis number">
                <input value={form.vin} onChange={set("vin")} />
              </FieldBox>
              <FieldBox label="Notes">
                <textarea rows={2} value={form.notes} onChange={set("notes")} />
              </FieldBox>
            </div>
            <div className="form-actions">
              <button className="primary" disabled={act.busy}>
                Submit enquiry
              </button>
            </div>
          </form>
        </Panel>
      )}
      {!cart.loading && items.length === 0 && (
        <Empty>Nothing in the cart.</Empty>
      )}
    </>
  );
}
