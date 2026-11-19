"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ErrorBanner,
  FieldBox,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { post } from "../../../../ui/api";
import { LineEditor, linesPayload, type EditLine } from "../../../../ui/lines";
import { useT } from "../../../../ui/i18n";

export default function NewPurchaseOrder() {
  const t = useT();
  const router = useRouter();
  const suppliers = useApi<{ items: { id: string; name: string }[] }>(
    "/suppliers?pageSize=100&status=ACTIVE",
  );
  const wh = useApi<{
    locations: { id: string; code: string; warehouseId: string }[];
    warehouses: { id: string; name: string }[];
  }>("/warehouses");
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [error, setError] = useState("");
  const act = useAction();
  async function save() {
    setError("");
    if (!supplierId) return setError(t("purch.chooseSupplier"));
    if (!locationId) return setError(t("purch.chooseLocation"));
    let payload;
    try {
      payload = linesPayload(lines, "purchase");
    } catch (e) {
      return setError((e as Error).message);
    }
    const po = await act.run(
      () =>
        post<{ id: string }>("/purchase-orders", {
          supplierId,
          locationId,
          expectedDate: expectedDate || undefined,
          notes,
          lines: payload,
        }),
      t("purch.created"),
    );
    if (po) router.push(`/purchasing/${po.id}`);
  }
  return (
    <>
      <PageHead
        title={t("purch.newPurchaseOrder")}
        back={{ href: "/purchasing", label: t("suppliers.purchaseOrders") }}
      />
      <ErrorBanner message={error || act.error} />
      <Panel title={t("orders.order")}>
        <div className="form-grid">
          <FieldBox label={t("purch.supplier")}>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">{t("purch.chooseASupplier")}</option>
              {suppliers.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label={t("purch.receiveInto")}>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t("purch.chooseALocation")}</option>
              {wh.data?.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {
                    wh.data?.warehouses.find((w) => w.id === l.warehouseId)
                      ?.name
                  }{" "}
                  · {l.code}
                </option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label={t("purch.expectedDate")}>
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </FieldBox>
          <FieldBox label={t("docs.notes")}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FieldBox>
        </div>
      </Panel>
      <Panel title={t("docs.items")}>
        <LineEditor kind="purchase" lines={lines} onChange={setLines} />
        <div className="form-actions">
          <button
            className="primary"
            disabled={act.busy}
            onClick={() => void save()}
          >
            {t("quotations.saveDraft")}
          </button>
        </div>
      </Panel>
    </>
  );
}
