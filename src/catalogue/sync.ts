import {
  assertBulkSyncAllowed,
  assertPersistentStorageAllowed,
  policyFor,
} from "./providerPolicy";
/**
 * The one entry point a future bulk/scheduled synchronization job would
 * call to pull a provider's catalogue into local persistent storage. It
 * does no actual work yet — there is nothing to sync from a
 * `bulkSyncAllowed: false` / `persistentStorageAllowed: false` provider,
 * and today only such providers exist for third-party EPC data (see
 * providerPolicy.ts). The guard runs first and unconditionally, so this
 * function is safe to wire into a cron/admin trigger without re-checking
 * policy at every call site — a provider whose policy denies sync can
 * never be made to run one just by calling this function, regardless of
 * its `enabled`/`*_ENABLED` flag.
 */
export interface SyncRequest {
  providerKey: string;
  scope: "vehicle" | "diagram" | "part" | "section";
  target: string;
}
export interface SyncResult {
  providerKey: string;
  scope: SyncRequest["scope"];
  target: string;
  status: "REFUSED" | "COMPLETED";
  reason: string;
}
export function syncCatalogueRecord(request: SyncRequest): SyncResult {
  try {
    assertBulkSyncAllowed(request.providerKey);
    assertPersistentStorageAllowed(request.providerKey);
  } catch (error) {
    return {
      ...request,
      status: "REFUSED",
      reason: (error as Error).message,
    };
  }
  // No provider currently registered has both flags true except the
  // first-party ones, which do not need this path (they are already
  // local). Reaching here for a third-party provider means its policy
  // was deliberately changed to permit sync — implement the actual
  // fetch → map → ReferenceRepository.commit sequence at that point,
  // scoped to `request.scope`/`request.target` rather than a full mirror.
  const policy = policyFor(request.providerKey);
  return {
    ...request,
    status: "REFUSED",
    reason: `${request.providerKey}: no sync implementation exists yet — policy currently permits it (bulkSyncAllowed=${policy.license.bulkSyncAllowed}), but syncCatalogueRecord has no fetch/write logic wired up. Implement one deliberately, scoped to the request, before removing this message.`,
  };
}
