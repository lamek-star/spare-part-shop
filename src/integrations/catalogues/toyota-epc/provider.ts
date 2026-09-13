import {
  CatalogueProvider,
  capabilitiesFor,
} from "../../../catalogue/providers";
import {
  Page,
  ReferenceHit,
  ReferenceDetail,
  DiagramDetail,
  BrowseOptions,
  VinLookupResult,
  VehicleModel,
  VehicleVariant,
  Category,
  CatalogueDiagram,
} from "../../../catalogue/models";
import { normalizeNumber } from "../../../domain/models";
import { toyotaEpcEnabled, toyotaEpcConfig } from "./config";
import { fetchToyotaEpc } from "./transport";
import {
  ToyotaModel,
  ToyotaCatalog,
  ToyotaSection,
  ToyotaSectionSummary,
  ToyotaFigure,
  ToyotaPartGroup,
  ToyotaPartNumberLookup,
  ToyotaPartNumberHistory,
  ToyotaVinMatch,
  ToyotaSearchResult,
  ToyotaRegion,
} from "./types";
import {
  mapToyotaMake,
  mapToyotaModel,
  mapToyotaCatalogToVariant,
  mapToyotaCatalogueRecord,
  mapToyotaSection,
  mapToyotaFigure,
  mapToyotaVin,
  mapToyotaSupersessionEdges,
  mapToyotaSectionDiagramStub,
  catalogVariantId,
} from "./mapper";
/**
 * Live, read-through adapter for the Toyota EPC aggregator
 * (aftermarketcatalog.com). Every method calls `fetchToyotaEpc`, which
 * refuses outright when TOYOTA_EPC_ENABLED is not "true" — see config.ts.
 *
 * This class never writes to the local reference-catalogue store. There
 * is no code path here that persists a record, caches an image, or runs
 * unattended — every call is a single, operator/user-triggered lookup
 * that maps a live response straight into the return value. That is the
 * actual enforcement of `persistentStorageAllowed: false` /
 * `imageStorageAllowed: false` / `bulkSyncAllowed: false`
 * (providerPolicy.ts): those flags describe what this class deliberately
 * does not do, not a runtime check inside a write path that doesn't
 * exist. `sync.ts` is the one place a future bulk-sync entry point would
 * go, and it asserts the same policy before doing anything.
 *
 * Implements the shared `CatalogueProvider` contract (so it is
 * interchangeable with the local client and NengunProvider) plus a richer
 * native surface — `getModels`, `getVehicle`, `getSections`, `getFigure`,
 * `getPartNumber`, `lookupVIN`, `search` — that the dedicated Toyota EPC
 * UI calls directly, since vehicle-tree navigation needs more structure
 * than the generic `browse()` shape carries.
 */
