import type { Customer, DocumentLine, Payment, Totals } from "../domain/types";
import type { ShopConfig } from "../providers/core";
import { formatMoney, toDecimalString } from "../kernel/money";
import { A4, PdfDocument, wrapText } from "./pdf";

export interface CommercialDocument extends Totals {
  kind: "QUOTATION" | "INVOICE";
  number: string;
  status: string;
  currency: string;
  taxBp: number;
  lines: DocumentLine[];
  /** Quotation: valid until. Invoice: due date. */
  dateLabel: string;
  date: string | null;
  issuedLabel: string;
  issued: string | null;
  notes: string;
  terms: string;
  payments?: Payment[];
  amountPaidMinor?: number;
  balanceMinor?: number;
}

const MARGIN = 42;
const LEFT = MARGIN;
const RIGHT = A4.width - MARGIN;
const INK: [number, number, number] = [0.09, 0.17, 0.25];
const MUTED: [number, number, number] = [0.4, 0.46, 0.52];
const COL = { n: LEFT + 2, sku: LEFT + 22, desc: LEFT + 112, descW: 205, qty: 388, unit: 466, total: RIGHT - 4 };
const pct = (bp: number) => (bp === 0 ? "" : `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`);
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : "-");

/** Renders a quotation or invoice to PDF bytes. Pure: same input, same layout. */
export function renderCommercialDocument(doc: CommercialDocument, shop: ShopConfig, customer: Customer): Uint8Array {
  const pdf = new PdfDocument(`${doc.kind === "INVOICE" ? "Invoice" : "Quotation"} ${doc.number}`);
  let y = 0;

  const header = () => {
    pdf.text(LEFT, 52, shop.shopName || "Spare parts shop", { size: 18, bold: true, color: INK });
    let hy = 68;
    for (const line of [shop.address, [shop.phone, shop.email].filter(Boolean).join("  |  "), shop.taxRegistration ? `Tax registration: ${shop.taxRegistration}` : ""].filter(Boolean)) {
      for (const l of wrapText(line, 260, 9)) {
        pdf.text(LEFT, hy, l, { size: 9, color: MUTED });
        hy += 12;
      }
    }
    pdf.text(RIGHT, 52, doc.kind === "INVOICE" ? "TAX INVOICE" : "QUOTATION", { size: 18, bold: true, align: "right", color: INK });
    pdf.text(RIGHT, 68, doc.number, { size: 11, bold: true, align: "right" });
    pdf.text(RIGHT, 82, `${doc.issuedLabel}: ${dateOnly(doc.issued)}`, { size: 9, align: "right", color: MUTED });
    pdf.text(RIGHT, 94, `${doc.dateLabel}: ${dateOnly(doc.date)}`, { size: 9, align: "right", color: MUTED });
    pdf.text(RIGHT, 106, `Status: ${doc.status.replace(/_/g, " ")}`, { size: 9, align: "right", color: MUTED });
    pdf.line(LEFT, Math.max(hy, 114) + 4, RIGHT, Math.max(hy, 114) + 4, 1, 0.3);
    return Math.max(hy, 114) + 20;
  };
  const tableHead = () => {
    pdf.rect(LEFT, y - 11, RIGHT - LEFT, 17, [0.93, 0.95, 0.97]);
    const head = { size: 8.5, bold: true, color: INK } as const;
    pdf.text(COL.n, y, "#", head);
    pdf.text(COL.sku, y, "SKU / OEM", head);
    pdf.text(COL.desc, y, "Description", head);
    pdf.text(COL.qty, y, "Qty", { ...head, align: "right" });
    pdf.text(COL.unit, y, "Unit price", { ...head, align: "right" });
    pdf.text(COL.total, y, "Line total", { ...head, align: "right" });
    y += 14;
  };
  const footer = (page: number, of: number) => {
    pdf.text(A4.width / 2, A4.height - 24, `${doc.number}  -  page ${page} of ${of}`, { size: 8, align: "center", color: MUTED });
  };

  y = header();
  // parties
  pdf.text(LEFT, y, doc.kind === "INVOICE" ? "BILL TO" : "PREPARED FOR", { size: 8, bold: true, color: MUTED });
  y += 13;
  pdf.text(LEFT, y, customer.name, { size: 11, bold: true });
  y += 13;
  const party = [customer.contactPerson, customer.billingAddress, [customer.phone, customer.email].filter(Boolean).join("  |  "), customer.taxNumber ? `Tax number: ${customer.taxNumber}` : ""].filter(Boolean);
  for (const line of party)
    for (const l of wrapText(line, 300, 9.5)) {
      pdf.text(LEFT, y, l, { size: 9.5 });
      y += 12;
    }
  y += 14;

  tableHead();
  for (const [i, line] of doc.lines.entries()) {
    const desc = wrapText(line.description, COL.descW, 9);
    const ident = [line.sku, line.oemNumber && line.oemNumber !== line.sku ? line.oemNumber : ""].filter(Boolean).flatMap((t) => wrapText(t, 86, 8.5));
    const rows = Math.max(desc.length, ident.length, line.discountBp ? 2 : 1);
    const height = rows * 11 + 6;
    if (y + height > A4.height - 70) {
      pdf.addPage();
      y = 56;
      tableHead();
    }
    pdf.text(COL.n, y, String(i + 1), { size: 9 });
    ident.forEach((t, k) => pdf.text(COL.sku, y + k * 11, t, { size: 8.5 }));
    desc.forEach((t, k) => pdf.text(COL.desc, y + k * 11, t, { size: 9 }));
    pdf.text(COL.qty, y, String(line.quantity), { size: 9, align: "right" });
    pdf.text(COL.unit, y, toDecimalString(line.unitPriceMinor), { size: 9, align: "right" });
    if (line.discountBp) pdf.text(COL.unit, y + 11, `less ${pct(line.discountBp)}`, { size: 7.5, align: "right", color: MUTED });
    pdf.text(COL.total, y, toDecimalString(line.lineTotalMinor), { size: 9, align: "right" });
    y += height;
    pdf.line(LEFT, y - 6, RIGHT, y - 6, 0.3, 0.85);
  }

  // totals
  const need = 90 + (doc.payments?.length ?? 0) * 12;
  if (y + need > A4.height - 70) {
    pdf.addPage();
    y = 56;
  }
  y += 8;
  const totalRow = (label: string, value: string, bold = false) => {
    pdf.text(RIGHT - 110, y, label, { size: 10, bold, align: "right" });
    pdf.text(RIGHT - 4, y, value, { size: 10, bold, align: "right" });
    y += 15;
  };
  totalRow("Subtotal", formatMoney(doc.subtotalMinor, doc.currency));
  totalRow(`Tax (${pct(doc.taxBp) || "0%"})`, formatMoney(doc.taxMinor, doc.currency));
  pdf.line(RIGHT - 230, y - 10, RIGHT, y - 10, 0.8, 0.3);
  totalRow("Total", formatMoney(doc.totalMinor, doc.currency), true);
  if (doc.kind === "INVOICE") {
    totalRow("Paid", formatMoney(doc.amountPaidMinor ?? 0, doc.currency));
    totalRow("Balance due", formatMoney(doc.balanceMinor ?? doc.totalMinor, doc.currency), true);
  }
  if (doc.payments?.length) {
    y += 6;
    pdf.text(LEFT, y, "PAYMENTS RECEIVED", { size: 8, bold: true, color: MUTED });
    y += 13;
    for (const p of doc.payments) {
      pdf.text(LEFT, y, `${dateOnly(p.paidAt)}  ${p.method.replace(/_/g, " ")}${p.reference ? `  ref ${p.reference}` : ""}`, { size: 9 });
      pdf.text(LEFT + 300, y, formatMoney(p.amountMinor, doc.currency), { size: 9, align: "right" });
      y += 12;
    }
  }
  for (const [title, text] of [["NOTES", doc.notes], [doc.kind === "QUOTATION" ? "TERMS" : "PAYMENT NOTES", doc.terms]] as const) {
    if (!text.trim()) continue;
    const lines = wrapText(text, RIGHT - LEFT, 9);
    if (y + 20 + lines.length * 12 > A4.height - 60) {
      pdf.addPage();
      y = 56;
    }
    y += 12;
    pdf.text(LEFT, y, title, { size: 8, bold: true, color: MUTED });
    y += 12;
    for (const l of lines) {
      pdf.text(LEFT, y, l, { size: 9 });
      y += 12;
    }
  }
  const pages = pdf.pageCount;
  for (let p = 0; p < pages; p++) {
    pdf.selectPage(p);
    footer(p + 1, pages);
  }
  return pdf.build();
}
