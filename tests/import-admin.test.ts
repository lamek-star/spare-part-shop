import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeNumber } from "../src/domain/models";
import {
  startImportJob,
  retryFailedItems,
  parseImportLines,
  importLinesFromCsv,
  MAX_IMPORT_ITEMS,
} from "../src/catalogue/importRunner";
import {
  getImportJob,
  listImportJobs,
  offlineReadiness,
  resetImportStoreCache,
  ImportJob,
} from "../src/catalogue/importStore";
import { parseCsv } from "../src/catalogue/providers";
import { searchOemPart } from "../src/integrations/catalogues/intraforge-storage/client";
import { GET, POST } from "../src/app/api/catalogue/route";
import { GET as drawingGet } from "../src/app/api/catalogue/diagram-image/route";

/**
 * Covers the controlled admin catalogue warm-up/import feature
 * (docs/CATALOGUE_IMPORT.md): single/multi/CSV input, cache-hit vs
 * provider-resolved outcomes, provider disabled/failure, rate limiting,
 * partial-batch handling, retry, offline continuity, and the admin-only
 * authorization gate. Both backends this feature talks to (IntraForge
 * storage and the Toyota EPC provider) are simulated behind a single
 * `globalThis.fetch` stub, the same convention every other test in this
 * suite uses (see tests/toyota-epc-sync.test.ts) — never a real network
 * call.
 */
const ISSUER = "https://intraforge.test";
const testDataDir = join(process.cwd(), ".catalogue-import-test-data");

