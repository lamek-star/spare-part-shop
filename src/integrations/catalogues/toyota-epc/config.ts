/**
 * Toyota EPC provider configuration. `TOYOTA_EPC_ENABLED` defaults to
 * false — see docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md, "Catalogue Data
 * Licensing & Provider Governance", for why: the source's own /legal page
 * disclaims a redistribution licence for its catalogue data and
 * illustrations, so this application does not serve it to production
 * users until that is resolved.
 *
 * Setting the env var alone is deliberately NOT sufficient — every
 * provider method also calls providerPolicy.ts's guards, which read the
 * registered policy (`providerPolicies["toyota-epc"]`) independently of
 * this flag. Flipping TOYOTA_EPC_ENABLED=true without also updating that
 * policy's `enabled`/`*Allowed` fields still leaves every write path
 * refusing to run — see ToyotaEpcProvider and sync.ts.
 */
export const TOYOTA_EPC_BASE_URL = "https://toyota-epc.aftermarketcatalog.com";
export function toyotaEpcEnabled(): boolean {
  return (
    (typeof process !== "undefined"
      ? process.env?.TOYOTA_EPC_ENABLED
      : ""
    )?.trim() === "true"
  );
}
export interface ToyotaEpcRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
  defaultRegion: "EU" | "GR" | "US" | "JP";
  timeoutMs: number;
  maxRetries: number;
}
export function toyotaEpcConfig(): ToyotaEpcRuntimeConfig {
  return {
    enabled: toyotaEpcEnabled(),
    baseUrl: TOYOTA_EPC_BASE_URL,
    defaultRegion: "EU",
    timeoutMs: 8000,
    maxRetries: 2,
  };
}
