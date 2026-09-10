import type { CatalogueProvider } from "./providers";
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
  batch(id: string, page = 1) {
    return this.request<BatchView>({ action: "batch", id, page: String(page) });
  }
  command<T = BatchView>(body: Record<string, unknown>) {
    return this.request<T>({}, body);
  }
}