interface FakePart {
  part_number: string;
  description: string;
  manufacturer: string;
  diagram_code: string;
  provider: string;
  provider_diagram_id: string;
  callout: string;
  source_image_url: string;
  applicability: string;
  fitment_notes: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
function toIntraForgePart(row: FakePart) {
  return {
    id: randomUUID(),
    manufacturer: row.manufacturer,
    part_number: row.part_number,
    normalized_part_number: normalizeNumber(row.part_number),
    description: row.description,
    applicability: row.applicability,
    fitment_notes: row.fitment_notes,
    diagram_parts: [
      {
        callout: row.callout,
        x: row.x ?? null,
        y: row.y ?? null,
        width: row.width ?? null,
        height: row.height ?? null,
        diagram: {
          id: randomUUID(),
          provider: row.provider,
          provider_diagram_id: row.provider_diagram_id,
          diagram_code: row.diagram_code,
          license_status: "EXTERNAL_REFERENCE_ONLY" as const,
          source_image_url: row.source_image_url,
          image_url: null,
          has_figure: true,
        },
      },
    ],
  };
}

/** The one real Toyota EPC record this whole suite (and
 * docs/CATALOGUE_STORAGE.md's own "First end-to-end proof") is built
 * around — verified live during that earlier feature's development. */
const TOYOTA_CATALOG = { region: "EU", catalog_code: "671450" };
const TOYOTA_PART = {
  part_number: "15690-65010",
  normalized: "1569065010",
  section_code: "1503",
  figure_key: "MAB896",
  pnc: "15690",
  name: "VALVE ASSY, OIL COOLER RELIEF",
  rect: { x1: 536, y1: 672, x2: 602, y2: 692 },
};
const TOYOTA_FAILING_PART = "99999-FAIL"; // triggers a simulated 500 from the search endpoint

/** A second real-shaped part whose drawing is NOT the section's primary
 * figure — reachable only through its part group's figure list. */
const TOYOTA_OTHER_FIGURE_PART = {
  part_number: "15691-11111",
  normalized: "1569111111",
  pnc: "15691",
  figure_key: "OTHERFIG",
  name: "GASKET, OIL COOLER",
};

function toyotaPartLine(
  id: number,
  pnc: string,
  display: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    part_id: id,
    region: TOYOTA_CATALOG.region,
    catalog_code: TOYOTA_CATALOG.catalog_code,
    pnc,
    part_number: normalizeNumber(display),
    part_number_display: display,
    suffix: null,
    name,
    model_period: "T1",
    valid: { from: "1988-08", to: "1989-08" },
    is_current: false,
    unverified: {},
    trim_codes: null,
    links: { self: `/api/v1/parts/${id}` },
    fitment: [
      { code: "3VZE", meaning: "3000CC", attribute: "ENGINE 1" },
      { code: "3VZE", meaning: null, attribute: null }, // repeated code must be collapsed
      { code: "VZN85,90", meaning: null, attribute: null },
    ],
    price: null,
    has_remarks: true,
    quantity: null,
    ...overrides,
  };
}
function toyotaFigure(key: string) {
  const primary = key === TOYOTA_PART.figure_key;
  const hotspot = (
    seq: number,
    pnc: string,
    name: string,
    resolved: boolean,
    rect = TOYOTA_PART.rect,
  ) => ({
    seq,
    label: pnc,
    key_type: "part_group",
    pnc,
    name,
    part_count: 1,
    resolved,
    rect,
  });
  return {
    figure_key: key,
    dataset: "A1",
    catalog: TOYOTA_CATALOG,
    image: {
      url: `/image/figure/EU/A1/${key}.png`,
      thumbnail_url: "",
      source_bytes: 12345,
    },
    hotspots: primary
      ? [
          hotspot(0, TOYOTA_PART.pnc, TOYOTA_PART.name, true),
          hotspot(1, "15785", "GASKET, OIL COOLER", true, {
            x1: 10,
            y1: 20,
            x2: 70,
            y2: 40,
          }),
          hotspot(2, "90301", "STANDARD FASTENER", false, {
            x1: 5,
            y1: 5,
            x2: 25,
            y2: 15,
          }),
        ]
      : [
          hotspot(
            0,
            TOYOTA_OTHER_FIGURE_PART.pnc,
            TOYOTA_OTHER_FIGURE_PART.name,
            true,
          ),
        ],
    parts: primary
      ? [
          toyotaPartLine(
            1,
            TOYOTA_PART.pnc,
            TOYOTA_PART.part_number,
            TOYOTA_PART.name,
          ),
          // a production variant of the same number on a second line
          toyotaPartLine(
            2,
            TOYOTA_PART.pnc,
            TOYOTA_PART.part_number,
            TOYOTA_PART.name,
            {
              valid: { from: "1989-08", to: null },
              is_current: true,
              has_remarks: false,
            },
          ),
          toyotaPartLine(3, TOYOTA_PART.pnc, "15690-65020", TOYOTA_PART.name),
          toyotaPartLine(4, "15785", "15785-35010", "GASKET, OIL COOLER"),
        ]
      : [
          toyotaPartLine(
            5,
            TOYOTA_OTHER_FIGURE_PART.pnc,
            TOYOTA_OTHER_FIGURE_PART.part_number,
            TOYOTA_OTHER_FIGURE_PART.name,
          ),
        ],
    also_in_catalogs: [],
  };
}
const ok = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;
const notFound = () =>
  ({ ok: false, status: 404, json: async () => ({}) }) as Response;

/** In-memory fake of both external backends. `store` starts seeded with
 * whatever already-cached parts are given; a figure import adds every
 * number on the figure to it, mirroring the real service. */
