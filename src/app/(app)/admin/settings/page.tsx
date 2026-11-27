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
import { ACTIVE_LANGUAGES, LANGUAGES, useI18n, useT, type Language } from "../../../../ui/i18n";

/** The language for everyone who has not chosen their own (saved at once; audited on the server). */
function ShopLanguage() {
  const { t, choice, setShopDefault } = useI18n();
  const act = useAction();
  return (
    <Panel title={t("lang.shopDefault")}>
      <ErrorBanner message={act.error} onClose={act.clear} />
      <FieldBox label={t("lang.label")} help={t("lang.shopDefaultHelp")}>
        <select
          value={choice?.shop ?? "en"}
          disabled={!choice || act.busy}
          onChange={(e) =>
            void act.run(
              () => setShopDefault(e.target.value as Language),
              t("lang.saved"),
            )
          }
        >
          {ACTIVE_LANGUAGES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LANGUAGES[l].native}
            </option>
          ))}
        </select>
      </FieldBox>
    </Panel>
  );
}

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
  const t = useT();
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
      t("settings.saved"),
    );
    setTimeout(() => location.reload(), 600);
  }
  return (
    <>
      <PageHead
        title={t("nav.settings")}
        subtitle={t("settings.theseDetailsAppearOnQuotations")}
      />
      <ErrorBanner message={act.error} onClose={act.clear} />
      <ShopLanguage />
      <form onSubmit={save}>
        <Panel title={t("settings.business")}>
          <div className="form-grid">
            <FieldBox label={t("auth.shopName")}>
              <input value={f.shopName} onChange={set("shopName")} required />
            </FieldBox>
            <FieldBox
              label={t("settings.taxRegistrationNumber")}
              help={
                !f.taxRegistration.trim() && Number(f.defaultTaxPercent) > 0
                  ? t("settings.taxNoNumber")
                  : t("settings.taxNumberHelp")
              }
            >
              <input
                value={f.taxRegistration}
                onChange={set("taxRegistration")}
              />
            </FieldBox>
            <FieldBox label={t("settings.phone")}>
              <input value={f.phone} onChange={set("phone")} />
            </FieldBox>
            <FieldBox label={t("auth.email")}>
              <input type="email" value={f.email} onChange={set("email")} />
            </FieldBox>
            <FieldBox label={t("settings.address")}>
              <textarea rows={2} value={f.address} onChange={set("address")} />
            </FieldBox>
          </div>
        </Panel>
        <Panel title={t("settings.salesDefaults")}>
          <div className="form-grid">
            <FieldBox
              label={t("settings.currency")}
              help={t("settings.3LetterCodeExistingDocuments")}
            >
              <input
                value={f.currency}
                onChange={set("currency")}
                maxLength={3}
              />
            </FieldBox>
            <FieldBox label={t("settings.defaultTaxRate")}>
              <input
                inputMode="decimal"
                value={f.defaultTaxPercent}
                onChange={set("defaultTaxPercent")}
              />
            </FieldBox>
            <FieldBox label={t("settings.quotationValidForDays")}>
              <input
                inputMode="numeric"
                value={f.quotationValidityDays}
                onChange={set("quotationValidityDays")}
              />
            </FieldBox>
            <FieldBox label={t("settings.invoiceDueAfterDays")}>
              <input
                inputMode="numeric"
                value={f.invoiceDueDays}
                onChange={set("invoiceDueDays")}
              />
            </FieldBox>
            <FieldBox label={t("settings.standardQuotationTerms")}>
              <textarea
                rows={3}
                value={f.quotationTerms}
                onChange={set("quotationTerms")}
              />
            </FieldBox>
            <FieldBox label={t("settings.standardInvoiceNotes")}>
              <textarea
                rows={3}
                value={f.invoiceNotes}
                onChange={set("invoiceNotes")}
              />
            </FieldBox>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={act.busy}>
              {t("settings.saveSettings")}
            </button>
          </div>
        </Panel>
      </form>
    </>
  );
}
