/**
 * A deliberately small PDF 1.4 writer: A4 pages, the built-in Helvetica
 * fonts (no font files to ship or license), text, rules and shaded boxes.
 * Enough for quotations, invoices and labels; not a general PDF library.
 * Text is limited to WinAnsi (Latin); other characters print as "?".
 */
export const A4 = { width: 595.28, height: 841.89 };
type Font = "F1" | "F2"; // Helvetica, Helvetica-Bold

// Helvetica advance widths for ASCII 32..126 (per 1000 em), regular and bold.
const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const win1252: Record<string, number> = { "€": 128, "‚": 130, "„": 132, "…": 133, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "™": 153 };
function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (win1252[ch]) out.push(win1252[ch]);
    else if (cp === 9) out.push(32);
    else out.push(63);
  }
  return out;
}
function advance(code: number, bold: boolean): number {
  if (code >= 32 && code <= 126) return (bold ? WB : W)[code - 32];
  return 556;
}
export function textWidth(text: string, size: number, bold = false): number {
  return (encode(text).reduce((n, c) => n + advance(c, bold), 0) * size) / 1000;
}
export function wrapText(text: string, maxWidth: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w, size, bold) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxWidth) cut--;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (textWidth(candidate, size, bold) <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}
const hex = (bytes: number[]) => "<" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
const num = (n: number) => (Math.round(n * 100) / 100).toString();

export class PdfDocument {
  private pages: string[][] = [[]];
  constructor(
    private readonly title = "",
    private readonly pageSize = A4,
  ) {}
  get pageCount() {
    return this.pages.length;
  }
  private current = 0;
  addPage() {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }
  selectPage(index: number) {
    this.current = index;
  }
  private op(s: string) {
    this.pages[this.current].push(s);
  }
  /** y is measured from the TOP of the page, like a screen. */
  text(x: number, y: number, text: string, opts: { size?: number; bold?: boolean; align?: "left" | "right" | "center"; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    const width = textWidth(text, size, bold);
    const left = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    const c = opts.color ?? [0, 0, 0];
    this.op(`BT ${num(c[0])} ${num(c[1])} ${num(c[2])} rg /${(bold ? "F2" : "F1") as Font} ${size} Tf ${num(left)} ${num(this.pageSize.height - y)} Td ${hex(encode(text))} Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.op(`${num(gray)} G ${width} w ${num(x1)} ${num(this.pageSize.height - y1)} m ${num(x2)} ${num(this.pageSize.height - y2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    this.op(`${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg ${num(x)} ${num(this.pageSize.height - y - h)} ${num(w)} ${num(h)} re f`);
  }
  build(): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add("");
    const pagesRoot = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds: number[] = [];
    for (const content of this.pages) {
      const stream = content.join("\n");
      const cid = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(this.pageSize.width)} ${num(this.pageSize.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`));
    }
    const info = add(`<< /Title ${hex(encode(this.title))} /Producer (IntraForge Spare Parts) >>`);
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, "latin1"));
  }
}
