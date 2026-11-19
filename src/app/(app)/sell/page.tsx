"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { get, post, qs, formatMoney, parseMinor } from "../../../ui/api";
import {
  ErrorBanner,
  PageHead,
  Panel,
  Empty,
  Money,
  errorText,
} from "../../../ui/kit";
import { useT } from "../../../ui/i18n";

interface Product {
  id: string;
  sku: string;
  name: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  prescriptionOnly: boolean;
  trackBatches: boolean;
  priceMinor: number;
  currency: string;
  status: string;
}
interface Batch {
  batchNo: string;
  expiryDate: string;
  onHand: number;
}
interface Line {
  product: Product;
  quantity: number;
  /** Units that may be sold: unexpired batches (batch-tracked) or what is available. */
  sellable: number;
  nearestExpiry: string | null;
  expiredUnits: number;
}
interface SaleResult {
  invoice: { id: string; number: string; totalMinor: number; currency: string };
  payment: { method: string } | null;
  changeMinor: number;
}
const METHODS = [
  ["CASH", "Cash"],
  ["CARD", "Card"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["OTHER", "Other"],
] as const;
const today = () => new Date().toISOString().slice(0, 10);

/** The till: scan (a barcode scanner types the code and Enter), check, take payment. */
export default function SellPage() {
  const t = useT();
  const [code, setCode] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [prescriptionRef, setPrescriptionRef] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [given, setGiven] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SaleResult | null>(null);
  const scan = useRef<HTMLInputElement>(null);
  useEffect(() => scan.current?.focus(), []);

  const currency = lines[0]?.product.currency ?? "";
  const totalBeforeTax = lines.reduce(
    (n, l) => n + l.quantity * l.product.priceMinor,
    0,
  );
  const needsPrescription = lines.some((l) => l.product.prescriptionOnly);
  const givenMinor = given.trim() ? parseMinor(given) : null;

  async function add(value: string) {
    const v = value.trim();
    if (!v) return;
    setError("");
    setDone(null);
    try {
      const found = await get<{ product: Product; available: number }>(
        `/products/lookup${qs({ code: v })}`,
      );
      const p = found.product;
      if (p.status !== "ACTIVE")
        throw new Error(`${p.name} is inactive and cannot be sold.`);
      let sellable = found.available;
      let nearestExpiry: string | null = null;
      let expiredUnits = 0;
      if (p.trackBatches) {
        const batches = await get<Batch[]>(`/products/${p.id}/batches`);
        const t = today();
        const good = batches.filter((b) => b.expiryDate >= t);
        expiredUnits = batches
          .filter((b) => b.expiryDate < t)
          .reduce((n, b) => n + b.onHand, 0);
        sellable = Math.min(
          found.available,
          good.reduce((n, b) => n + b.onHand, 0),
        );
        nearestExpiry = good[0]?.expiryDate ?? null;
      }
      setLines((prev) => {
        const at = prev.findIndex((l) => l.product.id === p.id);
        if (at >= 0) {
          const next = [...prev];
          next[at] = { ...next[at], quantity: next[at].quantity + 1 };
          return next;
        }
        return [
          ...prev,
          { product: p, quantity: 1, sellable, nearestExpiry, expiredUnits },
        ];
      });
    } catch (e) {
      const err = e as { status?: number };
      setError(
        err.status === 404
          ? `Nothing matches "${v}". Check the barcode, or add the product under Medicines & Products.`
          : errorText(e),
      );
    }
  }

  function setQuantity(id: string, quantity: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  async function complete() {
    setBusy(true);
    setError("");
    try {
      const result = await post<SaleResult>("/counter-sales", {
        lines: lines.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
        })),
        prescriptionRef,
        method,
        paymentReference: reference,
        amountTenderedMinor: method === "CASH" ? givenMinor : null,
      });
      setDone(result);
      setLines([]);
      setPrescriptionRef("");
      setGiven("");
      setReference("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      scan.current?.focus();
    }
  }

  const short = lines.filter((l) => l.quantity > l.sellable);
  const canComplete =
    lines.length > 0 &&
    short.length === 0 &&
    (!needsPrescription || prescriptionRef.trim().length > 0) &&
    (method !== "CASH" || !given.trim() || givenMinor !== null);

  return (
    <>
      <PageHead
        title={t("nav.sell")}
        subtitle={t("pharm.scanEachItemSBarcode")}
      />
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add(code);
            setCode("");
          }}
        >
          <input
            ref={scan}
            aria-label={t("label.barcode")}
            autoComplete="off"
            placeholder={t("pharm.scanABarcode")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ width: "100%", fontSize: 20, padding: 12 }}
          />
        </form>
      </Panel>
      <ErrorBanner message={error} />

      {done && (
        <Panel title={t("pharm.saleComplete")}>
          <p style={{ fontSize: 20, margin: "4px 0" }}>
            Invoice <strong>{done.invoice.number}</strong> ·{" "}
            <Money
              minor={done.invoice.totalMinor}
              currency={done.invoice.currency}
            />{" "}
            paid
            {done.payment
              ? ` by ${done.payment.method.toLowerCase().replace("_", " ")}`
              : ""}
          </p>
          {done.changeMinor > 0 && (
            <p style={{ fontSize: 26, margin: "8px 0" }}>
              Change to give:{" "}
              <strong>
                {formatMoney(done.changeMinor, done.invoice.currency)}
              </strong>
            </p>
          )}
          <Link className="button" href={`/invoices/${done.invoice.id}`}>
            {t("pharm.openTheInvoicePrintPdf")}
          </Link>
        </Panel>
      )}

      <Panel title={t("pharm.thisSale")}>
        {lines.length === 0 ? (
          <Empty>{t("pharm.nothingScannedYet")}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("doc.item")}</th>
                  <th>{t("tab.stock")}</th>
                  <th style={{ width: 110 }}>{t("lines.quantity")}</th>
                  <th style={{ textAlign: "right" }}>{t("lines.price")}</th>
                  <th style={{ textAlign: "right" }}>{t("pharm.line")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.product.id}>
                    <td>
                      <strong>{l.product.name}</strong>
                      {l.product.prescriptionOnly && (
                        <span className="badge amber" style={{ marginLeft: 6 }}>
                          {t("prod.prescription")}
                        </span>
                      )}
                      <div className="muted">
                        {[
                          l.product.genericName,
                          l.product.strength,
                          l.product.dosageForm,
                        ]
                          .filter(Boolean)
                          .join(" · ") || l.product.sku}
                      </div>
                    </td>
                    <td>
                      <div
                        style={
                          l.quantity > l.sellable
                            ? {
                                color: "var(--danger, #b42318)",
                                fontWeight: 600,
                              }
                            : undefined
                        }
                      >
                        {l.sellable} sellable
                      </div>
                      {l.nearestExpiry && (
                        <div className="muted">expires {l.nearestExpiry}</div>
                      )}
                      {l.expiredUnits > 0 && (
                        <div className="muted">
                          {l.expiredUnits} expired (not sold)
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        aria-label={`Quantity of ${l.product.name}`}
                        value={l.quantity}
                        onChange={(e) =>
                          setQuantity(
                            l.product.id,
                            Math.max(
                              0,
                              Math.trunc(Number(e.target.value) || 0),
                            ),
                          )
                        }
                        style={{ width: 80 }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Money
                        minor={l.product.priceMinor}
                        currency={l.product.currency}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Money
                        minor={l.quantity * l.product.priceMinor}
                        currency={l.product.currency}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    {t("pharm.totalBeforeTaxTaxIs")}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 18 }}>
                    <strong>
                      <Money minor={totalBeforeTax} currency={currency} />
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {short.length > 0 && (
          <p className="muted" role="alert">
            Not enough sellable stock for:{" "}
            {short.map((l) => l.product.name).join(", ")}.
          </p>
        )}
      </Panel>

      {lines.length > 0 && (
        <Panel title={t("pharm.payment")}>
          <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
            {needsPrescription && (
              <label>
                {t("pharm.prescriptionRef")}
                <input
                  value={prescriptionRef}
                  maxLength={120}
                  placeholder={t("pharm.eGRxNumberAnd")}
                  onChange={(e) => setPrescriptionRef(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            )}
            <label>
              {t("pharm.paidBy")}
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                style={{ width: "100%" }}
              >
                {METHODS.map(([v]) => (
                  <option key={v} value={v}>
                    {t(`method.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            {method === "CASH" ? (
              <label>
                {t("pharm.cashGiven")}
                <input
                  inputMode="decimal"
                  value={given}
                  placeholder="0.00"
                  onChange={(e) => setGiven(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            ) : (
              <label>
                {t("pharm.paymentRef")}
                <input
                  value={reference}
                  maxLength={120}
                  onChange={(e) => setReference(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="button primary"
                disabled={!canComplete || busy}
                onClick={() => void complete()}
              >
                {busy ? t("pharm.completing") : t("pharm.completeSale")}
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setLines([]);
                  setError("");
                }}
              >
                {t("pharm.clear")}
              </button>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
