/**
 * Pure, browser-safe parsing helpers for the admin catalogue warm-up/
 * import feature — deliberately split out of importRunner.ts (which
 * pulls in importStore.ts's node:fs-based job store) so the admin UI
 * component (CatalogueImportAdmin.tsx, a client component) can import
 * these without dragging server-only code into the browser bundle.
 */
export interface ImportLine {
  part_number: string;
  manufacturer?: string;
  notes?: string;
  internal_sku?: string;
  /** Vehicle catalogue code the drawing should come from, e.g. 221230. */
  catalogue?: string;
}

export const MAX_IMPORT_ITEMS = 500;
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_DELAY_MS = 750;

/** Splits a pasted multi-line block into one line per part number. Blank
 * lines and surrounding whitespace are dropped; nothing else about the
 * text is interpreted (no CSV parsing here — see importLinesFromCsv). */
export function parseImportLines(raw: string): ImportLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // "15600-25010" or "15600-25010, 221230" (part number, optional
      // vehicle catalogue code the drawing should come from).
      const [part_number, catalogue] = line
        .split(/[,;\t]/)
        .map((c) => c.trim());
      return catalogue ? { part_number, catalogue } : { part_number };
    });
}

/** Builds ImportLine[] from parseCsv()'s generic {headers, rows} shape —
 * minimum required column `part_number`; `manufacturer`/`notes`/
 * `internal_sku` are optional and carried through for display only (no
 * IntraForge field exists yet to persist them — see final report). */
export function importLinesFromCsv(parsed: {
  headers: string[];
  rows: string[][];
}): ImportLine[] {
  const idx = (name: string) =>
    parsed.headers.findIndex((h) => h.trim().toLowerCase() === name);
  const partCol = idx("part_number");
  if (partCol === -1)
    throw new Error('CSV must include a "part_number" column.');
  const mfrCol = idx("manufacturer");
  const notesCol = idx("notes");
  const skuCol = idx("internal_sku");
  const catCol = Math.max(idx("catalogue"), idx("catalog"));
  return parsed.rows
    .map((row) => ({
      part_number: (row[partCol] ?? "").trim(),
      manufacturer: mfrCol >= 0 ? (row[mfrCol] ?? "").trim() : undefined,
      notes: notesCol >= 0 ? (row[notesCol] ?? "").trim() : undefined,
      internal_sku: skuCol >= 0 ? (row[skuCol] ?? "").trim() : undefined,
      catalogue:
        catCol >= 0 ? (row[catCol] ?? "").trim() || undefined : undefined,
    }))
    .filter((r) => r.part_number);
}
