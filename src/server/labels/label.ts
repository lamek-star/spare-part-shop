import { code128Widths } from "./code128";
import { qrMatrix } from "./qr";

/**
 * A whole product label as one SVG, in millimetres, laid out the same way as IntraForge's built-in Spare Parts and
 * Pharmacy labels: the shop's name at the top (and "Rx" for a prescription medicine), the product's name and one or
 * two detail lines, the barcode (or a QR code), the number with its caption ("Part No. BRK-2207"), and the price.
 * Printed as it is on a 50 × 30 mm label printer, or 24 to an A4 sheet of 70 × 37 mm labels.
 */
export type LabelSize = "printer" | "sheet";
export type LabelCode = "code128" | "qr";

export const LABEL_SIZES: Record<LabelSize, { w: number; h: number }> = {
  printer: { w: 50, h: 30 },
  sheet: { w: 70, h: 37 },
};

export interface LabelContent {
  shop: string;
  name: string;
  details: string[];
  number: string;
  /** "Part No." for spare parts, "Item No." for the pharmacy. */
  numberCaption: string;
  price?: string;
  flag?: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Font size in mm for a size given in points. */
const pt = (p: number) => (p * 25.4) / 72;
/** Roughly how wide Arial runs (average glyph width per font size): enough to keep text inside the label. */
const widthOf = (text: string, sizeMm: number, bold = false, mono = false) =>
  text.length * sizeMm * (mono ? 0.6 : bold ? 0.58 : 0.52);

function fit(
  text: string,
  sizeMm: number,
  maxMm: number,
  bold = false,
  mono = false,
): string {
  if (widthOf(text, sizeMm, bold, mono) <= maxMm) return text;
  let t = text;
  while (t.length > 1 && widthOf(`${t}…`, sizeMm, bold, mono) > maxMm)
    t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrap(
  text: string,
  sizeMm: number,
  maxMm: number,
  maxLines: number,
  bold = false,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const attempt = line ? `${line} ${words[i]}` : words[i];
    if (widthOf(attempt, sizeMm, bold) <= maxMm || !line) line = attempt;
    else {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (line) lines.push(line);
  return lines
    .slice(0, maxLines)
    .map((l, i, all) =>
      i === all.length - 1 ? fit(l, sizeMm, maxMm, bold) : l,
    );
}

function text(
  x: number,
  y: number,
  s: string,
  size: number,
  opts: { bold?: boolean; mono?: boolean; anchor?: string; fill?: string } = {},
) {
  const family = opts.mono
    ? "'Courier New', monospace"
    : "Arial, Helvetica, sans-serif";
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="${family}" font-size="${size.toFixed(2)}"${
    opts.bold ? ' font-weight="bold"' : ""
  }${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}${opts.fill ? ` fill="${opts.fill}"` : ""}>${esc(s)}</text>`;
}

/** The label as a standalone SVG document, `size` millimetres. */
export function labelSvg(
  c: LabelContent,
  size: LabelSize,
  code: LabelCode,
): string {
  const { w, h } = LABEL_SIZES[size];
  const padX = 2.5;
  const padY = 1.6;
  const left = padX;
  const width = w - 2 * padX;
  const parts: string[] = [];
  let cy = padY;

  // The shop's name, and the Rx flag in a box on the right
  let flagW = 0;
  if (c.flag) {
    const fs = pt(8);
    flagW = widthOf(c.flag, fs, true) + 2;
    parts.push(
      `<rect x="${(w - padX - flagW).toFixed(2)}" y="${cy.toFixed(2)}" width="${flagW.toFixed(2)}" height="${(fs * 1.15).toFixed(2)}" fill="none" stroke="#000" stroke-width="0.25"/>`,
      text(w - padX - flagW / 2, cy + fs * 0.9, c.flag, fs, {
        bold: true,
        anchor: "middle",
      }),
    );
  }
  const shop = c.shop.trim().toUpperCase();
  if (shop) {
    const fs = pt(5.8);
    parts.push(
      text(left, cy + fs * 0.85, fit(shop, fs, width - flagW - 1, true), fs, {
        bold: true,
        fill: "#333",
      }),
    );
    cy += fs * 1.3;
  } else if (c.flag) cy += pt(8) * 1.2;

  // The name (up to two lines), then the details that fit
  const nameFs = pt(8.5);
  const nameLines = wrap(c.name, nameFs, width, 2, true);
  for (const line of nameLines) {
    parts.push(text(left, cy + nameFs * 0.85, line, nameFs, { bold: true }));
    cy += nameFs * 1.12;
  }
  const detailFs = pt(6.5);
  const room =
    (nameLines.length > 1 ? 1 : 2) -
    (size === "printer" && code === "qr" ? 1 : 0);
  for (const d of c.details.filter(Boolean).slice(0, Math.max(0, room))) {
    parts.push(
      text(left, cy + detailFs * 0.85, fit(d, detailFs, width), detailFs),
    );
    cy += detailFs * 1.15;
  }

  // From the bottom up: the price, the captioned number, then the code in the space left
  let by = h - padY;
  if (c.price) {
    const fs = pt(7);
    parts.push(
      text(w / 2, by - fs * 0.2, fit(c.price, fs, width, true), fs, {
        bold: true,
        anchor: "middle",
      }),
    );
    by -= fs * 1.1;
  }
  const numFs = pt(7.5);
  const numberLine = fit(
    `${c.numberCaption} ${c.number}`,
    numFs,
    width,
    true,
    true,
  );
  parts.push(
    text(w / 2, by - numFs * 0.2, numberLine, numFs, {
      bold: true,
      mono: true,
      anchor: "middle",
    }),
  );
  by -= numFs * 1.15;
  const space = by - cy - 0.6;
  if (code === "qr") {
    const side = Math.min(space, 16);
    if (side > 6) {
      const m = qrMatrix(c.number);
      const cell = side / (m.length + 2);
      const x0 = (w - side) / 2 + cell;
      const y0 = by - side + cell - 0.3;
      let path = "";
      m.forEach((row, y) =>
        row.forEach((dark, x) => {
          if (dark)
            path += `M${(x0 + x * cell).toFixed(3)} ${(y0 + y * cell).toFixed(3)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`;
        }),
      );
      parts.push(`<path d="${path}" fill="#000"/>`);
    }
  } else {
    const barH = Math.min(9, space);
    if (barH > 3) {
      const widths = code128Widths(c.number);
      const total = widths.reduce((a, b) => a + b, 0) + 20;
      const unit = width / total;
      let bx = left + 10 * unit;
      let bars = "";
      widths.forEach((m, i) => {
        if (i % 2 === 0)
          bars += `<rect x="${bx.toFixed(3)}" y="${(by - 0.3 - barH).toFixed(3)}" width="${(m * unit).toFixed(3)}" height="${barH.toFixed(3)}"/>`;
        bx += m * unit;
      });
      parts.push(`<g fill="#000">${bars}</g>`);
    }
  }
  const label = esc(`${c.numberCaption} ${c.number}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm" role="img" aria-label="Label ${label}">` +
    `<rect width="${w}" height="${h}" fill="#fff"/>${parts.join("")}</svg>`
  );
}
