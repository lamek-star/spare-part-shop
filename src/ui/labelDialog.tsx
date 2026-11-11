"use client";
import { useState } from "react";
import { FieldBox, Modal } from "./kit";
import { apiUrl } from "@/lib/basePath";

/**
 * Print or download a product's label: the shop's name (from Settings), the product, the barcode or a QR code and the
 * captioned number, as the server draws it (/products/:id/label.svg). A 50 × 30 mm label printer prints one label per
 * page; an A4 sheet holds 24 labels of 70 × 37 mm. "Download picture" saves PNGs at 300 dpi for a printer's own
 * software, a print shop or a phone.
 */
type Size = "printer" | "sheet";
type Code = "code128" | "qr";

const DPI = 300;
const MM = DPI / 25.4;
const SHEET = { pageW: 210, pageH: 297, cols: 3, rows: 8, w: 70, h: 37 };
const PRINTER = { w: 50, h: 30 };

export function labelUrl(
  productId: string,
  size: Size,
  code: Code,
  price: boolean,
) {
  return apiUrl(
    `/products/${productId}/label.svg?type=${code}&size=${size}${price ? "&price=1" : ""}`,
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The label could not be drawn."));
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("The picture could not be made.")),
      "image/png",
    ),
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** One label as a 300-dpi PNG, or A4 pages of 24 (light cut guides, as on a pre-cut sheet). */
export async function labelPictures(
  url: string,
  size: Size,
  copies: number,
): Promise<[string, Blob][]> {
  const img = await loadImage(url);
  if (size === "printer") {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(PRINTER.w * MM);
    canvas.height = Math.round(PRINTER.h * MM);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw pictures.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return [["label.png", await toBlob(canvas)]];
  }
  const perPage = SHEET.cols * SHEET.rows;
  const pages = Math.max(1, Math.ceil(copies / perPage));
  const left = ((SHEET.pageW - SHEET.cols * SHEET.w) / 2) * MM;
  const top = ((SHEET.pageH - SHEET.rows * SHEET.h) / 2) * MM;
  const out: [string, Blob][] = [];
  for (let page = 0; page < pages; page++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(SHEET.pageW * MM);
    canvas.height = Math.round(SHEET.pageH * MM);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw pictures.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const onPage = Math.min(perPage, copies - page * perPage);
    for (let i = 0; i < onPage; i++) {
      const x = left + (i % SHEET.cols) * SHEET.w * MM;
      const y = top + Math.floor(i / SHEET.cols) * SHEET.h * MM;
      ctx.drawImage(img, x, y, SHEET.w * MM, SHEET.h * MM);
      ctx.strokeStyle = "#d4d4d4";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, SHEET.w * MM - 1, SHEET.h * MM - 1);
    }
    out.push([`labels-page-${page + 1}.png`, await toBlob(canvas)]);
  }
  return out;
}

/** The print window's page: the label repeated, sized in millimetres for the chosen paper. */
export function printPage(
  url: string,
  size: Size,
  copies: number,
  title: string,
): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const css =
    size === "printer"
      ? "@page{size:50mm 30mm;margin:0}body{margin:0}img{display:block;width:50mm;height:30mm;page-break-after:always}"
      : "@page{size:A4;margin:0}body{margin:0}.sheet{display:grid;grid-template-columns:repeat(3,70mm);grid-auto-rows:37mm;justify-content:center;padding-top:0.5mm}img{width:70mm;height:37mm}";
  const imgs = Array.from(
    { length: copies },
    () => `<img src="${esc(url)}" alt="">`,
  ).join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head>` +
    `<body><div class="sheet">${imgs}</div>` +
    `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body></html>`
  );
}

export function LabelDialog({
  productId,
  sku,
  onClose,
}: {
  productId: string;
  sku: string;
  onClose: () => void;
}) {
  const [size, setSize] = useState<Size>("printer");
  const [code, setCode] = useState<Code>("code128");
  const [price, setPrice] = useState(true);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = labelUrl(productId, size, code, price);
  const count = Math.max(1, Math.min(200, Math.floor(copies) || 1));

  function print() {
    const w = window.open("", "_blank", "width=760,height=900");
    if (!w) {
      setError(
        "The print window was blocked. Allow pop-ups for this page and try again.",
      );
      return;
    }
    w.document.open();
    w.document.write(
      printPage(
        new URL(url, window.location.href).href,
        size,
        count,
        `Labels ${sku}`,
      ),
    );
    w.document.close();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      for (const [name, blob] of await labelPictures(url, size, count))
        download(`${sku}-${name}`, blob);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The picture could not be made.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Print label" onClose={onClose}>
      <div
        className="label-preview"
        style={{
          background: "#f3f4f6",
          padding: 16,
          borderRadius: 8,
          textAlign: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the label as the server draws it */}
        <img
          src={url}
          alt={`Label for ${sku}`}
          style={{
            width: size === "printer" ? 300 : 340,
            maxWidth: "100%",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,.18)",
          }}
        />
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <FieldBox label="Paper">
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as Size)}
          >
            <option value="printer">Label printer, 50 × 30 mm</option>
            <option value="sheet">A4 sheet, 3 × 8 labels (70 × 37 mm)</option>
          </select>
        </FieldBox>
        <FieldBox label="Code">
          <select
            value={code}
            onChange={(e) => setCode(e.target.value as Code)}
          >
            <option value="code128">Barcode</option>
            <option value="qr">QR code</option>
          </select>
        </FieldBox>
        <FieldBox label="Copies">
          <input
            type="number"
            min={1}
            max={200}
            value={copies}
            onChange={(e) => setCopies(Number(e.target.value))}
          />
        </FieldBox>
        <FieldBox label="Price on the label">
          <select
            value={price ? "yes" : "no"}
            onChange={(e) => setPrice(e.target.value === "yes")}
          >
            <option value="yes">Show the price</option>
            <option value="no">No price</option>
          </select>
        </FieldBox>
      </div>
      <p className="muted">
        The shop&apos;s name comes from Settings. Scanning the label in
        &ldquo;Scan / Lookup&rdquo; opens this product.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button onClick={() => void save()} disabled={busy}>
          {busy ? "Making the picture…" : "Download picture"}
        </button>
        <button className="primary" onClick={print}>
          Print
        </button>
      </div>
    </Modal>
  );
}