function fakeBackends(
  opts: { seed?: ReturnType<typeof toIntraForgePart>[] } = {},
) {
  const store = new Map<string, ReturnType<typeof toIntraForgePart>>();
  const figures = new Map<string, unknown>();
  for (const part of opts.seed ?? [])
    store.set(part.normalized_part_number, part);
  let toyotaFetchCount = 0;
  let intraforgeSearchCount = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    // ---- Fake IntraForge storage ----
    if (url.origin === ISSUER) {
      if (url.pathname === "/api/v1/catalogue/oem-parts/" && !init?.method) {
        intraforgeSearchCount++;
        const hit = store.get(normalizeNumber(url.searchParams.get("q") ?? ""));
        if (!hit) return notFound();
        return { ok: true, status: 200, json: async () => hit } as Response;
      }
      if (
        url.pathname === "/api/v1/catalogue/diagrams/import/" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as {
          provider: string;
          provider_diagram_id: string;
          diagram_code: string;
          source_image_url: string;
          manufacturer: string;
          figure_data: {
            groups: {
              callout: string;
              rect: {
                x: number;
                y: number;
                width: number;
                height: number;
              } | null;
              rows: { part_number: string; description: string }[];
            }[];
          };
        };
        const diagramId = randomUUID();
        for (const group of body.figure_data.groups)
          for (const row of group.rows) {
            const part = toIntraForgePart({
              part_number: row.part_number,
              description: row.description,
              manufacturer: body.manufacturer,
              diagram_code: body.diagram_code,
              provider: body.provider,
              provider_diagram_id: body.provider_diagram_id,
              callout: group.callout,
              source_image_url: body.source_image_url,
              applicability: "",
              fitment_notes: "",
              ...(group.rect ?? {}),
            });
            part.diagram_parts[0].diagram.id = diagramId;
            store.set(part.normalized_part_number, part);
          }
        figures.set(diagramId, body.figure_data);
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: diagramId, figure_data: body.figure_data }),
        } as Response;
      }
      const diagram =
        /^\/api\/v1\/catalogue\/diagrams\/([0-9a-f-]{36})\/$/.exec(
          url.pathname,
        );
      if (diagram) {
        const data = figures.get(diagram[1]);
        if (!data) return notFound();
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: diagram[1], figure_data: data }),
        } as Response;
      }
      throw new Error(`unstubbed IntraForge path in test: ${url.pathname}`);
    }
    // ---- Fake Toyota EPC ----
    if (url.hostname === "toyota-epc.aftermarketcatalog.com") {
      toyotaFetchCount++;
      const base = `/api/v1/catalogs/${TOYOTA_CATALOG.region}/${TOYOTA_CATALOG.catalog_code}`;
      if (url.pathname === "/api/v1/search") {
        const q = normalizeNumber(url.searchParams.get("q") ?? "");
        if (q === normalizeNumber(TOYOTA_FAILING_PART))
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        const known = [
          { n: TOYOTA_PART.normalized, pnc: TOYOTA_PART.pnc },
          {
            n: TOYOTA_OTHER_FIGURE_PART.normalized,
            pnc: TOYOTA_OTHER_FIGURE_PART.pnc,
          },
        ].filter((k) => k.n === q);
        return ok({
          query: q,
          normalised: q,
          kind: "part_number",
          region: "EU",
          results: {
            vehicles: [],
            part_numbers: known.map((k) => ({
              region: TOYOTA_CATALOG.region,
              catalog_code: TOYOTA_CATALOG.catalog_code,
              part_number: k.n,
              pnc: k.pnc,
              section_code: TOYOTA_PART.section_code,
              model_name: "Toyota (test fixture)",
            })),
            vin_matches: [],
            part_names: [],
          },
        });
      }
      if (url.pathname === `${base}/sections`)
        return ok([
          {
            section_code: TOYOTA_PART.section_code,
            name: "ENGINE OIL COOLER",
            part_group_count: 2,
            primary_figure: TOYOTA_PART.figure_key,
            thumbnail_url: null,
            links: {},
          },
        ]);
      if (url.pathname === `${base}/groups/${TOYOTA_OTHER_FIGURE_PART.pnc}`)
        return ok({
          pnc: TOYOTA_OTHER_FIGURE_PART.pnc,
          name: TOYOTA_OTHER_FIGURE_PART.name,
          catalog: TOYOTA_CATALOG,
          figures: [
            TOYOTA_PART.figure_key,
            TOYOTA_OTHER_FIGURE_PART.figure_key,
          ],
          parts: [],
        });
      const figure = new RegExp(`^${base}/figures/([A-Z0-9]+)$`).exec(
        url.pathname,
      );
      if (figure) return ok(toyotaFigure(figure[1]));
      throw new Error(`unstubbed Toyota EPC path in test: ${url.pathname}`);
    }
    throw new Error(`unstubbed host in test: ${url.origin}`);
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    store,
    figures,
    toyotaCalls: () => toyotaFetchCount,
    intraforgeSearches: () => intraforgeSearchCount,
  };
}

