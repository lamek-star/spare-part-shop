/**
 * Provider governance: what a catalogue provider is technically capable of
 * (`ProviderCapabilities`) versus what it is actually *permitted* to do with
 * this application's data (`ProviderLicense`). These are deliberately kept
 * as data, not code, so a policy change never requires touching the
 * provider adapter or the UI — and so the same guard functions can be
 * exercised in tests without a real provider.
 *
 * `ProviderLicense` flags are enforced here, server-side, independent of
 * any `*_ENABLED` environment toggle. A provider flipped on in
 * configuration is still refused by `assertBulkSyncAllowed` /
 * `assertPersistentStorageAllowed` / `assertImageStorageAllowed` if its
 * registered policy says no — see docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md,
 * "Catalogue Data Licensing & Provider Governance".
 */
export interface ProviderCapabilities {
  supportsVehicleLookup: boolean;
  supportsVinLookup: boolean;
  supportsDiagrams: boolean;
  supportsHotspots: boolean;
  supportsOemNumbers: boolean;
  supportsFitment: boolean;
  supportsSupersessions: boolean;
  supportsSpecifications: boolean;
  supportsImages: boolean;
  supportsBulkSync: boolean;
  supportsPersistentStorage: boolean;
}
export type LicenseStatus =
  | "OWNED"
  | "ORIGINAL_DEMO"
  | "OPERATOR_ATTESTED_INTERNAL"
  | "LICENSED"
  | "PERMISSION_REQUIRED"
  | "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED"
  | "DENIED";
export interface ProviderLicense {
  providerKey: string;
  providerName: string;
  providerType:
    | "MANUFACTURER"
    | "AGGREGATOR"
    | "LICENSED_FEED"
    | "INTERNAL"
    | "CSV"
    | "OTHER";
  /** Master switch, normally sourced from an environment variable — see
   * each provider's config.ts. This alone is NOT sufficient to allow
   * storage/sync; the flags below are checked independently. */
  enabled: boolean;
  /** Whether the source's own terms permit this application to reproduce
   * or redistribute its catalogue data/illustrations at all. `"UNKNOWN"`
   * means the question has not been resolved in the provider's favor and
   * must be treated the same as `false` by every guard in this file. */
  redistributionAllowed: boolean | "UNKNOWN";
  /** Whether records from this provider may be written into this
   * application's own persistent store (vs. served live, per request,
   * with only a short in-memory/HTTP cache). */
  persistentStorageAllowed: boolean;
  /** Whether diagram/illustration images from this provider may be
   * downloaded and re-hosted by this application, as opposed to left as
   * an external reference URL (or withheld entirely). */
  imageStorageAllowed: boolean;
  /** Whether an unattended bulk/sync job may pull this provider's catalogue
   * in bulk, as opposed to single, operator-initiated lookups. */
  bulkSyncAllowed: boolean;
  attributionRequired: boolean;
  licenseStatus: LicenseStatus;
  /** Human-readable pointer to the actual license/authorization record,
   * not a legal conclusion — e.g. a contract reference or "none on file". */
  licenseReference: string;
  termsUrl: string;
  notes: string;
}
export interface ProviderPolicy {
  capabilities: ProviderCapabilities;
  license: ProviderLicense;
}
const noCapabilities: ProviderCapabilities = {
  supportsVehicleLookup: false,
  supportsVinLookup: false,
  supportsDiagrams: false,
  supportsHotspots: false,
  supportsOemNumbers: false,
  supportsFitment: false,
  supportsSupersessions: false,
  supportsSpecifications: false,
  supportsImages: false,
  supportsBulkSync: false,
  supportsPersistentStorage: false,
};
/**
 * Registered policy for every catalogue provider this application knows
 * about, including the internal ones. There is intentionally no fallback
 * "assume permissive" default anywhere in this module — an unregistered
 * provider key resolves to `unknownProviderPolicy()`, which denies
 * everything, so a new provider can never accidentally inherit access it
 * was never granted.
 */
