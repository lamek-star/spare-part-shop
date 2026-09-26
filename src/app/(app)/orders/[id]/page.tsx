"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useSession } from "../../../../ui/session";
import { Badge, ErrorBanner, FieldBox, FormModal, KeyValues, Loading, Modal, PageHead, Panel, useAction, useApi } from "../../../../ui/kit";
import { post } from "../../../../ui/api";
import { DocLines, TotalsBox, type DocLine } from "../../../../ui/doc";

interface OrderLine extends DocLine {
  quantityFulfilled: number;
  quantityReturned: number;
  quantityInvoiced: number;
}
interface Order {
  id: string;
  number: string;
  status: string;
  quotationId: string | null;
  customerId: string;
  currency: string;
  taxBp: number;
  notes: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: OrderLine[];
}
export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const router = useRouter();
  const o = useApi<Order>(`/orders/${id}`);
  const customer = useApi<{ name: string }>(o.data ? `/customers/${o.data.customerId}` : null);
  const wh = useApi<{ locations: { id: string; code: string; warehouseId: string }[]; warehouses: { id: string; name: string }[] }>(s.can("inventory.read") ? "/warehouses" : null);
  const act = useAction(o.reload);
  const [fulfilling, setFulfilling] = useState<Record<string, string> | null>(null);
  const [returning, setReturning] = useState(false);
  if (o.loading && !o.data) return <Loading />;
  if (!o.data) return <ErrorBanner message={o.error || "Order not found."} />;
  const x = o.data;
  const w = s.can("orders.write");
  const remaining = (l: OrderLine) => l.quantity - l.quantityFulfilled;
  const anyToDeliver = x.lines.some((l) => remaining(l) > 0);
  const anyToInvoice = x.lines.some((l) => l.quantityFulfilled - l.quantityReturned - l.quantityInvoiced > 0);
  const anyReturnable = x.lines.some((l) => l.productId && l.quantityFulfilled - l.quantityReturned > 0);
  const locOptions = (wh.data?.locations ?? []).map((l) => ({ value: l.id, label: `${wh.data?.warehouses.find((k) => k.id === l.warehouseId)?.name ?? ""} · ${l.code}` }));
  async function deliver() {
    const lines = Object.entries(fulfilling ?? {})
      .filter(([, v]) => v.trim() !== "" && Number(v) > 0)
      .map(([lineId, v]) => ({ lineId, quantity: Number(v) }));
    if (!lines.length) return;
    const r = await act.run(() => post(`/orders/${id}/fulfil`, { lines }), "Delivery recorded");
    if (r) setFulfilling(null);
  }
  async function invoice() {
    const inv = await act.run(() => post<{ id: string }>(`/orders/${id}/invoice`, {}), "Invoice created");
    if (inv) router.push(`/invoices/${inv.id}`);
  }
  return (
    <>
      <PageHead
        title={x.number}
        subtitle={<Badge value={x.status} />}
        back={{ href: "/orders", label: "Orders" }}
        actions={
          <>
            {w && anyToDeliver && !["CANCELLED", "INVOICED"].includes(x.status) && (
              <button className="primary" onClick={() => setFulfilling(Object.fromEntries(x.lines.map((l) => [l.id, String(Math.max(0, remaining(l)))])))}>
                Record delivery
              </button>
            )}
            {s.can("invoices.write") && anyToInvoice && (
              <button className="primary" disabled={act.busy} onClick={() => void invoice()}>
                Invoice delivered items
              </button>
            )}
            {w && anyReturnable && <button onClick={() => setReturning(true)}>Record return</button>}
            {w && anyToDeliver && x.lines.some((l) => l.productId) && <button onClick={() => void act.run(() => post(`/orders/${id}/reserve`), "Reservation updated")}>Reserve available stock</button>}
            {w && !["CANCELLED", "INVOICED"].includes(x.status) && x.lines.every((l) => l.quantityFulfilled === 0) && (
              <button className="danger" onClick={() => void act.run(() => post(`/orders/${id}/cancel`, { reason: "Cancelled by staff" }), "Order cancelled")}>
                Cancel order
              </button>
            )}
          </>
        }
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <Panel title="Order">
        <KeyValues
          items={[
            ["Customer", customer.data ? <Link key="c" href={`/customers/${x.customerId}`}>{customer.data.name}</Link> : ""],
            ["Quotation", x.quotationId ? <Link key="q" href={`/quotations/${x.quotationId}`}>Open quotation</Link> : ""],
            ["Notes", x.notes],
          ]}
        />
      </Panel>
      <Panel title="Items">
        <DocLines
          lines={x.lines}
          currency={x.currency}
          extra={[
            { header: "Delivered", align: "right", cell: (l) => l.quantityFulfilled },
            { header: "Returned", align: "right", cell: (l) => l.quantityReturned },
            { header: "Invoiced", align: "right", cell: (l) => l.quantityInvoiced },
          ]}
        />
        <TotalsBox subtotalMinor={x.subtotalMinor} taxMinor={x.taxMinor} totalMinor={x.totalMinor} taxBp={x.taxBp} currency={x.currency} />
      </Panel>
      {fulfilling && (
        <Modal title="Record delivery" onClose={() => setFulfilling(null)}>
          <p className="muted">Enter the quantity delivered now for each line. Stock is deducted when you save.</p>
          {x.lines
            .filter((l) => remaining(l) > 0)
            .map((l) => (
              <FieldBox key={l.id} label={`${l.description} (outstanding ${remaining(l)})`}>
                <input inputMode="numeric" value={fulfilling[l.id] ?? ""} onChange={(e) => setFulfilling({ ...fulfilling, [l.id]: e.target.value })} />
              </FieldBox>
            ))}
          <ErrorBanner message={act.error} />
          <div className="form-actions">
            <button className="primary" disabled={act.busy} onClick={() => void deliver()}>
              Save delivery
            </button>
          </div>
        </Modal>
      )}
      {returning && (
        <FormModal
          title="Record return"
          submitLabel="Record return"
          fields={[
            { name: "lineId", label: "Item", type: "select", options: x.lines.filter((l) => l.productId && l.quantityFulfilled - l.quantityReturned > 0).map((l) => ({ value: l.id, label: `${l.description} (up to ${l.quantityFulfilled - l.quantityReturned})` })) },
            { name: "quantity", label: "Quantity returned", type: "number", required: true },
            { name: "locationId", label: "Return to location", type: "select", options: locOptions },
            { name: "reason", label: "Reason", type: "textarea", required: true },
          ]}
          onClose={() => setReturning(false)}
          onSubmit={async (v) => {
            await post(`/orders/${id}/return`, { reason: v.reason, lines: [{ lineId: v.lineId, quantity: v.quantity, locationId: v.locationId }] });
            o.reload();
          }}
        />
      )}
    </>
  );
}