async function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
async function withCleanStore<T>(run: () => Promise<T>): Promise<T> {
  rmSync(testDataDir, { recursive: true, force: true });
  resetImportStoreCache();
  process.env.CATALOGUE_TEST_MODE = "1";
  try {
    return await run();
  } finally {
    rmSync(testDataDir, { recursive: true, force: true });
    resetImportStoreCache();
  }
}
async function waitForFinish(
  jobId: string,
  timeoutMs = 15_000,
): Promise<ImportJob> {
  const started = Date.now();
  for (;;) {
    const job = getImportJob(jobId);
    if (job && job.status !== "PENDING" && job.status !== "RUNNING") return job;
    if (Date.now() - started > timeoutMs)
      throw new Error("import job did not finish in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const intraforgeEnv = {
  INTRAFORGE_ISSUER: ISSUER,
  INTRAFORGE_CATALOGUE_BEARER_TOKEN: "test-token",
};

test("single import: a not-yet-cached part resolves via Toyota EPC and is persisted", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 200,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.status, "COMPLETED");
        assert.equal(finished.imported_count, 1);
        assert.equal(finished.items[0].result, "IMPORTED");
        assert.equal(finished.items[0].provider, "toyota-epc");
        assert.ok(backends.store.has(TOYOTA_PART.normalized));
      } finally {
        backends.restore();
      }
    }),
  );
});

test("multi-part import resolves each line independently and records one item per line, in order", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [
            { part_number: TOYOTA_PART.part_number },
            { part_number: "90915-10009" },
            { part_number: "90915-10003" },
          ],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 30,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items.length, 3);
        assert.deepEqual(
          finished.items.map((i) => i.part_number),
          [TOYOTA_PART.part_number, "90915-10009", "90915-10003"],
        );
        assert.equal(finished.items[0].result, "IMPORTED");
        assert.equal(finished.items[1].result, "NOT_FOUND");
        assert.equal(finished.items[2].result, "NOT_FOUND");
      } finally {
        backends.restore();
      }
    }),
  );
});

test("CSV import: part_number is required, manufacturer/notes/internal_sku are optional", () => {
  const csv =
    "part_number,manufacturer,notes\n90915-10009,Toyota,Oil filter\n15690-65010,Toyota,Oil cooler relief valve\n";
  const lines = importLinesFromCsv(parseCsv(csv));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].part_number, "90915-10009");
  assert.equal(lines[0].manufacturer, "Toyota");
  assert.equal(lines[0].notes, "Oil filter");
  assert.throws(
    () => importLinesFromCsv(parseCsv("wrong_column\nfoo\n")),
    /part_number/,
  );
});

test("pasted multi-line list parses one part number per non-blank line", () => {
  const lines = parseImportLines(
    "90915-10009\n90915-10003\n\n90915-CA003\n15690-65010\n",
  );
  assert.deepEqual(
    lines.map((l) => l.part_number),
    ["90915-10009", "90915-10003", "90915-CA003", "15690-65010"],
  );
});

test("duplicate part number within one job: second occurrence sees the first's write and reports ALREADY_AVAILABLE", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [
            { part_number: TOYOTA_PART.part_number },
            { part_number: TOYOTA_PART.part_number },
          ],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 30,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "IMPORTED");
        assert.equal(finished.items[1].result, "ALREADY_AVAILABLE");
        assert.equal(finished.imported_count, 1);
        assert.equal(finished.already_available_count, 1);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("already-cached part: IntraForge hit short-circuits, Toyota EPC is never called", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const seeded = toIntraForgePart({
        part_number: TOYOTA_PART.part_number,
        description: TOYOTA_PART.name,
        manufacturer: "Toyota",
        diagram_code: TOYOTA_PART.figure_key,
        provider: "toyota-epc",
        provider_diagram_id: TOYOTA_PART.figure_key,
        callout: TOYOTA_PART.pnc,
        source_image_url: "https://example.test/MAB896.png",
        applicability: "",
        fitment_notes: "",
        ...TOYOTA_PART.rect,
      });
      const backends = fakeBackends({ seed: [seeded] });
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "ALREADY_AVAILABLE");
        assert.equal(
          backends.toyotaCalls(),
          0,
          "Toyota EPC must not be touched for a cache hit",
        );
      } finally {
        backends.restore();
      }
    }),
  );
});

