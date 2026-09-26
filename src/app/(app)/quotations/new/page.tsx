"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner, FieldBox, PageHead, Panel, useApi, useAction } from "../../../../ui/kit";
import { post } from "../../../../ui/api";
import { LineEditor, linesPayload, type EditLine } from "../../../../ui/lines";

export default function NewQuotation() {
  const router = useRouter();
  const customers = useApi<{ items: { id: string; name: string }[] }>("/customers?pageSize=100&status=ACTIVE");
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const act = useAction();
  async function save() {
    setError("");
    if (!customerId) return setError("Choose a customer.");
    let payload;
    try {
      payload = linesPayload(lines, "sales");
    } catch (e) {
      return setError((e as Error).message);
    }
    const q = await act.run(() => post<{ id: string }>("/quotations", { customerId, lines: payload, notes }), "Quotation created");
    if (q) router.push(`/quotations/${q.id}`);
  }
  return (
    <>
      <PageHead title="New quotation" back={{ href: "/quotations", label: "Quotations" }} />
      <ErrorBanner message={error || act.error} />
      <Panel title="Customer">
        <FieldBox label="Customer">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose a customer…</option>
            {customers.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FieldBox>
      </Panel>
      <Panel title="Items">
        <LineEditor kind="sales" lines={lines} onChange={setLines} />
      </Panel>
      <Panel title="Notes">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%" }} aria-label="Notes" />
        <div className="form-actions">
          <button className="primary" onClick={() => void save()} disabled={act.busy}>
            Save draft
          </button>
        </div>
      </Panel>
    </>
  );
}
