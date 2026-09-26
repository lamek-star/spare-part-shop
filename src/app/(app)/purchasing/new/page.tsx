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

export default function NewPurchaseOrder() {
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
    if (!supplierId) return setError("Choose a supplier.");
    if (!locationId)
      return setError("Choose where the goods will be received.");
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
      "Purchase order created",
    );
    if (po) router.push(`/purchasing/${po.id}`);
  }
  return (
    <>
      <PageHead
        title="New purchase order"
        back={{ href: "/purchasing", label: "Purchase orders" }}
      />
      <ErrorBanner message={error || act.error} />
      <Panel title="Order">
        <div className="form-grid">
          <FieldBox label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose a supplier…</option>
              {suppliers.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label="Receive into">
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Choose a location…</option>
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
          <FieldBox label="Expected date">
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </FieldBox>
          <FieldBox label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FieldBox>
        </div>
      </Panel>
      <Panel title="Items">
        <LineEditor kind="purchase" lines={lines} onChange={setLines} />
        <div className="form-actions">
          <button
            className="primary"
            disabled={act.busy}
            onClick={() => void save()}
          >
            Save draft
          </button>
        </div>
      </Panel>
    </>
  );
}
