export type NengunImportMode = "reference_only" | "licensed_import";
/**
 * `reference_only` (default): the provider records/links to source
 * material only — no extraction, no bulk fetch, no staged import.
 * `licensed_import`: requires a documented authorization/feed contract
 * before it takes effect (see docs/catalogues/NENGUN_SOURCE_REVIEW.md).
 * There is currently no transport implementation for this mode — see
 * provider.ts. Setting the environment variable alone does not enable
 * data extraction.
 */
export function nengunImportMode(): NengunImportMode {
  const raw = (
    typeof process !== "undefined" ? process.env?.NENGUN_IMPORT_MODE : ""
  )?.trim();
  return raw === "licensed_import" ? "licensed_import" : "reference_only";
}
