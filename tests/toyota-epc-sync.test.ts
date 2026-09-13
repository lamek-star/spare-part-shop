import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync as read } from "node:fs";
import { join } from "node:path";
import { syncCatalogueRecord } from "../src/catalogue/sync";
import { repository } from "../src/catalogue/server";
import { providerPolicies, policyFor } from "../src/catalogue/providerPolicy";
/**
 * Proves the gated import mechanism (ReferenceRepository.importCatalogueRecords
 * + syncCatalogueRecord's fetch/map sequence) is genuinely correct, without
 * ever running it against the real Toyota API or under the real (blocked)
 * production policy. The permissive policy here is a test-only override of
 * the shared `providerPolicies` object, restored in `finally` on every
 * test — it never touches the shipped default (verified separately below)
 * and exists only to answer "if permission is ever granted, does the
 * import code actually work," per the isolated-fixture allowance for
 * tests. See docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md, "The merge" /
 * "Catalogue Data Licensing & Provider Governance".
 */
const testDataDir = join(process.cwd(), ".catalogue-test-data");
async function withTestStore<T>(run: () => Promise<T>): Promise<T> {
  rmSync(testDataDir, { recursive: true, force: true });
  const previous = process.env.CATALOGUE_TEST_MODE;
  process.env.CATALOGUE_TEST_MODE = "1";
  try {
    return await run();
  } finally {
    process.env.CATALOGUE_TEST_MODE = previous;
    rmSync(testDataDir, { recursive: true, force: true });
  }
}
async function withPermissiveToyotaPolicy<T>(
  run: () => Promise<T>,
): Promise<T> {
  const original = { ...providerPolicies["toyota-epc"].license };
  providerPolicies["toyota-epc"].license.enabled = true;
  providerPolicies["toyota-epc"].license.bulkSyncAllowed = true;
  providerPolicies["toyota-epc"].license.persistentStorageAllowed = true;
  const previousEnv = process.env.TOYOTA_EPC_ENABLED;
  process.env.TOYOTA_EPC_ENABLED = "true";
  try {
    return await run();
  } finally {
    Object.assign(providerPolicies["toyota-epc"].license, original);
    process.env.TOYOTA_EPC_ENABLED = previousEnv;
  }
}
function stubToyotaFetch() {
  const fixture = <T>(name: string): T =>
    JSON.parse(read(join(__dirname, "fixtures/toyota-epc", name), "utf8"))
      .data as T;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    const body =
      path === "/api/v1/catalogs/EU/164230"
        ? fixture("catalog.json")
        : path === "/api/v1/regions/EU/models/corolla"
          ? fixture("model-corolla.json")
          : path === "/api/v1/catalogs/EU/164230/figures/11F308A"
            ? fixture("figure.json")
            : undefined;
    if (!body) throw new Error(`unstubbed path in test: ${path}`);
    return { ok: true, json: async () => ({ data: body }) } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
test("the shipped default policy still refuses toyota-epc sync — this file's permissive override never leaks", () => {
  const policy = policyFor("toyota-epc");
  assert.equal(policy.license.enabled, false);
  assert.equal(policy.license.bulkSyncAllowed, false);
  assert.equal(policy.license.persistentStorageAllowed, false);
});
test("syncCatalogueRecord refuses before any fetch when the provider is disabled (the shipped default)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network access attempted while sync should be refused");
  }) as typeof fetch;
  try {
    const result = await syncCatalogueRecord({
      providerKey: "toyota-epc",
      scope: "diagram",
      target: "EU/164230/11F308A",
    });
    assert.equal(result.status, "REFUSED");
    assert.match(result.reason, /bulk synchronization is not permitted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("with a simulated permissive policy, sync fetches, maps and persists a real-shaped diagram bundle idempotently", async () => {
  await withTestStore(async () => {
    await withPermissiveToyotaPolicy(async () => {
      const restoreFetch = stubToyotaFetch();
      try {
        const first = await syncCatalogueRecord({
          providerKey: "toyota-epc",
          scope: "diagram",
          target: "EU/164230/11F308A",
        });
        assert.equal(first.status, "COMPLETED");
        assert.ok(first.imported);
        assert.equal(first.imported!.created.diagrams, 1);
        assert.ok((first.imported!.created.callouts ?? 0) > 0);
        assert.ok((first.imported!.created.numbers ?? 0) > 0);
        const afterFirst = repository().snapshot();
        const diagramCount = afterFirst.diagrams.length;
        const numberCount = afterFirst.numbers.length;
        const partCount = afterFirst.parts.length;
        // Run the identical import again — idempotency means every row
        // upserts in place, never duplicating.
        const second = await syncCatalogueRecord({
          providerKey: "toyota-epc",
          scope: "diagram",
          target: "EU/164230/11F308A",
        });
        assert.equal(second.status, "COMPLETED");
        assert.equal(second.imported!.created.diagrams ?? 0, 0);
        assert.equal(second.imported!.updated.diagrams, 1);
        const afterSecond = repository().snapshot();
        assert.equal(afterSecond.diagrams.length, diagramCount);
        assert.equal(afterSecond.numbers.length, numberCount);
        assert.equal(afterSecond.parts.length, partCount);
        // The imported diagram is genuinely reachable through the normal
        // repository API afterwards, exactly like any other diagram.
        const imported = afterSecond.diagrams.find(
          (d) => d.sourceId === "toyota-epc",
        );
        assert.ok(imported, "the Toyota-sourced diagram must be persisted");
        assert.equal(imported!.code, "11F308A");
        const detail = repository().diagram(imported!.id);
        assert.ok(detail.callouts.length > 0);
        assert.ok(
          detail.parts.some((p) => p.numbers.some((n) => n.type === "OEM_OE")),
        );
      } finally {
        restoreFetch();
      }
    });
  });
});
test("importCatalogueRecords itself refuses even under a permissive TOYOTA_EPC_ENABLED if the policy object disagrees", () => {
  const original = { ...providerPolicies["toyota-epc"].license };
  process.env.TOYOTA_EPC_ENABLED = "true";
  try {
    assert.throws(
      () =>
        repository().importCatalogueRecords(
          { diagrams: [] as never },
          "toyota-epc",
        ),
      /bulk synchronization is not permitted/,
    );
  } finally {
    Object.assign(providerPolicies["toyota-epc"].license, original);
    delete process.env.TOYOTA_EPC_ENABLED;
  }
});