export const providerPolicies: Record<string, ProviderPolicy> = {
  "original-demo": {
    capabilities: {
      ...noCapabilities,
      supportsVehicleLookup: true,
      supportsDiagrams: true,
      supportsHotspots: true,
      supportsOemNumbers: true,
      supportsFitment: true,
      supportsSupersessions: true,
      supportsPersistentStorage: true,
    },
    license: {
      providerKey: "original-demo",
      providerName: "Original demonstration catalogue",
      providerType: "INTERNAL",
      enabled: true,
      redistributionAllowed: true,
      persistentStorageAllowed: true,
      imageStorageAllowed: true,
      bulkSyncAllowed: true,
      attributionRequired: false,
      licenseStatus: "ORIGINAL_DEMO",
      licenseReference:
        "Original artwork and fixture data authored for this application.",
      termsUrl: "",
      notes: "Not third-party data; no redistribution question applies.",
    },
  },
  "local-reference": {
    capabilities: {
      ...noCapabilities,
      supportsVehicleLookup: true,
      supportsDiagrams: true,
      supportsHotspots: true,
      supportsOemNumbers: true,
      supportsFitment: true,
      supportsSupersessions: true,
      supportsPersistentStorage: true,
    },
    license: {
      providerKey: "local-reference",
      providerName: "Local reference catalogue (this application's own store)",
      providerType: "INTERNAL",
      enabled: true,
      redistributionAllowed: true,
      persistentStorageAllowed: true,
      imageStorageAllowed: true,
      bulkSyncAllowed: true,
      attributionRequired: false,
      licenseStatus: "OWNED",
      licenseReference:
        "N/A — first-party data blended from original-demo, company-csv and any published import batches.",
      termsUrl: "",
      notes:
        "The frontend's normal catalogue client (src/catalogue/client.ts), not a raw external provider.",
    },
  },
  "company-csv": {
    capabilities: {
      ...noCapabilities,
      supportsVehicleLookup: true,
      supportsOemNumbers: true,
      supportsFitment: true,
      supportsPersistentStorage: true,
    },
    license: {
      providerKey: "company-csv",
      providerName: "Company supplied CSV",
      providerType: "CSV",
      enabled: true,
      redistributionAllowed: true,
      persistentStorageAllowed: true,
      imageStorageAllowed: false,
      bulkSyncAllowed: true,
      attributionRequired: false,
      licenseStatus: "OPERATOR_ATTESTED_INTERNAL",
      licenseReference:
        "Operator attestation captured at upload time (ReferenceRepository.stage).",
      termsUrl: "",
      notes:
        "Operator affirms the right to use each upload internally; no image import path exists.",
    },
  },
  nengun: {
    capabilities: { ...noCapabilities },
    license: {
      providerKey: "nengun",
      providerName: "Nengun web reference",
      providerType: "AGGREGATOR",
      enabled: false,
      redistributionAllowed: "UNKNOWN",
      persistentStorageAllowed: false,
      imageStorageAllowed: false,
      bulkSyncAllowed: false,
      attributionRequired: true,
      licenseStatus: "PERMISSION_REQUIRED",
      licenseReference: "docs/catalogues/NENGUN_SOURCE_REVIEW.md",
      termsUrl: "https://www.nengun.com/oem",
      notes:
        "robots.txt disallows automated access to the OEM catalogue paths; no transport is implemented.",
    },
  },
  "toyota-epc": {
    capabilities: {
      supportsVehicleLookup: true,
      supportsVinLookup: true,
      supportsDiagrams: true,
      supportsHotspots: true,
      supportsOemNumbers: true,
      supportsFitment: true,
      supportsSupersessions: true,
      supportsSpecifications: false,
      supportsImages: true,
      supportsBulkSync: false,
      supportsPersistentStorage: false,
    },
    license: {
      providerKey: "toyota-epc",
      providerName: "Toyota parts catalogue (aftermarketcatalog.com)",
      providerType: "AGGREGATOR",
      enabled: false,
      redistributionAllowed: "UNKNOWN",
      persistentStorageAllowed: false,
      imageStorageAllowed: false,
      bulkSyncAllowed: false,
      attributionRequired: true,
      licenseStatus: "UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED",
      licenseReference:
        'https://toyota-epc.aftermarketcatalog.com/legal — "it is not a licence to reproduce or redistribute the underlying data or illustrations."',
      termsUrl: "https://toyota-epc.aftermarketcatalog.com/legal",
      notes:
        "Independent aggregator, not Toyota Motor Corporation. Read-only JSON API is publicly reachable and CORS-open, but its own legal notice disclaims a redistribution licence for catalogue data and illustrations. Adapter is implemented and tested against verified real response shapes; disabled for production use (TOYOTA_EPC_ENABLED defaults to false) until written permission or a licensed feed replaces it. See docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md.",
    },
  },
};
export function policyFor(providerKey: string): ProviderPolicy {
  return (
    providerPolicies[providerKey] ?? {
      capabilities: { ...noCapabilities },
      license: {
        providerKey,
        providerName: providerKey,
        providerType: "OTHER",
        enabled: false,
        redistributionAllowed: "UNKNOWN",
        persistentStorageAllowed: false,
        imageStorageAllowed: false,
        bulkSyncAllowed: false,
        attributionRequired: true,
        licenseStatus: "PERMISSION_REQUIRED",
        licenseReference: "",
        termsUrl: "",
        notes:
          "Unregistered provider key — denied by default, not assumed permissive.",
      },
    }
  );
}
class ProviderPolicyError extends Error {}
export function assertBulkSyncAllowed(providerKey: string): void {
  const { license } = policyFor(providerKey);
  if (!license.enabled || !license.bulkSyncAllowed)
    throw new ProviderPolicyError(
      `${providerKey}: bulk synchronization is not permitted (enabled=${license.enabled}, bulkSyncAllowed=${license.bulkSyncAllowed}). ${license.notes}`,
    );
}
export function assertPersistentStorageAllowed(providerKey: string): void {
  const { license } = policyFor(providerKey);
  if (!license.enabled || !license.persistentStorageAllowed)
    throw new ProviderPolicyError(
      `${providerKey}: persistent storage of catalogue records is not permitted (enabled=${license.enabled}, persistentStorageAllowed=${license.persistentStorageAllowed}). ${license.notes}`,
    );
}
export function assertImageStorageAllowed(providerKey: string): void {
  const { license } = policyFor(providerKey);
  if (!license.enabled || !license.imageStorageAllowed)
    throw new ProviderPolicyError(
      `${providerKey}: local image storage is not permitted (enabled=${license.enabled}, imageStorageAllowed=${license.imageStorageAllowed}). ${license.notes}`,
    );
}
