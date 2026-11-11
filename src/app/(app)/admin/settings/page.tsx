"use client";
import { useEffect, useState } from "react";
import {
  ErrorBanner,
  FieldBox,
  Loading,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { put } from "../../../../ui/api";

interface Settings {
  shopName: string;
  address: string;
  phone: string;
  email: string;
  taxRegistration: string;
  currency: string;
  defaultTaxBp: number;
  quotationValidityDays: number;
  invoiceDueDays: number;
  quotationTerms: string;
  invoiceNotes: string;
}
export default function ShopSettings() {
  const s = useApi<Settings>("/settings");
  const [f, setF] = useState<Record<string, string> | null>(null);
  const act = useAction(s.reload);
  useEffect(() => {
    if (s.data)
      setF({
        ...Object.fromEntries(
          Object.entries(s.data).map(([k, v]) => [k, String(v)]),
        ),
        defaultTaxPercent: String(s.data.defaultTaxBp / 100),
      });
  }, [s.data]);
  if (!f) return s.error ? <ErrorBanner message={s.error} /> : <Loading />;
  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(f!.defaultTaxPercent);
    await act.run(
      () =>
        put("/settings", {
          shopName: f!.shopName,
          address: f!.address,
          phone: f!.phone,
          email: f!.email,
          taxRegistration: f!.taxRegistration,
          currency: f!.currency,
          defaultTaxBp: Math.round(pct * 100),
          quotationValidityDays: Number(f!.quotationValidityDays),
          invoiceDueDays: Number(f!.invoiceDueDays),
          quotationTerms: f!.quotationTerms,
          invoiceNotes: f!.invoiceNotes,
        }),
      "Settings saved",
    );
    setTimeout(() => location.reload(), 600);
  }
  return (
    <>
      <PageHead
        title="Shop settings"
        subtitle="These details appear on quotations and invoices."
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <form onSubmit={save}>
        <Panel title="Business">
          <div className="form-grid">
            <FieldBox label="Shop name">
              <input value={f.shopName} onChange={set("shopName")} required />
            </FieldBox>
            <FieldBox
              label="Tax registration number"
              help={
                !f.taxRegistration.trim() && Number(f.defaultTaxPercent) > 0
                  ? "Tax is charged but no number is set: invoices are printed as INVOICE, not TAX INVOICE, until you enter it."
                  : "Printed on quotations and invoices. With it, invoices are titled TAX INVOICE."
              }
            >
              <input
                value={f.taxRegistration}
                onChange={set("taxRegistration")}
              />
            </FieldBox>
            <FieldBox label="Phone">
              <input value={f.phone} onChange={set("phone")} />
            </FieldBox>
            <FieldBox label="Email">
              <input type="email" value={f.email} onChange={set("email")} />
            </FieldBox>
            <FieldBox label="Address">
              <textarea rows={2} value={f.address} onChange={set("address")} />
            </FieldBox>
          </div>
        </Panel>
        <Panel title="Sales defaults">
          <div className="form-grid">
            <FieldBox
              label="Currency"
              help="3-letter code. Existing documents keep the currency they were issued in."
            >
              <input
                value={f.currency}
                onChange={set("currency")}
                maxLength={3}
              />
            </FieldBox>
            <FieldBox label="Default tax rate (%)">
              <input
                inputMode="decimal"
                value={f.defaultTaxPercent}
                onChange={set("defaultTaxPercent")}
              />
            </FieldBox>
            <FieldBox label="Quotation valid for (days)">
              <input
                inputMode="numeric"
                value={f.quotationValidityDays}
                onChange={set("quotationValidityDays")}
              />
            </FieldBox>
            <FieldBox label="Invoice due after (days)">
              <input
                inputMode="numeric"
                value={f.invoiceDueDays}
                onChange={set("invoiceDueDays")}
              />
            </FieldBox>
            <FieldBox label="Standard quotation terms">
              <textarea
                rows={3}
                value={f.quotationTerms}
                onChange={set("quotationTerms")}
              />
            </FieldBox>
            <FieldBox label="Standard invoice notes">
              <textarea
                rows={3}
                value={f.invoiceNotes}
                onChange={set("invoiceNotes")}
              />
            </FieldBox>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={act.busy}>
              Save settings
            </button>
          </div>
        </Panel>
      </form>
    </>
  );
}
