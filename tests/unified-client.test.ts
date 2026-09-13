import test from "node:test";
import assert from "node:assert/strict";
import { UnifiedCatalogueClient } from "../src/catalogue/unifiedClient";
/**
 * UnifiedCatalogueClient always calls both the local `/api/catalogue`
 * actions and the `toyota-*` ones behind the same endpoint. These tests
 * stub `fetch` to return canned responses per `action`, so the merge
 * logic itself — not the real network or the real Toyota API — is what's
 * under test. No test here depends on TOYOTA_EPC_ENABLED or outbound
 * network access.
 */
function stubFetch(byAction: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const action = new URL(String(url), "http://localhost").searchParams.get(
      "action",
    );
    const body = byAction[action ?? ""];
    if (body === undefined)
      throw new Error(`unstubbed action in test: ${action}`);
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
const provenance = {
  sourceProvider: "x",
  sourceRecordId: "x",
  sourceUrl: "",
  sourceCatalogue: "",
  retrievedAt: "",
  importBatchId: "",
  verification: "UNVERIFIED" as const,
  licenseStatus: "x",
};
test("browse() merges makes by name (case-insensitive) and remaps Toyota model.makeId onto the local Toyota make", async () => {
  const restore = stubFetch({
    browse: {
      makes: [{ id: "make-toyota", name: "Toyota", provenance }],
      models: [
        {
          id: "model-corolla-demo",
          makeId: "make-toyota",
          name: "Corolla",
          provenance,
        },
      ],
      variants: [],
      categories: [],
      diagrams: [],
    },
    "toyota-browse": {
      makes: [{ id: "toyota-epc-make", name: "Toyota", provenance }],
      models: [
        {
          id: "corolla",
          makeId: "toyota-epc-make",
          name: "COROLLA",
          provenance,
        },
      ],
      variants: [],
      categories: [],
      diagrams: [],
    },
  });
  try {
    const client = new UnifiedCatalogueClient("Owner");
    const result = await client.browse({});
    assert.equal(
      result.makes.length,
      1,
      "the two same-named Toyota makes must collapse into one",
    );
    assert.equal(result.makes[0].id, "make-toyota");
    assert.equal(result.models.length, 2);
    const remapped = result.models.find((m) => m.id === "corolla");
    assert.equal(
      remapped?.makeId,
      "make-toyota",
      "Toyota's model must be regrouped under the local make id",
    );
  } finally {
    restore();
  }
});
test("browse() falls back to local-only when Toyota is disabled, with no error surfaced", async () => {
  const restore = stubFetch({
    browse: {
      makes: [],
      models: [],
      variants: [],
      categories: [],
      diagrams: [],
    },
    "toyota-browse": {
      disabled: true,
      reason: "toyota-epc: provider is disabled.",
      capabilities: {},
      license: {},
    },
  });
  try {
    const client = new UnifiedCatalogueClient("Owner");
    const result = await client.browse({});
    assert.deepEqual(result, {
      makes: [],
      models: [],
      variants: [],
      categories: [],
      diagrams: [],
    });
  } finally {
    restore();
  }
});
test("browse() falls back to local-only when the Toyota request itself fails (network error)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const action = new URL(String(url), "http://localhost").searchParams.get(
      "action",
    );
    if (action === "toyota-browse") throw new Error("network down");
    return {
      ok: true,
      json: async () => ({
        makes: [],
        models: [],
        variants: [],
        categories: [],
        diagrams: [],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const client = new UnifiedCatalogueClient("Owner");
    await assert.doesNotReject(client.browse({}));
  } finally {
    globalThis.fetch = original;
  }
});
test("searchParts() merges local and Toyota hits and sums totals", async () => {
  const hit = (id: string) => ({
    part: {
      id,
      manufacturer: "x",
      description: id,
      catalogueDescription: "",
      categoryId: "",
      catalogueId: "",
      status: "Active",
      notes: "",
      version: 1,
      provenance,
    },
    numbers: [],
  });
  const restore = stubFetch({
    search: { items: [hit("local-1")], total: 1, page: 1, pageSize: 20 },
    "toyota-search-parts": {
      items: [hit("9091520004")],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  });
  try {
    const client = new UnifiedCatalogueClient("Owner");
    const result = await client.searchParts("90915", 1);
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
    assert.ok(result.items.some((i) => i.part.id === "local-1"));
    assert.ok(result.items.some((i) => i.part.id === "9091520004"));
  } finally {
    restore();
  }
});
test("searchParts() does not call the Toyota search endpoint for an empty query", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const action = new URL(String(url), "http://localhost").searchParams.get(
      "action",
    )!;
    calls.push(action);
    if (action === "toyota-search-parts")
      throw new Error("must not be called for an empty query");
    return {
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    } as Response;
  }) as typeof fetch;
  try {
    const client = new UnifiedCatalogueClient("Owner");
    await assert.doesNotReject(client.searchParts("", 1));
    assert.ok(!calls.includes("toyota-search-parts"));
  } finally {
    globalThis.fetch = original;
  }
});
test("getPart() falls back to Toyota only when the local lookup fails", async () => {
  const restore = stubFetch({
    part: { error: "Reference part not found." },
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const action = new URL(String(url), "http://localhost").searchParams.get(
      "action",
    );
    if (action === "part")
      return {
        ok: false,
        json: async () => ({ error: "Reference part not found." }),
      } as Response;
    if (action === "toyota-part")
      return {
        ok: true,
        json: async () => ({
          part: {
            id: "9091520004",
            manufacturer: "Toyota",
            description: "Oil filter",
            catalogueDescription: "",
            categoryId: "",
            catalogueId: "",
            status: "Active",
            notes: "",
            version: 1,
            provenance,
          },
          numbers: [],
          fitments: [],
          crossReferences: [],
          diagrams: [],
          source: {} as never,
        }),
      } as Response;
    throw new Error(`unstubbed action: ${action}`);
  }) as typeof fetch;
  try {
    const client = new UnifiedCatalogueClient("Owner");
    const result = await client.getPart("9091520004");
    assert.equal(result.part.manufacturer, "Toyota");
  } finally {
    globalThis.fetch = original;
    restore();
  }
});
test("getPart() surfaces the original local error when Toyota has nothing either", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      json: async () => ({ error: "Reference part not found." }),
    }) as Response) as typeof fetch;
  try {
    const client = new UnifiedCatalogueClient("Owner");
    await assert.rejects(
      client.getPart("nonexistent"),
      /Reference part not found/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("getDiagram() dispatches by id shape: a slash means Toyota, otherwise local", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const action = new URL(String(url), "http://localhost").searchParams.get(
      "action",
    )!;
    calls.push(action);
    if (action === "toyota-diagram")
      return {
        ok: true,
        json: async () => ({
          diagram: {
            id: "d",
            catalogueId: "",
            sourceId: "",
            variantId: "",
            categoryId: "",
            title: "",
            code: "",
            image: {
              id: "",
              url: "",
              rights: "EXTERNAL_REFERENCE",
              mime: "",
              width: 0,
              height: 0,
              size: 0,
              attribution: "",
              provenance,
            },
            revision: "1",
            notes: "",
            provenance,
          },
          callouts: [],
          parts: [],
        }),
      } as Response;
    return {
      ok: true,
      json: async () => ({
        diagram: {
          id: "d",
          catalogueId: "",
          sourceId: "",
          variantId: "",
          categoryId: "",
          title: "",
          code: "",
          image: {
            id: "",
            url: "",
            rights: "EXTERNAL_REFERENCE",
            mime: "",
            width: 0,
            height: 0,
            size: 0,
            attribution: "",
            provenance,
          },
          revision: "1",
          notes: "",
          provenance,
        },
        callouts: [],
        parts: [],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const client = new UnifiedCatalogueClient("Owner");
    await client.getDiagram("EU/164230/11F308A");
    assert.equal(calls.at(-1), "toyota-diagram");
    await client.getDiagram("a1b2c3localhashid");
    assert.equal(calls.at(-1), "diagram");
  } finally {
    globalThis.fetch = original;
  }
});
test("lookupVin() reports unsupported rather than throwing when Toyota is disabled", async () => {
  const restore = stubFetch({
    "toyota-vin": {
      disabled: true,
      reason: "disabled",
      capabilities: {},
      license: {},
    },
  });
  try {
    const client = new UnifiedCatalogueClient("Owner");
    const result = await client.lookupVin("JTDKB20U903100000");
    assert.equal(result.supported, false);
    assert.deepEqual(result.matches, []);
  } finally {
    restore();
  }
});