test("not-found part: Toyota EPC search returns no match", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: "00000-00000" }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "NOT_FOUND");
        assert.equal(finished.not_found_count, 1);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("provider failure: a Toyota EPC error is recorded as PROVIDER_ERROR and the job still finishes", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_FAILING_PART }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id, 10_000);
        assert.equal(finished.items[0].result, "PROVIDER_ERROR");
        assert.equal(finished.status, "FAILED");
        assert.equal(finished.error_count, 1);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("provider disabled (TOYOTA_EPC_ENABLED unset): cache miss is RESTRICTED, no network call is made", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: undefined }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "RESTRICTED");
        assert.equal(backends.toyotaCalls(), 0);
      } finally {
        backends.restore();
      }
    }),
  );
});

test('"resolve via provider" unchecked: cache miss is RESTRICTED even with the provider enabled — a pure cache-only check', async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: false,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "RESTRICTED");
        assert.equal(backends.toyotaCalls(), 0);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("rate limiting: sequential requests are spaced by delayMs, never fired back-to-back", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const started = Date.now();
        const job = await startImportJob({
          lines: [
            { part_number: "90915-10009" },
            { part_number: "90915-10003" },
            { part_number: "90915-CA003" },
          ],
          createdBy: "Owner",
          useProvider: true,
          batchSize: 10, // no mid-batch cooldown; isolate the per-item delay
          delayMs: 150,
        });
        const finished = await waitForFinish(job.job_id, 10_000);
        const elapsed = Date.now() - started;
        assert.equal(finished.items.length, 3);
        // 3 network-touching items -> 2 inter-item delays of >=150ms each
        assert.ok(
          elapsed >= 280,
          `expected >=280ms for two 150ms delays, took ${elapsed}ms`,
        );
      } finally {
        backends.restore();
      }
    }),
  );
});

test("partial batch failure: a mix of success and failure yields job status PARTIAL", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [
            { part_number: TOYOTA_PART.part_number },
            { part_number: "not a real part #" },
          ],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 30,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.status, "PARTIAL");
        assert.equal(finished.imported_count, 1);
        assert.ok(finished.error_count >= 1);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("retry: a follow-up job re-attempts only the failed/not-found/restricted items, never the succeeded one", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const first = await startImportJob({
          lines: [
            { part_number: TOYOTA_PART.part_number },
            { part_number: "00000-00000" },
          ],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 30,
        });
        await waitForFinish(first.job_id);
        const retry = await retryFailedItems(first.job_id, "Owner");
        assert.equal(retry.input_count, 1);
        const finishedRetry = await waitForFinish(retry.job_id);
        assert.equal(finishedRetry.items[0].part_number, "00000-00000");
        assert.equal(finishedRetry.items[0].result, "NOT_FOUND");

        // A job whose only item already succeeded (ALREADY_AVAILABLE, from
        // the first job's own IMPORTED write) has nothing left to retry.
        const allSucceeded = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finishedAllSucceeded = await waitForFinish(allSucceeded.job_id);
        assert.equal(finishedAllSucceeded.items[0].result, "ALREADY_AVAILABLE");
        await assert.rejects(
          retryFailedItems(allSucceeded.job_id, "Owner"),
          /no failed, not-found, or restricted items/,
        );
      } finally {
        backends.restore();
      }
    }),
  );
});

test("offline search after import: once cached, the part is found without touching Toyota EPC, even with the provider disabled", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        await waitForFinish(job.job_id);
        const overview = offlineReadiness();
        assert.equal(overview.cachedParts, 3);
        assert.equal(overview.cachedDiagrams, 1);
        assert.equal(overview.cachedCallouts, 3);
        assert.equal(overview.partsWithHotspot, 3);

        const callsAfterImport = backends.toyotaCalls();
        // Simulate "back offline": provider disabled, but the search
        // still succeeds purely from the IntraForge cache, same as the
        // existing oem-search cache-hit path.
        await withEnv({ TOYOTA_EPC_ENABLED: undefined }, async () => {
          const found = await searchOemPart(TOYOTA_PART.part_number);
          assert.ok(
            found,
            "expected the just-imported part to be found offline",
          );
          assert.equal(found?.part_number, TOYOTA_PART.part_number);
        });
        assert.equal(
          backends.toyotaCalls(),
          callsAfterImport,
          "offline search must not touch Toyota EPC at all",
        );
      } finally {
        backends.restore();
      }
    }),
  );
});

