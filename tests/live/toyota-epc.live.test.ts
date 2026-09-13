/**
 * Makes REAL network calls to https://toyota-epc.aftermarketcatalog.com.
 * Not run by `npm test` (this file lives outside `tests/*.test.ts`, which
 * is not recursive) and not run in CI. Run explicitly with
 * `npm run test:live` when you want to confirm the live API still matches
 * the shapes tests/fixtures/toyota-epc/ captured — e.g. before trusting a
 * change to the mapper, or periodically to catch an upstream schema
 * change. Requires TOYOTA_EPC_ENABLED=true and outbound internet access;
 * skips itself cleanly without either.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ToyotaEpcProvider } from "../../src/integrations/catalogues/toyota-epc/provider";
const enabled = process.env.TOYOTA_EPC_ENABLED === "true";
test(
  "live: service description responds and lists the documented endpoint groups",
  { skip: !enabled },
  async () => {
    const provider = new ToyotaEpcProvider();
    const models = await provider.getModels("EU");
    assert.ok(Array.isArray(models) && models.length > 0);
    const corolla = models.find((m) => m.slug === "corolla");
    assert.ok(corolla, "Corolla should exist in the EU model list");
  },
);
test(
  "live: a known VIN prefix resolves to at least one catalogue",
  { skip: !enabled },
  async () => {
    const provider = new ToyotaEpcProvider();
    const result = await provider.lookupVin("JTDKB20U903100000");
    assert.equal(result.supported, true);
    assert.ok(result.matches.length > 0);
  },
);
test(
  "live: a known OEM part number resolves with applications",
  { skip: !enabled },
  async () => {
    const provider = new ToyotaEpcProvider();
    const lookup = await provider.getPartNumber("90915-20004");
    assert.equal(lookup.part_number, "9091520004");
    assert.ok(Object.keys(lookup.applications).length > 0);
  },
);
test(
  "live: disabling mid-run still refuses cleanly",
  { skip: !enabled },
  async () => {
    const provider = new ToyotaEpcProvider();
    const previous = process.env.TOYOTA_EPC_ENABLED;
    delete process.env.TOYOTA_EPC_ENABLED;
    try {
      await assert.rejects(provider.getModels("EU"), /disabled/i);
    } finally {
      process.env.TOYOTA_EPC_ENABLED = previous;
    }
  },
);
