import { numberTypes } from "../domain/models";
import {
  CsvField,
  ColumnMapping,
  ImportRecord,
  Page,
  ReferenceHit,
  ReferenceDetail,
  DiagramDetail,
  BrowseOptions,
  VinLookupResult,
} from "./models";
import { ProviderCapabilities, policyFor } from "./providerPolicy";
/**
 * The contract both the internal reference-catalogue client and every
 * external catalogue adapter implement, so UI components never depend on
 * a specific provider's response shapes (see
 * docs/CATALOG_PROVIDER_INTEGRATION.md). `capabilities` lets the frontend
 * adapt what it offers (e.g. hide the VIN box) without a provider-specific
 * `if`; `lookupVin` is optional because most providers do not support it.
 */
export interface CatalogueProvider {
  readonly key: string;
  readonly capabilities: ProviderCapabilities;
  searchParts(query: string, page: number): Promise<Page<ReferenceHit>>;
  getPart(id: string): Promise<ReferenceDetail>;
  browse(filters: Record<string, string>): Promise<BrowseOptions>;
  getDiagram(id: string): Promise<DiagramDetail>;
  lookupVin?(vin: string): Promise<VinLookupResult>;
}
export const capabilitiesFor = (providerKey: string): ProviderCapabilities =>
  policyFor(providerKey).capabilities;
export interface FeedProvider {
  key: string;
  format:
    | "CSV"
    | "JSON"
    | "XML"
    | "API"
    | "SUPPLIER_FEED"
    | "MANUAL"
    | "WEB_REFERENCE";
  read(input: string): Promise<unknown[]>;
}
export class DisabledProvider implements FeedProvider {
  constructor(
    public key: string,
    public format: FeedProvider["format"],
  ) {}
  async read(_input: string): Promise<unknown[]> {
    throw new Error(
      `${this.key}: provider disabled until a licensed feed/contract and access policy are supplied.`,
    );
  }
}
export const providerExtensions = {
  json: new DisabledProvider("json", "JSON"),
  xml: new DisabledProvider("xml", "XML"),
  api: new DisabledProvider("licensed-api", "API"),
  supplier: new DisabledProvider("supplier-feed", "SUPPLIER_FEED"),
  manual: new DisabledProvider("manual", "MANUAL"),
  nengun: new DisabledProvider("nengun", "WEB_REFERENCE"),
};
export function safeSourceUrl(value: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.hostname.includes(".") &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(
        u.hostname,
      ) &&
      !u.hostname.endsWith(".local") &&
      !u.hostname.endsWith(".internal")
    );
  } catch {
    return false;
  }
}
export function parseCsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  if (new TextEncoder().encode(text).length > 2_000_000)
    throw new Error("CSV exceeds 2 MB.");
  if (!text.trim()) throw new Error("CSV is empty.");
  text = text.replace(/^\uFEFF/, "");
  const output: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    afterQuote = false;
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
      } else field += ch;
    } else if (ch === '"') {
      if (field || afterQuote) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (ch === "," || ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      afterQuote = false;
      if (ch !== ",") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v !== "")) output.push(row);
        row = [];
        if (output.length > 1001)
          throw new Error("Maximum 1,000 rows per batch.");
      }
    } else {
      if (afterQuote)
        throw new Error("Unexpected text after quoted CSV field.");
      field += ch;
    }
    if (field.length > 4096 || row.length > 50)
      throw new Error("CSV field or column limit exceeded.");
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (field || row.length) {
    row.push(field);
    output.push(row);
  }
  const headers = output.shift()?.map((h) => h.trim()) ?? [];
  if (
    !headers.length ||
    headers.length > 50 ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !h || ["__proto__", "constructor", "prototype"].includes(h),
    )
  )
    throw new Error("Headers must be unique, nonempty and safe.");
  if (output.length > 1000 || output.some((r) => r.length !== headers.length))
    throw new Error("CSV row count or column count is invalid.");
  return { headers, rows: output };
}
export function mapRecord(
  headers: string[],
  row: string[],
  mapping: ColumnMapping,
): { record: ImportRecord; errors: string[]; warnings: string[] } {
  const value = (field: CsvField) => {
    const index = headers.indexOf(mapping[field] ?? "");
    return index < 0 ? "" : row[index];
  };
  const errors: string[] = [];
  for (const cell of row) {
    if (/^[\s]*[=+@-]/.test(cell)) errors.push("Formula-like field rejected.");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(cell))
      errors.push("Control character rejected.");
  }
  for (const required of [
    "manufacturer",
    "part_number",
    "description",
    "vehicle_make",
    "vehicle_model",
    "year_from",
    "year_to",
  ] as CsvField[])
    if (!value(required).trim()) errors.push(`${required} is required.`);
  const yearFrom = Number(value("year_from")),
    yearTo = Number(value("year_to"));
  if (
    !Number.isInteger(yearFrom) ||
    !Number.isInteger(yearTo) ||
    yearFrom < 1900 ||
    yearTo > 2100 ||
    yearFrom > yearTo
  )
    errors.push("Invalid production year range.");
  const type = value("part_number_type") || "OEM_OE";
  if (!numberTypes.includes(type as (typeof numberTypes)[number]))
    errors.push("Unknown part number type.");
  if (!safeSourceUrl(value("source_url")))
    errors.push(
      "Source URL must be a public HTTPS address without credentials or ports.",
    );
  const record: ImportRecord = {
    sourceRecordId: value("source_record_id"),
    manufacturer: value("manufacturer"),
    number: value("part_number"),
    numberType: type as ImportRecord["numberType"],
    description: value("description"),
    make: value("vehicle_make"),
    model: value("vehicle_model"),
    chassis: value("chassis"),
    engine: value("engine"),
    engineCode: value("engine_code"),
    yearFrom,
    yearTo,
    category: value("category") || "Uncategorized",
    sourceUrl: value("source_url"),
    catalogue: value("catalogue") || value("source") || "Uploaded catalogue",
    market: value("market") || "Unspecified",
  };
  return {
    record,
    errors: [...new Set(errors)],
    warnings: [
      "Fitment and identifiers remain UNVERIFIED. No images are imported from URLs.",
    ],
  };
}
export class CsvCatalogueProvider implements FeedProvider {
  key = "company-csv";
  format = "CSV" as const;
  async read(text: string) {
    return parseCsv(text).rows;
  }
}
/** Transport supplied only after a provider is authorized. No URL fetch implementation or arbitrary URL retrieval. */
export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
  attempts = 3,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i >= Math.min(attempts, 3) - 1) throw error;
      await wait(250 * 2 ** i);
    }
  }
}