test("a figure import stores every part number on the drawing, so all of them are searchable offline", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "IMPORTED");
        assert.match(finished.items[0].message, /3 part numbers/);

        // The two numbers nobody asked for are cached too.
        for (const other of ["15690-65020", "15785-35010"])
          assert.ok(backends.store.has(normalizeNumber(other)), other);

        // The stored snapshot keeps every line (variants of one number
        // included), one group per listed callout, collapsed fitment codes,
        // and the unlisted fastener callout as a hotspot with no group.
        const figure = [...backends.figures.values()][0] as {
          hotspots: { resolved: boolean }[];
          groups: {
            callout: string;
            rect: { width: number } | null;
            rows: {
              part_number: string;
              is_current: boolean;
              fitment: { code: string }[];
            }[];
          }[];
        };
        assert.equal(figure.groups.length, 2);
        assert.equal(figure.hotspots.filter((h) => !h.resolved).length, 1);
        const valve = figure.groups[0];
        assert.equal(valve.callout, TOYOTA_PART.pnc);
        assert.equal(valve.rect?.width, 66);
        assert.equal(valve.rows.length, 3); // 15690-65010 twice + 15690-65020
        assert.deepEqual(
          valve.rows[0].fitment.map((f) => f.code),
          ["3VZE", "VZN85,90"],
        );
        assert.equal(valve.rows[0].is_current, false);
        assert.equal(valve.rows[1].is_current, true);

        const overview = offlineReadiness();
        assert.equal(overview.cachedParts, 3);
        assert.equal(overview.cachedDiagrams, 1);
        assert.equal(overview.cachedCallouts, 3);
        assert.equal(overview.partsWithHotspot, 3);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("a part that is not on the section's primary drawing is found through its part group", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_OTHER_FIGURE_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "IMPORTED");
        const stored = backends.store.get(TOYOTA_OTHER_FIGURE_PART.normalized);
        assert.equal(
          stored?.diagram_parts[0].diagram.provider_diagram_id,
          TOYOTA_OTHER_FIGURE_PART.figure_key,
        );
      } finally {
        backends.restore();
      }
    }),
  );
});

test("a part cached before figures existed gets its whole figure attached, without duplicating the record", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const legacy = toIntraForgePart({
        part_number: TOYOTA_PART.part_number,
        description: TOYOTA_PART.name,
        manufacturer: "Toyota",
        diagram_code: TOYOTA_PART.figure_key,
        provider: "toyota-epc",
        provider_diagram_id: TOYOTA_PART.figure_key,
        callout: TOYOTA_PART.pnc,
        source_image_url: "https://example.test/MAB896.png",
        applicability: "",
        fitment_notes: "",
      });
      legacy.diagram_parts[0].diagram.has_figure = false;
      const backends = fakeBackends({ seed: [legacy] });
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "IMPORTED");
        assert.match(finished.items[0].message, /full figure/);
        assert.equal(backends.figures.size, 1);
        assert.ok(backends.store.has(normalizeNumber("15785-35010")));
      } finally {
        backends.restore();
      }
    }),
  );
});

test("a part cached without a figure stays ALREADY_AVAILABLE, with no external call, when the provider is off", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: undefined }, async () => {
      const legacy = toIntraForgePart({
        part_number: TOYOTA_PART.part_number,
        description: TOYOTA_PART.name,
        manufacturer: "Toyota",
        diagram_code: TOYOTA_PART.figure_key,
        provider: "toyota-epc",
        provider_diagram_id: TOYOTA_PART.figure_key,
        callout: TOYOTA_PART.pnc,
        source_image_url: "",
        applicability: "",
        fitment_notes: "",
      });
      legacy.diagram_parts[0].diagram.has_figure = false;
      const backends = fakeBackends({ seed: [legacy] });
      try {
        const job = await startImportJob({
          lines: [{ part_number: TOYOTA_PART.part_number }],
          createdBy: "Owner",
          useProvider: true,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "ALREADY_AVAILABLE");
        assert.equal(backends.toyotaCalls(), 0);
      } finally {
        backends.restore();
      }
    }),
  );
});

