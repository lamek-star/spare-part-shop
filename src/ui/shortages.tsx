"use client";
/**
 * Purchase Orders > "Order what needs ordering": shows, per supplier, every item that needs ordering with a suggested
 * quantity (server: PurchasingService.shortagePlan), then makes one DRAFT purchase order per supplier. Drafts are
 * checked and changed before they are confirmed. Items with no default supplier, or already on order, are listed apart.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ErrorBanner, Modal, Money, useApi, useToast } from "./kit";
import { post } from "./api";
import { locationOptions, useWarehouses } from "./stock";
import { useT } from "./i18n";

interface Line {
  productId: string;
  sku: string;
  name: string;
  available: number;
  reorderLevel: number;
  onOrder: number;
  quantity: number;
  unitCostMinor: number;
  supplierPartNumber: string;
}
interface Plan {
  groups: { supplierId: string; supplierName: string; lines: Line[] }[];
  noSupplier: Line[];
  covered: Line[];
}

export function OrderShortagesButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{t("purch.orderShortages")}</button>
      {open && <OrderShortagesModal onClose={() => setOpen(false)} />}
    </>
  );
}

function OrderShortagesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const plan = useApi<Plan>("/purchase-orders/shortages");
  const wh = useWarehouses(true);
  const locations = locationOptions(wh.data);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosenLocation = locationId || locations[0]?.value || "";
  const groups = plan.data?.groups ?? [];

  async function make() {
    setBusy(true);
    setError("");
    try {
      const r = await post<{ orders: { id: string }[] }>("/purchase-orders/from-shortages", {
        locationId: chosenLocation,
      });
      toast(t("purch.draftsMade", { count: r.orders.length }));
      onClose();
      if (r.orders.length === 1) router.push(`/purchasing/${r.orders[0].id}`);
      else window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const columns = [
    { header: "SKU", cell: (l: Line) => l.sku },
    {
      header: t("purch.supplierNo"),
      cell: (l: Line) => l.supplierPartNumber || "—",
    },
    { header: t("users.name"), cell: (l: Line) => l.name },
    { header: t("stock.available"), align: "right" as const, cell: (l: Line) => l.available },
    { header: t("prod.reorderLevel"), align: "right" as const, cell: (l: Line) => l.reorderLevel },
    { header: t("purch.onOrder"), align: "right" as const, cell: (l: Line) => l.onOrder },
    {
      header: t("purch.toOrder"),
      align: "right" as const,
      cell: (l: Line) => <strong>{l.quantity}</strong>,
    },
    {
      header: t("prod.costPrice"),
      align: "right" as const,
      cell: (l: Line) => <Money minor={l.unitCostMinor} />,
    },
  ];

  return (
    <Modal title={t("purch.orderShortages")} onClose={onClose} wide>
      <p className="muted">{t("purch.shortagesHelp")}</p>
      <ErrorBanner message={plan.error || error} onClose={() => setError("")} />
      {plan.data && groups.length === 0 && plan.data.noSupplier.length === 0 && (
        <p>{t("purch.nothingToOrder")}</p>
      )}
      {groups.map((g) => (
        <section key={g.supplierId} style={{ marginBottom: 16 }}>
          <h3>{g.supplierName}</h3>
          <DataTable rowKey={(l) => l.productId} rows={g.lines} columns={columns} />
        </section>
      ))}
      {plan.data && plan.data.noSupplier.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h3>{t("purch.noSupplierTitle")}</h3>
          <DataTable rowKey={(l) => l.productId} rows={plan.data.noSupplier} columns={columns} />
        </section>
      )}
      {plan.data && plan.data.covered.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h3>{t("purch.coveredTitle")}</h3>
          <DataTable rowKey={(l) => l.productId} rows={plan.data.covered} columns={columns} />
        </section>
      )}
      {groups.length > 0 && (
        <div className="actions" style={{ alignItems: "end" }}>
          <label>
            {t("purch.receiveInto")}
            <select value={chosenLocation} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary" disabled={busy || !chosenLocation} onClick={() => void make()}>
            {t("purch.makeDrafts", { count: groups.length })}
          </button>
        </div>
      )}
    </Modal>
  );
}
