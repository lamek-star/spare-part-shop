/**
 * CSV reading and writing for untrusted files.
 *
 * Reading never executes or interprets anything: every cell is data. The
 * parser tolerates a UTF-8 BOM, CRLF/LF/CR line endings, quoted fields with
 * embedded commas, quotes and newlines, and it reports (rather than
 * throws on) a row with the wrong number of columns, so a single bad row
 * can be shown to the operator instead of losing the whole file.
 *
 * Writing (spreadsheet exports) neutralizes formula injection: a cell that
 * would start a formula in Excel/Sheets is prefixed with an apostrophe.
 */
export interface CsvLimits {
  maxBytes: number;
  maxRows: number;
  maxColumns: number;
  maxFieldLength: number;
}
export const defaultCsvLimits: CsvLimits = {
  maxBytes: 100 * 1024 * 1024,
  maxRows: 500_000,
  maxColumns: 80,
  maxFieldLength: 8192,
};
export interface CsvRow {
  /** 1-based line number of the row's first line in the file (header = 1). */
  line: number;
  cells: string[];
  /** Set when the row's column count differs from the header's. */
  shapeError?: string;
}
export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}
export class CsvError extends Error {}

export function parseCsv(input: string | Uint8Array, limits: Partial<CsvLimits> = {}): ParsedCsv {
  const l = { ...defaultCsvLimits, ...limits };
  const bytes = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
  if (bytes > l.maxBytes) throw new CsvError(`File is larger than ${Math.round(l.maxBytes / 1024 / 1024)} MB.`);
  let text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new CsvError("The file is empty.");

  const all: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => {
    if (field.length > l.maxFieldLength) throw new CsvError(`A field on line ${rowLine} is longer than ${l.maxFieldLength} characters.`);
    row.push(field);
    field = "";
    afterQuote = false;
    if (row.length > l.maxColumns) throw new CsvError(`Line ${rowLine} has more than ${l.maxColumns} columns.`);
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== "")) {
      all.push({ line: rowLine, cells: row });
      if (all.length > l.maxRows + 1) throw new CsvError(`The file has more than ${l.maxRows.toLocaleString("en-US")} rows.`);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field !== "" || afterQuote) throw new CsvError(`Unexpected quote on line ${line}.`);
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      if (afterQuote) throw new CsvError(`Unexpected text after a quoted field on line ${line}.`);
      field += ch;
    }
  }
  if (quoted) throw new CsvError("A quoted field is never closed.");
  if (field !== "" || row.length) endRow();

  const header = all.shift();
  if (!header) throw new CsvError("The file has no header row.");
  const headers = header.cells.map((h) => h.trim());
  if (headers.some((h) => !h)) throw new CsvError("Every column needs a heading.");
  const seen = new Set<string>();
  for (const h of headers) {
    const k = h.toLowerCase();
    if (seen.has(k)) throw new CsvError(`The column heading "${h}" appears twice.`);
    if (["__proto__", "constructor", "prototype"].includes(k)) throw new CsvError(`"${h}" is not a permitted column heading.`);
    seen.add(k);
  }
  const rows: CsvRow[] = all.map((r) => ({
    line: r.line,
    cells: r.cells,
    ...(r.cells.length !== headers.length
      ? { shapeError: `Expected ${headers.length} columns but found ${r.cells.length}.` }
      : {}),
  }));
  return { headers, rows };
}

/** True when a spreadsheet would treat the text as a formula. */
export const looksLikeFormula = (value: string) => /^[\t\r ]*[=+\-@]/.test(value) && !/^[+-]?\d+([.,]\d+)*$/.test(value.trim());

/** One CSV cell, quoted when needed and defused against formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (looksLikeFormula(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
