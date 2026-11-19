"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ErrorBanner,
  FieldBox,
  PageHead,
  Panel,
  useApi,
  useAction,
} from "../../../../ui/kit";
import { post } from "../../../../ui/api";
import { LineEditor, linesPayload, type EditLine } from "../../../../ui/lines";
import { useT } from "../../../../ui/i18n";

export default function NewQuotation() {
  const router = useRouter();
  const customers = useApi<{ items: { id: string; name: string }[] }>(
    "/customers?pageSize=100&status=ACTIVE",
  );
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const act = useAction();
  const t = useT();
  async function save() {
    setError("");
    if (!customerId) return setError(t("quotations.chooseCustomer"));
    let payload;
    try {
      payload = linesPayload(lines, "sales", t);
    } catch (e) {
      return setError((e as Error).message);
    }
    const q = await act.run(
      () =>
        post<{ id: string }>("/quotations", {
          customerId,
          lines: payload,
          notes,
        }),
      t("quotations.created"),
    );
    if (q) router.push(`/quotations/${q.id}`);
  }
  return (
    <>
      <PageHead
        title={t("quotations.new")}
        back={{ href: "/quotations", label: t("nav.quotations") }}
      />
      <ErrorBanner message={error || act.error} />
      <Panel title={t("docs.customer")}>
        <FieldBox label={t("docs.customer")}>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t("quotations.chooseCustomerOption")}</option>
            {customers.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FieldBox>
      </Panel>
      <Panel title={t("docs.items")}>
        <LineEditor kind="sales" lines={lines} onChange={setLines} />
      </Panel>
      <Panel title={t("docs.notes")}>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: "100%" }}
          aria-label={t("docs.notes")}
        />
        <div className="form-actions">
          <button
            className="primary"
            onClick={() => void save()}
            disabled={act.busy}
          >
            {t("quotations.saveDraft")}
          </button>
        </div>
      </Panel>
    </>
  );
}
