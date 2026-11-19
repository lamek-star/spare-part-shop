"use client";
import Link from "next/link";
import { Printer } from "lucide-react";
import { formatDate } from "./api";
import type { DocLine } from "./doc";
import { useI18n } from "./i18n";
import { Money, useStatusLabel } from "./kit";

/**
 * A quotation or invoice laid out for paper, in the person's language. The
 * browser draws it, so Arabic (right-to-left, joined letters) and Amharic /
 * Tigrinya (the bundled Ethiopic font) print correctly; "Save as PDF" in the
 * print dialog keeps a file. Same content and rules as the English PDF
 * (server/documents/render.ts): TAX INVOICE only with the shop's tax number.
 */
export interface PrintShop {
  shopName: string;
  address: string;
  phone: string;
  email: string;
  taxRegistration: string;
}
export interface PrintCustomer {
  name: string;
  contactPerson?: string;
  billingAddress?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
}
export interface PrintDoc {
  kind: "QUOTATION" | "INVOICE";
  number: string;
  status: string;
  currency: string;
  taxBp: number;
  issued: string | null;
  /** Quotation: valid until. Invoice: due date. */
  date: string | null;
  lines: DocLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor?: number;
  balanceMinor?: number;
  notes: string;
  terms?: string;
}

export function PrintDocument({
  doc,
  shop,
  customer,
  backHref,
}: {
  doc: PrintDoc;
  shop: PrintShop;
  customer: PrintCustomer | null;
  backHref: string;
}) {
  const { t, dir } = useI18n();
  const statusLabel = useStatusLabel();
  const title =
    doc.kind === "QUOTATION"
      ? t("print.quotation")
      : shop.taxRegistration.trim()
        ? t("print.taxInvoice")
        : t("print.invoice");
  const row = (label: string, minor: number, bold = false) => (
    <tr key={label} className={bold ? "print-total" : undefined}>
      <td>{label}</td>
      <td className="num">
        <Money minor={minor} currency={doc.currency} />
      </td>
    </tr>
  );
  return (
    <>
      <div className="print-toolbar no-print">
        <Link className="button" href={backHref}>
          {t("print.back")}
        </Link>
        <button className="primary" onClick={() => window.print()}>
          <Printer size={16} /> {t("docs.print")}
        </button>
        <span className="muted">{t("print.help")}</span>
      </div>
      <article className="print-doc" dir={dir}>
        <header className="print-head">
          <div>
            <h1>{shop.shopName || t("print.shopFallback")}</h1>
            {shop.address && <p>{shop.address}</p>}
            {(shop.phone || shop.email) && (
              <p>
                <bdi dir="ltr">
                  {[shop.phone, shop.email].filter(Boolean).join("  |  ")}
                </bdi>
              </p>
            )}
            {shop.taxRegistration && (
              <p>
                {t("print.taxReg", { number: "" })}
                <bdi dir="ltr">{shop.taxRegistration}</bdi>
              </p>
            )}
          </div>
          <div className="print-meta">
            <h2>{title}</h2>
            <strong>
              <bdi dir="ltr">{doc.number}</bdi>
            </strong>
            <p>
              {t("docs.issued")}: {formatDate(doc.issued)}
            </p>
            <p>
              {doc.kind === "QUOTATION" ? t("docs.validUntil") : t("docs.due")}:{" "}
              {formatDate(doc.date)}
            </p>
            <p>
              {t("common.status")}: {statusLabel(doc.status)}
            </p>
          </div>
        </header>

        <section className="print-party">
          <small>
            {doc.kind === "INVOICE"
              ? t("print.billTo")
              : t("print.preparedFor")}
          </small>
          <strong>{customer?.name ?? ""}</strong>
          {customer?.contactPerson && <p>{customer.contactPerson}</p>}
          {customer?.billingAddress && <p>{customer.billingAddress}</p>}
          {(customer?.phone || customer?.email) && (
            <p>
              <bdi dir="ltr">
                {[customer?.phone, customer?.email]
                  .filter(Boolean)
                  .join("  |  ")}
              </bdi>
            </p>
          )}
          {customer?.taxNumber && (
            <p>
              {t("print.customerTax", { number: "" })}
              <bdi dir="ltr">{customer.taxNumber}</bdi>
            </p>
          )}
        </section>

        <table className="print-lines">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("print.sku")}</th>
              <th>{t("lines.description")}</th>
              <th className="num">{t("doc.qty")}</th>
              <th className="num">{t("doc.unitPrice")}</th>
              <th className="num">{t("print.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td dir="ltr">
                  {[l.sku, l.oemNumber].filter(Boolean).join(" · ")}
                </td>
                <td>{l.description}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">
                  <Money minor={l.unitPriceMinor} currency={doc.currency} />
                  {l.discountBp > 0 && (
                    <small>
                      {t("print.less", { pct: `${l.discountBp / 100}%` })}
                    </small>
                  )}
                </td>
                <td className="num">
                  <Money minor={l.lineTotalMinor} currency={doc.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="print-totals">
          <tbody>
            {row(t("doc.subtotal"), doc.subtotalMinor)}
            {row(t("doc.tax", { rate: doc.taxBp / 100 }), doc.taxMinor)}
            {row(t("doc.total"), doc.totalMinor, true)}
            {doc.amountPaidMinor !== undefined &&
              row(t("invoices.paid"), doc.amountPaidMinor)}
            {doc.balanceMinor !== undefined &&
              row(t("invoices.balanceDue"), doc.balanceMinor, true)}
          </tbody>
        </table>

        {doc.notes && (
          <section className="print-notes">
            <small>{t("docs.notes")}</small>
            <p>{doc.notes}</p>
          </section>
        )}
        {doc.terms && (
          <section className="print-notes">
            <small>{t("docs.terms")}</small>
            <p>{doc.terms}</p>
          </section>
        )}
      </article>
    </>
  );
}
