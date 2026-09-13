/**
 * Raw response shapes for https://toyota-epc.aftermarketcatalog.com/api/v1,
 * an independent (non-Toyota) aggregator — see config.ts and
 * docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md for the licensing posture.
 *
 * Every field here was observed in a live response captured on
 * 2026-09-13 (see tests/fixtures/toyota-epc/), not assumed from the HTML
 * documentation. Fields the docs mention but a capture didn't exercise are
 * marked optional even where the API likely always sends them, since
 * "probably always present" is not the same as verified.
 */
export interface ToyotaEnvelope<T> {
  data: T;
}
export interface ToyotaLinks {
  [rel: string]: string | undefined;
}
export interface ToyotaRegion {
  region: string;
  name: string;
  catalog_count: number;
  has_prices: boolean;
  links: ToyotaLinks;
}
export interface ToyotaCatalogSummary {
  region: string;
  catalog_code: string;
  model_name: string;
  model_family: string;
  model_slug: string;
  chassis_codes: string[];
  group_code: string;
  production: { from: string | null; to: string | null; current: boolean };
  dataset_code: string;
  data_version: string;
  discontinued: boolean;
  links: ToyotaLinks;
}
export interface ToyotaModel {
  region: string;
  name: string;
  slug: string;
  catalog_count: number;
  years: { from: number | null; to: number | null; current: boolean };
  chassis_codes: string[];
  links: ToyotaLinks;
  catalogs: ToyotaCatalogSummary[];
}
export interface ToyotaCatalog extends ToyotaCatalogSummary {
  part_line_count?: number;
  model_period?: string;
}
export interface ToyotaSectionSummary {
  section_code: string;
  name: string;
  part_group_count: number;
  primary_figure: string | null;
  thumbnail_url: string | null;
  links: ToyotaLinks;
}
export interface ToyotaPartGroupSummary {
  pnc: string;
  name: string;
  links: ToyotaLinks;
}
export interface ToyotaSection {
  section_code: string;
  name: string;
  part_groups: ToyotaPartGroupSummary[];
}
export interface ToyotaFitmentCode {
  code: string;
  meaning: string | null;
  attribute: string | null;
}
export interface ToyotaPart {
  part_id: number;
  region: string;
  catalog_code: string;
  pnc: string;
  part_number: string;
  part_number_display: string;
  suffix: string | null;
  name: string;
  model_period: string | null;
  valid: { from: string | null; to: string | null };
  is_current: boolean;
  unverified: Record<string, string | null>;
  trim_codes: string[] | null;
  links: ToyotaLinks;
  fitment: ToyotaFitmentCode[];
  /** Always null in every observed response — the source catalogue
   * records which parts a vehicle takes, never a quantity. See
   * docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md, "What the API does not
   * contain". Never synthesized by the mapper. */
  price: unknown | null;
  has_remarks: boolean;
  quantity: null;
}
export interface ToyotaPartGroup {
  pnc: string;
  name: string;
  catalog: { region: string; catalog_code: string };
  figures: string[];
  parts: ToyotaPart[];
}
export interface ToyotaHotspot {
  seq: number;
  label: string;
  key_type: string;
  pnc: string;
  name: string;
  part_count: number;
  /** False for the ~18% of callouts that point at a standard fastener
   * with no parts-list entry behind them (see api/v1 caveats). */
  resolved: boolean;
  rect: { x1: number; y1: number; x2: number; y2: number };
}
export interface ToyotaFigure {
  figure_key: string;
  dataset: string;
  catalog: { region: string; catalog_code: string };
  image: { url: string; thumbnail_url: string; source_bytes: number };
  hotspots: ToyotaHotspot[];
  /** Present on the figure endpoint in addition to the per-group endpoint
   * — every part line for every hotspot on this drawing, in one call. */
  parts: ToyotaPart[];
  also_in_catalogs: { catalog_code: string; model_name: string }[];
}
export interface ToyotaPartNumberLookup {
  part_number: string;
  part_number_display: string;
  names: string[];
  pncs: string[];
  prices: {
    region: string;
    part_number: string;
    suffix: string | null;
    amount: number;
    currency: string;
    kind: string;
  }[];
  applications: Record<
    string,
    {
      catalog_code: string;
      model_name: string;
      pnc: string;
      suffix: string | null;
      valid: { from: string | null; to: string | null };
      is_current: boolean;
      part_id: number;
      links: ToyotaLinks;
    }[]
  >;
}
export interface ToyotaSupersessionEdge {
  old_part: string;
  old_suffix: string | null;
  new_part: string;
  new_suffix: string | null;
  effective: string | null;
  effective_day?: string | null;
  cycle: boolean;
  links: ToyotaLinks;
}
export interface ToyotaSubstitute {
  part_a: string;
  suffix_a: string | null;
  part_b: string;
  suffix_b: string | null;
  alternative: string;
  effective: string | null;
  unverified?: Record<string, string | null>;
  links: ToyotaLinks;
}
export interface ToyotaPartNumberHistory {
  part_number: string;
  by_region: Record<
    string,
    {
      superseded_by: ToyotaSupersessionEdge[];
      supersedes: ToyotaSupersessionEdge[];
      chain: ToyotaSupersessionEdge[];
      substitutes: ToyotaSubstitute[];
    }
  >;
}
export interface ToyotaVinMatch {
  region: string;
  catalog_code: string;
  model_name: string;
  model_code: string;
  chassis: string;
  vin_prefix: string;
  production: { from: string | null; to: string | null };
  links: ToyotaLinks;
}
export interface ToyotaSearchResult {
  query: string;
  normalised: string;
  kind: string;
  region: string;
  results: {
    vehicles: unknown[];
    part_numbers: {
      region: string;
      catalog_code: string;
      part_number: string;
      pnc: string;
      section_code: string;
      model_name: string;
    }[];
    vin_matches: unknown[];
    part_names: unknown[];
  };
}
