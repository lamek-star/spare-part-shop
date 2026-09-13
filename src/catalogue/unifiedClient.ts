import { CatalogueClient } from "./client";
import { CatalogueProvider, capabilitiesFor } from "./providers";
import {
  Page,
  ReferenceHit,
  ReferenceDetail,
  BrowseOptions,
  DiagramDetail,
  VehicleMake,
  VehicleModel,
  VinLookupResult,
} from "./models";
type Disabled = {
  disabled: true;
  reason: string;
  capabilities: unknown;
  license: unknown;
};
const isDisabled = (v: unknown): v is Disabled =>
  Boolean(v && typeof v === "object" && (v as Disabled).disabled === true);
/**
 * One catalogue, blended from two sources: this application's own
 * first-party reference data (local demo fixtures, published CSV imports)
 * and the live Toyota EPC provider. Presents a single `CatalogueProvider`
 * surface — the same one `CatalogueClient` alone implements — so
 * `ReferenceCatalogue.tsx` (the sole catalogue page/nav item) doesn't need
 * to know two sources exist.
 *
 * Every Toyota-side call degrades silently to "local only" — a network
 * failure, a disabled-provider response, or Toyota simply not recognizing
 * a filter value it was never handed (e.g. a local variant id) all resolve
 * the same way: the merge just contributes nothing from that side. There
 * is no code path here where a Toyota outage can break browsing the local
 * catalogue, and no path where Toyota is queried while disabled — see
 * `ToyotaEpcProvider.guard()`, which every Toyota call still passes
 * through server-side regardless of what this class does.
 *
 * Ids stay disambiguated by their own shape rather than a "source" tag:
 * Toyota diagram ids are `"region/catalog/figure"` (see
 * `ToyotaEpcProvider.getDiagram`), Toyota part lookups use the bare OEM
 * number, and everything else is a local sha256-derived id — the two
 * never collide by construction.
 */
export class UnifiedCatalogueClient implements CatalogueProvider {
  readonly key = "unified-catalogue";
  readonly capabilities = capabilitiesFor("toyota-epc"); // superset; local already covers the rest
  private local: CatalogueClient;
  constructor(role: string) {
    this.local = new CatalogueClient(role);
  }
  async browse(filters: Record<string, string> = {}): Promise<BrowseOptions> {
    const [local, toyota] = await Promise.all([
      this.local.browse(filters),
      this.local.toyotaBrowse(filters).catch(() => undefined),
    ]);
    if (!toyota || isDisabled(toyota)) return local;
    return mergeBrowse(local, toyota);
  }
  async searchParts(
    query: string,
    page = 1,
    variant = "",
    category = "",
    year = "",
    engine = "",
    model = "",
    make = "",
  ): Promise<Page<ReferenceHit>> {
    const [local, toyota] = await Promise.all([
      this.local.searchParts(
        query,
        page,
        variant,
        category,
        year,
        engine,
        model,
        make,
      ),
      query.trim()
        ? this.local.toyotaSearchParts(query, page).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    if (!toyota || isDisabled(toyota)) return local;
    return {
      items: [...local.items, ...toyota.items],
      total: local.total + toyota.total,
      page,
      pageSize: local.pageSize,
    };
  }
  async getPart(id: string): Promise<ReferenceDetail> {
    try {
      return await this.local.getPart(id);
    } catch (localError) {
      try {
        const toyota = await this.local.toyotaPart(id);
        if (isDisabled(toyota)) throw localError;
        return toyota;
      } catch {
        throw localError;
      }
    }
  }
  async getDiagram(id: string): Promise<DiagramDetail> {
    if (id.includes("/")) {
      const [region, catalog, figure] = id.split("/");
      const result = await this.local.toyotaDiagram(region, catalog, figure);
      if (isDisabled(result))
        throw new Error(result.reason || "Toyota EPC diagram is unavailable.");
      return result;
    }
    return this.local.getDiagram(id);
  }
  async lookupVin(vin: string): Promise<VinLookupResult> {
    const result = await this.local.toyotaVin(vin);
    if (isDisabled(result))
      return { vin, supported: false, matches: [], provider: "toyota-epc" };
    return result;
  }
}
function mergeBrowse(
  local: BrowseOptions,
  toyota: BrowseOptions,
): BrowseOptions {
  const makes: VehicleMake[] = [...local.makes];
  const makeIdRemap = new Map<string, string>();
  for (const m of toyota.makes) {
    const existing = makes.find(
      (x) => x.name.toLowerCase() === m.name.toLowerCase(),
    );
    if (existing) makeIdRemap.set(m.id, existing.id);
    else {
      makes.push(m);
      makeIdRemap.set(m.id, m.id);
    }
  }
  const models: VehicleModel[] = [
    ...local.models,
    ...toyota.models.map((m) => ({
      ...m,
      makeId: makeIdRemap.get(m.makeId) ?? m.makeId,
    })),
  ];
  return {
    makes,
    models,
    variants: [...local.variants, ...toyota.variants],
    categories: [...local.categories, ...toyota.categories],
    diagrams: [...local.diagrams, ...toyota.diagrams],
  };
}
