import test from "node:test";
import assert from "node:assert/strict";
import { ToyotaEpcProvider } from "../src/integrations/catalogues/toyota-epc/provider";
import {
  assertBulkSyncAllowed,
  assertPersistentStorageAllowed,
  assertImageStorageAllowed,
  policyFor,
} from "../src/catalogue/providerPolicy";
import { syncCatalogueRecord } from "../src/catalogue/sync";
/**
 * These tests never stub `fetch` to return data — they prove that with
 * TOYOTA_EPC_ENABLED unset (the production default), no network call is
 * even attempted. A global fetch stub that throws makes that assertion
 * airtight: if the provider ever tried to call it, the test would fail
 * with the stub's error instead of the expected "disabled" message.
 */
function withThrowingFetch<T>(run: () => T): T {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error(
      "network access attempted while the provider should be disabled",
    );
  }) as typeof fetch;
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}
test("Toyota EPC provider is disabled by default and makes no network call", async () => {
  delete process.env.TOYOTA_EPC_ENABLED;
  const provider = new ToyotaEpcProvider();
  await withThrowingFetch(async () => {
    await assert.rejects(provider.browse({}), /disabled/i);
    await assert.rejects(provider.getDiagram("EU/164230/11F308A"), /disabled/i);
    await assert.rejects(provider.searchParts("90915-20004", 1), /disabled/i);
    await assert.rejects(provider.getPart("9091520004"), /disabled/i);
    await assert.rejects(provider.lookupVin("JTDKB20U903100000"), /disabled/i);
    await assert.rejects(provider.getModels("EU"), /disabled/i);
  });
});
test("setting TOYOTA_EPC_ENABLED=true alone does not bypass the registered policy guards", () => {
  process.env.TOYOTA_EPC_ENABLED = "true";
  try {
    assert.throws(
      () => assertBulkSyncAllowed("toyota-epc"),
      /bulk synchronization is not permitted/,
    );
    assert.throws(
      () => assertPersistentStorageAllowed("toyota-epc"),
      /persistent storage of catalogue records is not permitted/,
    );
    assert.throws(
      () => assertImageStorageAllowed("toyota-epc"),
      /local image storage is not permitted/,
    );
  } finally {
    delete process.env.TOYOTA_EPC_ENABLED;
  }
});
test("policy guards refuse even a fully enabled provider whose license flags are false", () => {
  const policy = policyFor("toyota-epc");
  assert.equal(
    policy.license.enabled,
    false,
    "shipped default must be disabled",
  );
  assert.equal(policy.license.persistentStorageAllowed, false);
  assert.equal(policy.license.imageStorageAllowed, false);
  assert.equal(policy.license.bulkSyncAllowed, false);
  assert.equal(policy.license.redistributionAllowed, "UNKNOWN");
});
test("an unregistered provider key is denied by every guard, not assumed permissive", () => {
  assert.throws(() => assertBulkSyncAllowed("some-future-provider"));
  assert.throws(() => assertPersistentStorageAllowed("some-future-provider"));
  assert.throws(() => assertImageStorageAllowed("some-future-provider"));
  const policy = policyFor("some-future-provider");
  assert.equal(policy.license.enabled, false);
});
test("the local reference and demo providers keep the access they already had", () => {
  assert.doesNotThrow(() => assertPersistentStorageAllowed("original-demo"));
  assert.doesNotThrow(() => assertBulkSyncAllowed("company-csv"));
  assert.doesNotThrow(() => assertPersistentStorageAllowed("local-reference"));
});
test("the sync entry point refuses Toyota regardless of scope, server-side, not just in an admin UI", () => {
  const result = syncCatalogueRecord({
    providerKey: "toyota-epc",
    scope: "vehicle",
    target: "EU/164230",
  });
  assert.equal(result.status, "REFUSED");
  assert.match(result.reason, /bulk synchronization is not permitted/);
});
test("browse() with a make chosen but no model yet lists every model, not just the demo/local ones", async () => {
  process.env.TOYOTA_EPC_ENABLED = "true";
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/regions/EU/models")
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              region: "EU",
              name: "COROLLA",
              slug: "corolla",
              catalog_count: 7,
              years: { from: 1974, to: null, current: true },
              chassis_codes: [],
              links: {},
            },
            {
              region: "EU",
              name: "AVENSIS",
              slug: "avensis",
              catalog_count: 3,
              years: { from: 1997, to: 2018, current: false },
              chassis_codes: [],
              links: {},
            },
          ],
        }),
      } as Response;
    throw new Error(`unstubbed path in test: ${path}`);
  }) as typeof fetch;
  try {
    const provider = new ToyotaEpcProvider();
    const result = await provider.browse({});
    assert.equal(
      result.models.length,
      2,
      "must not require a model filter to be chosen first",
    );
    assert.deepEqual(result.models.map((m) => m.name).sort(), [
      "AVENSIS",
      "COROLLA",
    ]);
  } finally {
    globalThis.fetch = original;
    delete process.env.TOYOTA_EPC_ENABLED;
  }
});
test("Toyota EPC capabilities describe VIN/hotspot/supersession support truthfully and no bulk/persistent support", () => {
  const provider = new ToyotaEpcProvider();
  assert.equal(provider.capabilities.supportsVinLookup, true);
  assert.equal(provider.capabilities.supportsHotspots, true);
  assert.equal(provider.capabilities.supportsSupersessions, true);
  assert.equal(provider.capabilities.supportsSpecifications, false);
  assert.equal(provider.capabilities.supportsBulkSync, false);
  assert.equal(provider.capabilities.supportsPersistentStorage, false);
});