test("authorization: import endpoints require the Owner/Administrator demo persona", async () => {
  await withCleanStore(() =>
    withEnv(intraforgeEnv, async () => {
      const salesReq = new Request(
        "http://localhost/api/catalogue?action=import-jobs",
        {
          headers: { "x-demo-role": "Sales" },
        },
      );
      const salesRes = await GET(salesReq);
      assert.equal(salesRes.status, 403);

      const ownerReq = new Request(
        "http://localhost/api/catalogue?action=import-jobs",
        {
          headers: { "x-demo-role": "Owner" },
        },
      );
      const ownerRes = await GET(ownerReq);
      assert.equal(ownerRes.status, 200);
      assert.deepEqual(await ownerRes.json(), []);

      const startReq = new Request("http://localhost/api/catalogue", {
        method: "POST",
        headers: { "x-demo-role": "Sales", "content-type": "application/json" },
        body: JSON.stringify({
          action: "import-start",
          lines: [{ part_number: TOYOTA_PART.part_number }],
        }),
      });
      const startRes = await POST(startReq);
      assert.equal(startRes.status, 403);
      assert.equal(listImportJobs().length, 0);
    }),
  );
});

test("a pasted line can name the vehicle catalogue the drawing should come from", () => {
  const lines = parseImportLines(
    "15600-25010, 221230\n15690-65010\n90915-10009;671450",
  );
  assert.deepEqual(lines, [
    { part_number: "15600-25010", catalogue: "221230" },
    { part_number: "15690-65010" },
    { part_number: "90915-10009", catalogue: "671450" },
  ]);
  const csv = importLinesFromCsv(
    parseCsv("part_number,catalogue\n15600-25010,221230\n15690-65010,\n"),
  );
  assert.equal(csv[0].catalogue, "221230");
  assert.equal(csv[1].catalogue, undefined);
});

test("catalogue hint: the drawing comes from the named vehicle, and a wrong hint is NOT_FOUND rather than a guess", async () => {
  await withCleanStore(() =>
    withEnv({ ...intraforgeEnv, TOYOTA_EPC_ENABLED: "true" }, async () => {
      const backends = fakeBackends();
      try {
        const job = await startImportJob({
          lines: [
            { part_number: TOYOTA_PART.part_number, catalogue: "999999" },
            {
              part_number: TOYOTA_PART.part_number,
              catalogue: TOYOTA_CATALOG.catalog_code,
            },
          ],
          createdBy: "Owner",
          useProvider: true,
          delayMs: 30,
        });
        const finished = await waitForFinish(job.job_id);
        assert.equal(finished.items[0].result, "NOT_FOUND");
        assert.equal(finished.items[1].result, "IMPORTED");
      } finally {
        backends.restore();
      }
    }),
  );
});

test("the drawing proxy serves only what IntraForge returns for a valid diagram id", async () => {
  await withEnv(intraforgeEnv, async () => {
    const original = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      seen.push(String(input));
      assert.match(
        String((init?.headers as Record<string, string>).Authorization),
        /^Bearer test-token$/,
      );
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    try {
      const good = await drawingGet(
        new Request(
          "http://localhost/api/catalogue/diagram-image?id=0d6f2b0e-6f7a-4a52-9a4e-3b1f2c3d4e5f",
        ),
      );
      assert.equal(good.status, 200);
      assert.equal(good.headers.get("content-type"), "image/png");
      assert.equal(good.headers.get("x-content-type-options"), "nosniff");
      // A traversal-style or malformed id never reaches IntraForge at all.
      const before = seen.length;
      for (const id of ["../../admin", "abc", ""])
        assert.equal(
          (
            await drawingGet(
              new Request(
                `http://localhost/api/catalogue/diagram-image?id=${encodeURIComponent(id)}`,
              ),
            )
          ).status,
          404,
        );
      assert.equal(seen.length, before);
    } finally {
      globalThis.fetch = original;
    }
  });
});
