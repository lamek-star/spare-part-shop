import type { CatalogueProvider } from "./providers";
import { capabilitiesFor } from "./providers";
import type {
  Page,
  ReferenceHit,
  ReferenceDetail,
  BrowseOptions,
  DiagramDetail,
  AdminOverview,
  ImportBatch,
  StagedRecord,
} from "./models";
export type BatchView = {
  batch: Omit<ImportBatch, "records" | "csv">;
  records: Page<StagedRecord>;
};
export class CatalogueClient implements CatalogueProvider {
  readonly key = "local-reference";
  readonly capabilities = capabilitiesFor("local-reference");
  constructor(private role: string) {}
  private async request<T>(
    query: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(
      "/api/catalogue?" + new URLSearchParams(query),
      {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "x-demo-role": this.role,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Catalogue request failed.");
    return result as T;
  }
  searchParts(
    query: string,
    page = 1,
    variant = "",
    category = "",
    year = "",
    engine = "",
    model = "",
    make = "",
  ) {
    return this.request<Page<ReferenceHit>>({
      action: "search",
      q: query,
      page: String(page),
      variant,
      category,
      year,
      engine,
      model,
      make,
    });
  }
  getPart(id: string) {
    return this.request<ReferenceDetail>({ action: "part", id });
  }
  browse(filters: Record<string, string> = {}) {
    return this.request<BrowseOptions>({ action: "browse", ...filters });
  }
  getDiagram(id: string) {
    return this.request<DiagramDetail>({ action: "diagram", id });
  }
  admin() {
    return this.request<AdminOverview>({ action: "admin" });
  }
  providers() {
    return this.request<import("./providerPolicy").ProviderPolicy[]>({
      action: "providers",
    });
  }
  toyotaStatus() {
    return this.request<
      { enabled: boolean } & import("./providerPolicy").ProviderPolicy
    >({ action: "toyota-status" });
  }
  batch(id: string, page = 1) {
    return this.request<BatchView>({ action: "batch", id, page: String(page) });
  }
  command<T = BatchView>(body: Record<string, unknown>) {
    return this.request<T>({}, body);
  }
  // ---- Toyota EPC (disabled by default — see docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md) ----
  private toyota<T>(action: string, params: Record<string, string> = {}) {
    return this.request<
      | T
      | {
          disabled: true;
          reason: string;
          capabilities: unknown;
          license: unknown;
        }
    >({ action, ...params });
  }
  toyotaModels(region = "EU") {
    return this.toyota<
      import("../integrations/catalogues/toyota-epc/types").ToyotaModel[]
    >("toyota-models", { region });
  }
  toyotaModel(slug: string, region = "EU") {
    return this.toyota<
      import("../integrations/catalogues/toyota-epc/types").ToyotaModel
    >("toyota-model", { region, slug });
  }
  toyotaSections(catalog: string, region = "EU") {
    return this.toyota<
      import("../integrations/catalogues/toyota-epc/types").ToyotaSectionSummary[]
    >("toyota-sections", { region, catalog });
  }
  toyotaDiagram(region: string, catalog: string, figure: string) {
    return this.toyota<DiagramDetail>("toyota-diagram", {
      region,
      catalog,
      figure,
    });
  }
  toyotaPart(number: string) {
    return this.toyota<ReferenceDetail>("toyota-part", { number });
  }
  toyotaSearch(q: string, region = "EU") {
    return this.toyota<
      import("../integrations/catalogues/toyota-epc/types").ToyotaSearchResult
    >("toyota-search", { q, region });
  }
  toyotaHistory(number: string, region = "EU") {
    return this.toyota<
      { from: string; to: string; effective: string | null }[]
    >("toyota-history", { number, region });
  }
  toyotaVin(vin: string) {
    return this.toyota<import("./models").VinLookupResult>("toyota-vin", {
      vin,
    });
  }
}
