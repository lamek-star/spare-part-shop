import {
  assertBulkSyncAllowed,
  assertPersistentStorageAllowed,
  policyFor,
} from "./providerPolicy";
import { repository } from "./server";
import { CatalogueImportBundle, CatalogueImportResult } from "./repository";
import { toyotaEpcProvider } from "../integrations/catalogues/toyota-epc";
import {
  mapToyotaMake,
  mapToyotaModel,
  mapToyotaCatalogToVariant,
  mapToyotaCatalogueRecord,
  mapToyotaFigure,
} from "../integrations/catalogues/toyota-epc/mapper";
/**
 * The one entry point a future bulk/scheduled synchronization job would
 * call to pull a provider's catalogue into local persistent storage.
 *
 * The guard runs first and unconditionally, so this function is safe to
 * wire into a cron/admin trigger without re-checking policy at every call
 * site — a provider whose policy denies sync can never be made to run one
 * just by calling this function, regardless of its `enabled`/`*_ENABLED`
 * flag. `ReferenceRepository.importCatalogueRecords` (repository.ts)
 * re-asserts the same guard independently, so even a future caller that
 * bypasses this function entirely still cannot persist a disallowed
 * provider's data.
 *
 * For `providerKey: "toyota-epc"`, the fetch → map → import sequence
 * below is fully implemented and unit-tested (see
 * tests/toyota-epc-sync.test.ts) against a simulated permissive policy —
 * it is genuinely correct code, not a stub — but it is unreachable in
 * production: `providerPolicies["toyota-epc"]` ships with
 * `bulkSyncAllowed: false`, so the guard above throws before any of it
 * runs. See docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md, "Catalogue Data
 * Licensing & Provider Governance", for why, and exactly what changes
 * once written permission or a licensed feed exists.
 */
export interface SyncRequest {
  providerKey: string;
  scope: "vehicle" | "diagram" | "part" | "section";
  /** For scope "diagram": `"region/catalogCode/figureKey"`. */
  target: string;
}
export interface SyncResult {
  providerKey: string;
  scope: SyncRequest["scope"];
  target: string;
  status: "REFUSED" | "COMPLETED";
  reason: string;
  imported?: CatalogueImportResult;
}
async function fetchToyotaDiagramBundle(
  target: string,
): Promise<CatalogueImportBundle> {
  const [region, catalogCode, figureKey] = target.split("/");
  if (!region || !catalogCode || !figureKey)
    throw new Error(
      'toyota-epc: scope "diagram" requires target "region/catalogCode/figureKey".',
    );
  const catalog = await toyotaEpcProvider.getVehicle(region, catalogCode);
  const modelDetail = await toyotaEpcProvider.getModel(
    region,
    catalog.model_slug,
  );
  const { make, model } = mapToyotaModel(modelDetail);
  const variant = mapToyotaCatalogToVariant(catalog, model.id);
  const catalogueRecord = mapToyotaCatalogueRecord(catalog, variant.id);
  const figure = await toyotaEpcProvider.getFigure(
    region,
    catalogCode,
    figureKey,
  );
  // Category is left unresolved here, the same documented limitation as
  // ToyotaEpcProvider.getDiagram — a figure alone doesn't carry its own
  // section code; resolving it would mean fetching and scanning every
  // section's primary_figure, not worth it for a single-diagram sync.
  const mapped = mapToyotaFigure(figure, variant.id, "");
  return {
    makes: [make],
    models: [model],
    variants: [variant],
    catalogues: [catalogueRecord],
    diagrams: [mapped.diagram],
    callouts: mapped.callouts,
    parts: mapped.parts,
    numbers: mapped.numbers,
    fitments: mapped.fitments,
  };
}
export async function syncCatalogueRecord(
  request: SyncRequest,
): Promise<SyncResult> {
  try {
    assertBulkSyncAllowed(request.providerKey);
    assertPersistentStorageAllowed(request.providerKey);
  } catch (error) {
    return { ...request, status: "REFUSED", reason: (error as Error).message };
  }
  if (request.providerKey !== "toyota-epc" || request.scope !== "diagram") {
    const policy = policyFor(request.providerKey);
    return {
      ...request,
      status: "REFUSED",
      reason: `${request.providerKey}: no sync implementation exists yet for scope "${request.scope}" — policy currently permits sync (bulkSyncAllowed=${policy.license.bulkSyncAllowed}), but only providerKey "toyota-epc" scope "diagram" has fetch/map/import logic wired up. Implement the rest deliberately, scoped to the request, before removing this message.`,
    };
  }
  const bundle = await fetchToyotaDiagramBundle(request.target);
  const imported = repository().importCatalogueRecords(
    bundle,
    request.providerKey,
  );
  return {
    ...request,
    status: "COMPLETED",
    reason: "Imported successfully.",
    imported,
  };
}