export class ToyotaEpcProvider implements CatalogueProvider {
  readonly key = "toyota-epc";
  readonly capabilities = capabilitiesFor("toyota-epc");
  private guard() {
    if (!toyotaEpcEnabled())
      throw new Error(
        'toyota-epc: provider is disabled (TOYOTA_EPC_ENABLED is not "true"). See docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md.',
      );
  }
  // ---- shared CatalogueProvider surface ----
  async browse(filters: Record<string, string> = {}): Promise<BrowseOptions> {
    this.guard();
    const region = (filters.market || toyotaEpcConfig().defaultRegion) as
      "EU" | "GR" | "US" | "JP";
    const make = mapToyotaMake();
    const models: VehicleModel[] = [];
    const variants: VehicleVariant[] = [];
    const categories: Category[] = [];
    const diagrams: CatalogueDiagram[] = [];
    if (filters.model) {
      const detail = await this.getModel(region, filters.model);
      const { model } = mapToyotaModel(detail);
      models.push(model);
      for (const catalog of detail.catalogs)
        variants.push(mapToyotaCatalogToVariant(catalog, model.id));
      if (filters.variant) {
        const catalog = detail.catalogs.find(
          (c) => `${c.region}/${c.catalog_code}` === filters.variant,
        );
        if (catalog) {
          const catalogueRecord = mapToyotaCatalogueRecord(
            catalog,
            catalogVariantId(catalog),
          );
          const sections = await this.getSections(region, catalog.catalog_code);
          for (const section of sections) {
            const category = mapToyotaSection(section, catalogueRecord.id);
            categories.push(category);
            if (filters.category === section.section_code) {
              const stub = mapToyotaSectionDiagramStub(
                section,
                region,
                catalog.catalog_code,
                catalogueRecord.id,
                catalogVariantId(catalog),
                category.id,
              );
              if (stub) diagrams.push(stub);
            }
          }
        }
      }
    } else {
      // No model chosen yet: list every model, the same way picking "All
      // models" for any other make shows every model under it. Without
      // this, selecting Toyota as the make would leave the Model dropdown
      // empty until the user already knew a model slug — see
      // tests/toyota-epc-provider.test.ts.
      const list = await this.getModels(region);
      for (const m of list) models.push(mapToyotaModel(m).model);
    }
    return { makes: [make], models, variants, categories, diagrams };
  }
  async getDiagram(id: string): Promise<DiagramDetail> {
    this.guard();
    const [region, catalogCode, figureKey] = id.split("/");
    if (!region || !catalogCode || !figureKey)
      throw new Error(
        'toyota-epc: getDiagram id must be "REGION/CATALOG_CODE/FIGURE_KEY".',
      );
    const figure = await this.getFigure(
      region as "EU" | "GR" | "US" | "JP",
      catalogCode,
      figureKey,
    );
    const variantId = catalogVariantId({ region, catalog_code: catalogCode });
    const categoryId = ""; // section membership is not carried on the figure response itself
    const mapped = mapToyotaFigure(figure, variantId, categoryId);
    return {
      diagram: mapped.diagram,
      callouts: mapped.callouts,
      parts: mapped.parts.map((part) => ({
        part,
        numbers: mapped.numbers.filter((n) => n.partId === part.id),
      })),
    };
  }
  async searchParts(query: string, page = 1): Promise<Page<ReferenceHit>> {
    this.guard();
    const result = await this.search(query);
    const hits: ReferenceHit[] = result.results.part_numbers.map((p) => ({
      part: {
        id: p.part_number,
        manufacturer: "Toyota",
        description: `${p.model_name} — part group ${p.pnc}`,
        catalogueDescription: `${p.model_name} — part group ${p.pnc}`,
        categoryId: p.section_code,
        catalogueId: `${p.region}/${p.catalog_code}`,
        status: "Active",
        notes: "",
        version: 1,
        provenance: {
          sourceProvider: "toyota-epc",
          sourceRecordId: p.part_number,
          sourceUrl: "",
          sourceCatalogue: p.catalog_code,
          retrievedAt: new Date().toISOString(),
          importBatchId: "live-lookup",
          verification: "SOURCE_VERIFIED",
          licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
        },
      },
      numbers: [
        {
          id: p.part_number,
          partId: p.part_number,
          original: p.part_number,
          normalized: normalizeNumber(p.part_number),
          type: "OEM_OE",
          manufacturer: "Toyota",
          market: p.region,
          primary: true,
          active: true,
          notes: "",
          provenance: {
            sourceProvider: "toyota-epc",
            sourceRecordId: p.part_number,
            sourceUrl: "",
            sourceCatalogue: p.catalog_code,
            retrievedAt: new Date().toISOString(),
            importBatchId: "live-lookup",
            verification: "SOURCE_VERIFIED",
            licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
          },
        },
      ],
    }));
    return {
      items: hits.slice((page - 1) * 20, page * 20),
      total: hits.length,
      page,
      pageSize: 20,
    };
  }
  async getPart(id: string): Promise<ReferenceDetail> {
    this.guard();
    const lookup = await this.getPartNumber(id);
    const partId = lookup.part_number;
    const provenance = {
      sourceProvider: "toyota-epc",
      sourceRecordId: partId,
      sourceUrl: "",
      sourceCatalogue: "",
      retrievedAt: new Date().toISOString(),
      importBatchId: "live-lookup",
      verification: "SOURCE_VERIFIED" as const,
      licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
    };
    const applications = Object.entries(lookup.applications).flatMap(
      ([region, apps]) => apps.map((a) => ({ region, ...a })),
    );
    return {
      part: {
        id: partId,
        manufacturer: "Toyota",
        description: lookup.names[0] ?? partId,
        catalogueDescription: lookup.names.join(" / "),
        categoryId: "",
        catalogueId: "",
        status: "Active",
        notes: `Part group(s): ${lookup.pncs.join(", ")}.`,
        version: 1,
        provenance,
      },
      numbers: [
        {
          id: partId,
          partId,
          original: lookup.part_number_display,
          normalized: normalizeNumber(lookup.part_number),
          type: "OEM_OE",
          manufacturer: "Toyota",
          market: applications[0]?.region ?? "",
          primary: true,
          active: true,
          notes: "",
          provenance,
        },
      ],
      fitments: applications.map((a) => ({
        id: `${a.region}-${a.catalog_code}-${a.part_id}`,
        partId,
        variantId: catalogVariantId({
          region: a.region,
          catalog_code: a.catalog_code,
        }),
        yearFrom: Number((a.valid.from ?? "").slice(0, 4)) || 0,
        yearTo: Number((a.valid.to ?? "").slice(0, 4)) || 0,
        engine: "",
        engineCode: "",
        chassis: a.catalog_code,
        transmission: "",
        market: a.region,
        position: "",
        notes: "",
        vehicle: a.model_name,
        provenance,
      })),
      crossReferences: [],
      diagrams: [],
      source: {
        id: "toyota-epc",
        providerKey: "toyota-epc",
        name: "Toyota parts catalogue (aftermarketcatalog.com)",
        type: "WEB_REFERENCE",
        url: "https://toyota-epc.aftermarketcatalog.com",
        manufacturer: "Toyota",
        market: "Multiple",
        licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
        redistributionStatus: "Not confirmed",
        imageUsageStatus: "EXTERNAL_REFERENCE",
        feedAvailability: "Live JSON API",
        lastChecked: new Date().toISOString(),
        notes:
          "Independent aggregator; see docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md.",
        active: toyotaEpcEnabled(),
      },
    };
  }
  async lookupVin(vin: string): Promise<VinLookupResult> {
    this.guard();
    const matches = await fetchToyotaEpc<ToyotaVinMatch[]>(
      `/api/v1/vin/${encodeURIComponent(vin)}`,
    );
    return mapToyotaVin(vin, matches);
  }
  // ---- native EPC surface ----
  async getRegions(): Promise<ToyotaRegion[]> {
    this.guard();
    return fetchToyotaEpc<ToyotaRegion[]>("/api/v1/regions");
  }
  async getModels(region: string): Promise<ToyotaModel[]> {
    this.guard();
    return fetchToyotaEpc<ToyotaModel[]>(`/api/v1/regions/${region}/models`);
  }
  async getModel(region: string, slug: string): Promise<ToyotaModel> {
    this.guard();
    return fetchToyotaEpc<ToyotaModel>(
      `/api/v1/regions/${region}/models/${slug}`,
    );
  }
  async getVehicle(
    region: string,
    catalogCode: string,
  ): Promise<ToyotaCatalog> {
    this.guard();
    return fetchToyotaEpc<ToyotaCatalog>(
      `/api/v1/catalogs/${region}/${catalogCode}`,
    );
  }
  async getSections(
    region: string,
    catalogCode: string,
  ): Promise<ToyotaSectionSummary[]> {
    this.guard();
    return fetchToyotaEpc<ToyotaSectionSummary[]>(
      `/api/v1/catalogs/${region}/${catalogCode}/sections`,
    );
  }
  async getVehicleGroups(
    region: string,
    catalogCode: string,
    sectionCode: string,
  ): Promise<ToyotaSection> {
    this.guard();
    return fetchToyotaEpc<ToyotaSection>(
      `/api/v1/catalogs/${region}/${catalogCode}/sections/${sectionCode}`,
    );
  }
  async getPartGroup(
    region: string,
    catalogCode: string,
    pnc: string,
  ): Promise<ToyotaPartGroup> {
    this.guard();
    return fetchToyotaEpc<ToyotaPartGroup>(
      `/api/v1/catalogs/${region}/${catalogCode}/groups/${encodeURIComponent(pnc)}`,
    );
  }
  async getFigure(
    region: string,
    catalogCode: string,
    figureKey: string,
  ): Promise<ToyotaFigure> {
    this.guard();
    return fetchToyotaEpc<ToyotaFigure>(
      `/api/v1/catalogs/${region}/${catalogCode}/figures/${encodeURIComponent(figureKey)}`,
    );
  }
  async getPartNumber(number: string): Promise<ToyotaPartNumberLookup> {
    this.guard();
    return fetchToyotaEpc<ToyotaPartNumberLookup>(
      `/api/v1/part-numbers/${encodeURIComponent(normalizeNumber(number))}`,
    );
  }
  async getPartCompatibility(
    number: string,
  ): Promise<ToyotaPartNumberLookup["applications"]> {
    return (await this.getPartNumber(number)).applications;
  }
  async getPartNumberHistory(number: string): Promise<ToyotaPartNumberHistory> {
    this.guard();
    return fetchToyotaEpc<ToyotaPartNumberHistory>(
      `/api/v1/part-numbers/${encodeURIComponent(normalizeNumber(number))}/history`,
    );
  }
  async getSupersessions(number: string, region: string) {
    return mapToyotaSupersessionEdges(
      await this.getPartNumberHistory(number),
      region,
    );
  }
  async search(query: string, region?: string): Promise<ToyotaSearchResult> {
    this.guard();
    return fetchToyotaEpc<ToyotaSearchResult>("/api/v1/search", {
      q: query,
      region,
    });
  }
  async lookupVIN(vin: string): Promise<VinLookupResult> {
    return this.lookupVin(vin);
  }
}
export const toyotaEpcProvider = new ToyotaEpcProvider();
