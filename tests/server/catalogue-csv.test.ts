import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeApp, seedBasics, type TestApp } from "./helpers";
import { AppError } from "../../src/server/kernel/errors";
import {
  csvCell,
  looksLikeFormula,
  parseCsv,
  toCsv,
} from "../../src/server/catalogue/csv";
import {
  detectColumns,
  normalizeDate,
} from "../../src/server/catalogue/importer";
import type { ColumnMapping } from "../../src/server/catalogue/model";

const BATCH = readFileSync(
  join(
    __dirname,
    "../fixtures/catalogue/intraforge_reference_catalogue_batch_001.csv",
  ),
);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError
      ? e.code
      : `UNEXPECTED:${(e as Error).message}`;
  }
};
async function importCsv(
  t: TestApp,
  content: string | Uint8Array,
  extra: Record<string, unknown> = {},
) {
  const detected = await t.app.catalogueImport.detect(t.actors.ADMIN, content);
  const staged = await t.app.catalogueImport.stageCsv(t.actors.ADMIN, {
    content,
    fileName: "test.csv",
    mapping: detected.suggestedMapping,
    attested: true,
    ...extra,
  });
  return { detected, staged };
}
const rowsOf = (t: TestApp, jobId: string, status?: string) =>
  t.app.catalogueImport.rows(t.actors.ADMIN, jobId, {
    status: status as never,
    pageSize: 200,
  });

test("CSV parsing: BOM, quotes, commas and newlines inside quotes, CRLF, and shape errors", () => {
  const csv =
    '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",z\r\n3,only-two\r\n';
  const p = parseCsv(csv);
  assert.deepEqual(p.headers, ["a", "b", "c"]);
  assert.deepEqual(p.rows[0].cells, ["1", "x, y", 'say "hi"']);
  assert.deepEqual(p.rows[1].cells, ["2", "line1\nline2", "z"]);
  assert.equal(p.rows[1].line, 3);
  assert.equal(p.rows[2].shapeError, "Expected 3 columns but found 2.");
  assert.equal(p.rows[2].line, 5, "line numbers count embedded newlines");
  assert.deepEqual(
    parseCsv("a,b\n1,2").rows[0].cells,
    ["1", "2"],
    "LF only, no trailing newline",
  );
  assert.deepEqual(parseCsv("a,b\r1,2\r").rows[0].cells, ["1", "2"], "CR only");
});

test("CSV parsing rejects hostile or malformed files with clear messages", () => {
  assert.throws(() => parseCsv(""), /empty/);
  assert.throws(() => parseCsv("a,a\n1,2"), /twice/);
  assert.throws(() => parseCsv("a,\n1,2"), /heading/);
  assert.throws(() => parseCsv('a,b\n"unterminated,2'), /never closed/);
  assert.throws(() => parseCsv('a,b\n1,"x"y'), /after a quoted/);
  assert.throws(() => parseCsv("__proto__,b\n1,2"), /permitted/);
  assert.throws(() => parseCsv("a,b\n1,2", { maxBytes: 3 }), /larger than/);
  assert.throws(
    () => parseCsv("a\n" + "x\n".repeat(50), { maxRows: 10 }),
    /more than/,
  );
  assert.throws(
    () => parseCsv("a\n" + "x".repeat(100), { maxFieldLength: 50 }),
    /longer than/,
  );
  assert.throws(
    () =>
      parseCsv(Array.from({ length: 90 }, (_, i) => `c${i}`).join(",") + "\n1"),
    /columns/,
  );
  assert.throws(
    () => parseCsv(new Uint8Array([0x61, 0x2c, 0xff, 0x0a, 0x31])),
    TypeError,
    "invalid UTF-8 is refused, not silently mangled",
  );
});

test("spreadsheet formula injection is neutralized when exporting", () => {
  for (const evil of [
    '=HYPERLINK("http://x")',
    "+SUM(1)",
    "-2+3",
    "@cmd",
    "\t=1",
    " =1",
  ]) {
    assert.equal(looksLikeFormula(evil), true, evil);
    assert.match(csvCell(evil), /^"?'/, evil);
  }
  for (const fine of ["-8208", "+5", "12.5", "text", "a=b"])
    assert.equal(looksLikeFormula(fine), false, fine);
  assert.equal(toCsv(["h"], [["=1+1"]]), "h\r\n'=1+1\r\n");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
});

test("dates accept year, year-month and full dates and reject nonsense", () => {
  assert.equal(normalizeDate("1984-11"), "1984-11");
  assert.equal(normalizeDate("1984/1"), "1984-01");
  assert.equal(normalizeDate("1984"), "1984");
  assert.equal(normalizeDate("1984-11-05"), "1984-11-05");
  assert.equal(normalizeDate(""), null);
  for (const bad of ["1984-13", "84-11", "abcd", "1984-11-40", "1700"])
    assert.equal(normalizeDate(bad), "INVALID", bad);
});

test("Batch 001: columns are detected and mapped without hard-coding", async () => {
  const detected = detectColumns(parseCsv(BATCH));
  assert.equal(detected.rowCount, 23);
  assert.deepEqual(detected.unmappedRequired, []);
  const m = detected.suggestedMapping;
  assert.equal(m.oem_number, "oem_number");
  assert.equal(m.vehicle, "vehicle");
  assert.equal(m.production_from, "production_from");
  assert.equal(m.price_jpy, "price_jpy");
  assert.equal(m.source_url, "source_url");
  // a future CSV with different headings and extra columns still maps
  const other = detectColumns(
    parseCsv(
      "Part Number,Name,Brand,Model,Region,Some New Column\n1,2,3,4,5,6",
    ),
  );
  assert.equal(other.suggestedMapping.oem_number, "Part Number");
  assert.equal(other.suggestedMapping.description, "Name");
  assert.equal(other.suggestedMapping.manufacturer, "Brand");
  assert.equal(other.suggestedMapping.vehicle, "Model");
  assert.equal(other.suggestedMapping.market, "Region");
  assert.ok(!Object.values(other.suggestedMapping).includes("Some New Column"));
});

test("Batch 001 imports end to end with full provenance and no invented data", async () => {
  const t = await makeApp();
  try {
    const { staged } = await importCsv(t, BATCH);
    assert.equal(staged.status, "REVIEW_REQUIRED");
    assert.deepEqual(
      [staged.discovered, staged.valid, staged.invalid, staged.duplicates],
      [23, 23, 0, 0],
    );
    assert.equal(
      (await t.app.catalogue.stats(t.actors.ADMIN)).parts,
      0,
      "staging writes no catalogue data",
    );
    const job = await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    assert.equal(job.status, "COMPLETED", "every row was clean");
    assert.deepEqual(
      [job.processed, job.created, job.updated, job.unchanged],
      [23, 23, 0, 0],
    );
    const stats = await t.app.catalogue.stats(t.actors.ADMIN);
    assert.equal(stats.parts, 23);
    assert.equal(stats.manufacturers, 2);
    assert.equal(
      stats.fitments,
      22 + 3,
      "22 Nissan rows x 1 chassis + Toyota's 3 chassis codes",
    );

    const toyota = (await t.app.catalogue.partByOem(
      t.actors.ADMIN,
      "12204 15030",
    ))!;
    assert.equal(toyota.oemNumber, "12204-15030");
    assert.equal(toyota.description, "Valve Sub-assy, Ventilation");
    assert.equal(toyota.manufacturer, "Toyota");
    assert.equal(toyota.pnc, "12204");
    assert.equal(toyota.statusClass, "SUPERSEDED");
    assert.equal(toyota.status, "Superseded / ended 1987-11");
    assert.deepEqual(toyota.fitments.map((f) => f.chassis).sort(), [
      "AT151",
      "CT150",
      "ST15#",
    ]);
    assert.ok(
      toyota.fitments.every(
        (f) =>
          f.model === "Corona / Carina 2" &&
          f.market === "EU" &&
          f.productionFrom === "1984-11" &&
          f.productionTo === "1987-11",
      ),
    );
    assert.deepEqual(
      toyota.fitments[0].engines,
      ["4AL#"],
      "the '(fitment code)' remark is dropped from the code, kept in the text",
    );
    assert.match(toyota.fitments[0].engineText, /fitment code/);
    assert.equal(toyota.sources[0].sourceKey, "toyota-epc");
    assert.equal(
      toyota.sources[0].sourceUrl,
      "https://toyota-epc.aftermarketcatalog.com/part/2065471",
    );
    assert.equal(toyota.sources[0].importJobId, job.id);
    assert.match(
      toyota.notes + toyota.facts[0].notes,
      /MA6410; MA6743; MA7239/,
      "figure names stay as the source's own note",
    );
    assert.equal(
      toyota.drawings.length,
      0,
      "figures mentioned only in free text are not turned into structured data",
    );

    const nut = (await t.app.catalogue.partByOem(
      t.actors.ADMIN,
      "11258-D0101",
    ))!;
    assert.equal(nut.manufacturer, "Nissan");
    assert.equal(nut.pnc, "", "missing values stay blank, never fabricated");
    assert.deepEqual(
      [nut.facts[0].priceUsdMinor, nut.facts[0].priceJpy],
      [258, 397],
      "source-page prices are kept as reference evidence",
    );
    assert.equal(nut.statusClass, "ACTIVE");
    assert.deepEqual(nut.fitments[0].engines, ["CA18DT", "SR20DE", "SR20DET"]);
    assert.equal(nut.fitments[0].model, "180SX");
    assert.equal(nut.fitments[0].chassis, "RS13");
    assert.equal(nut.linkedProducts.length, 0);
    const ended = (await t.app.catalogue.partByOem(
      t.actors.ADMIN,
      "11110-36F00",
    ))!;
    assert.equal(ended.statusClass, "ENDED");
  } finally {
    await t.cleanup();
  }
});

test("importing the same file again changes nothing (idempotent) and duplicates nothing", async () => {
  const t = await makeApp();
  try {
    const first = await importCsv(t, BATCH);
    await t.app.catalogueImport.commit(t.actors.ADMIN, first.staged.id);
    const before = await t.app.catalogue.stats(t.actors.ADMIN);
    const second = await importCsv(t, BATCH);
    const preview = await rowsOf(t, second.staged.id);
    assert.ok(
      preview.items.every((r) => r.action === "NONE"),
      "every row is recognised as already present",
    );
    const job = await t.app.catalogueImport.commit(
      t.actors.ADMIN,
      second.staged.id,
    );
    assert.deepEqual([job.created, job.updated, job.unchanged], [0, 0, 23]);
    assert.deepEqual(await t.app.catalogue.stats(t.actors.ADMIN), {
      ...before,
      importJobs: before.importJobs + 1,
    });
    // committing a finished job again is a no-op
    assert.equal(
      (await t.app.catalogueImport.commit(t.actors.ADMIN, second.staged.id))
        .unchanged,
      23,
    );
  } finally {
    await t.cleanup();
  }
});

test("invalid rows are reported with reasons, never silently dropped; valid rows still import", async () => {
  const t = await makeApp();
  try {
    const csv = [
      "oem_number,description,manufacturer,production_from,production_to,price_usd,price_jpy,source_url,vehicle",
      "GOOD-1,Good part,Toyota,1990-01,1995-12,10.50,1500,https://example.com/p/1,Corolla",
      ",No number,Toyota,,,,,,",
      "BAD-DATE,Bad date,Toyota,1990-13,,,,,",
      "BAD-RANGE,Backwards,Toyota,1999,1990,,,,",
      "BAD-PRICE,Bad price,Toyota,,,12.345,,,",
      "BAD-JPY,Bad yen,Toyota,,,,12.5,,",
      "BAD-URL,Bad url,Toyota,,,,,http://localhost/x,",
      "BAD-URL2,Bad url,Toyota,,,,,https://user:pw@example.com/,",
      "NO-MAKE,No manufacturer,,,,,,,",
      "TOO-FEW,columns",
      "CTRL\u0001,Control char,Toyota,,,,,,",
    ].join("\n");
    const { staged } = await importCsv(t, csv);
    assert.equal(staged.valid, 1);
    assert.equal(staged.invalid, 10);
    const bad = (await rowsOf(t, staged.id, "INVALID")).items;
    const reasons = Object.fromEntries(
      bad.map((r) => [r.rowNumber, r.errors.join(" ")]),
    );
    assert.match(reasons[3], /oem_number is required/);
    assert.match(reasons[4], /production_from is not a valid date/);
    assert.match(reasons[5], /after production_to/);
    assert.match(reasons[6], /price_usd/);
    assert.match(reasons[7], /price_jpy/);
    assert.match(reasons[8], /source_url/);
    assert.match(reasons[9], /source_url/);
    assert.match(reasons[10], /manufacturer is required/);
    assert.match(reasons[11], /Expected 9 columns but found 2/);
    assert.match(reasons[12], /control character/);
    const job = await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    assert.equal(job.status, "COMPLETED_WITH_WARNINGS");
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 1);
    assert.equal(job.skipped, 10);
    assert.equal(job.errors, 10);
  } finally {
    await t.cleanup();
  }
});

test("a manufacturer can be supplied as a default; the first mapping errors are refused up front", async () => {
  const t = await makeApp();
  try {
    const csv = "part,name\nAA-1,Thing one\nAA-2,Thing two";
    const detected = await t.app.catalogueImport.detect(t.actors.ADMIN, csv);
    assert.deepEqual(detected.unmappedRequired, ["manufacturer"]);
    assert.equal(
      await code(
        t.app.catalogueImport.stageCsv(t.actors.ADMIN, {
          content: csv,
          fileName: "x.csv",
          mapping: detected.suggestedMapping,
          attested: true,
        }),
      ),
      "VALIDATION",
    );
    const { staged } = await importCsv(t, csv, {
      defaultManufacturer: "Honda",
      defaultSource: "Supplier list",
    });
    assert.equal(staged.valid, 2);
    const job = await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    assert.equal(job.created, 2);
    assert.equal(
      (await t.app.catalogue.partByOem(t.actors.ADMIN, "AA-1"))!.manufacturer,
      "Honda",
    );
    assert.equal(
      await code(
        t.app.catalogueImport.stageCsv(t.actors.ADMIN, {
          content: csv,
          fileName: "x.csv",
          mapping: { oem_number: "nope" } as ColumnMapping,
          attested: true,
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.catalogueImport.stageCsv(t.actors.ADMIN, {
          content: csv,
          fileName: "x.csv",
          mapping: {
            oem_number: "part",
            manufacturer: "part",
            evil: "part",
          } as never,
          attested: true,
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.catalogueImport.stageCsv(t.actors.ADMIN, {
          content: csv,
          fileName: "x.csv",
          mapping: detected.suggestedMapping,
          attested: false,
          defaultManufacturer: "X",
        }),
      ),
      "VALIDATION",
      "operator attestation is required",
    );
  } finally {
    await t.cleanup();
  }
});

test("in-file duplicates are skipped; conflicting statements are both kept as evidence with a deterministic display rule", async () => {
  const t = await makeApp();
  try {
    const csv = [
      "oem_number,description,manufacturer,vehicle,chassis,market,source",
      "X-100,First description,Toyota,Corolla,E100,EU,Aftermarket Aggregator",
      "X-100,First description,Toyota,Corolla,E100,EU,Aftermarket Aggregator",
      "X-100,Different description,Toyota,Corolla,E100,EU,Aftermarket Aggregator",
      "X-100,Official description,Toyota,Corolla,E100,EU,Toyota Official",
    ].join("\n");
    const { staged } = await importCsv(t, csv);
    assert.equal(staged.duplicates, 1);
    assert.equal(
      (await rowsOf(t, staged.id, "DUPLICATE")).items[0].rowNumber,
      3,
    );
    assert.ok(
      (await rowsOf(t, staged.id, "VALID")).items.some((r) =>
        r.warnings.some((w) => /Conflicts with an earlier row/.test(w)),
      ),
    );
    // rank the official source above the aggregator, then import
    await t.app.catalogue.saveSource(t.actors.OWNER, {
      providerKey: "toyota-official",
      name: "Toyota Official",
      priority: 1,
    });
    await t.app.catalogue.saveSource(t.actors.OWNER, {
      providerKey: "aftermarket-aggregator",
      name: "Aftermarket Aggregator",
      priority: 50,
    });
    await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    const part = (await t.app.catalogue.partByOem(t.actors.ADMIN, "X100"))!;
    assert.equal(
      part.description,
      "Official description",
      "highest-priority source is displayed",
    );
    assert.deepEqual(
      part.facts.map((f) => `${f.sourceKey}: ${f.description}`).sort(),
      [
        "aftermarket-aggregator: Different description",
        "aftermarket-aggregator: First description",
        "toyota-official: Official description",
      ],
      "nothing is erased: every source's statement is preserved",
    );
    assert.equal(
      (await t.app.catalogue.stats(t.actors.ADMIN)).parts,
      1,
      "one master part regardless of how many sources describe it",
    );
  } finally {
    await t.cleanup();
  }
});

test("one OEM number fits many vehicles and appears once as a master part", async () => {
  const t = await makeApp();
  try {
    const csv = [
      "oem_number,description,manufacturer,vehicle,chassis,engine,production_from,production_to,market,category",
      "90915-10001,Oil filter,Toyota,Corolla,AE101,4A-FE,1991,1997,EU,Engine",
      "90915-10001,Oil filter,Toyota,Corolla,AE111; AE112,4A-FE; 5A-FE,1995,1999,EU,Engine",
      "90915-10001,Oil filter,Toyota,Carina,AT190,4A-FE,1992,1996,JP,Engine",
    ].join("\n");
    const { staged } = await importCsv(t, csv);
    const job = await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    assert.deepEqual([job.created, job.updated], [1, 2]);
    const stats = await t.app.catalogue.stats(t.actors.ADMIN);
    assert.equal(stats.parts, 1);
    assert.equal(stats.fitments, 4);
    const part = (await t.app.catalogue.partByOem(
      t.actors.ADMIN,
      "9091510001",
    ))!;
    assert.deepEqual([...new Set(part.fitments.map((f) => f.model))].sort(), [
      "Carina",
      "Corolla",
    ]);
    assert.deepEqual(part.catalogues.map((c) => c.code).sort(), [
      "Carina JP",
      "Corolla EU",
    ]);
    // search by vehicle narrows correctly
    const s = t.actors.ADMIN;
    assert.equal(
      (await t.app.catalogue.search(s, { model: "carina" })).total,
      1,
    );
    assert.equal(
      (await t.app.catalogue.search(s, { chassis: "ae112" })).total,
      1,
    );
    assert.equal(
      (await t.app.catalogue.search(s, { engine: "5a-fe" })).total,
      1,
    );
    assert.equal((await t.app.catalogue.search(s, { year: 1990 })).total, 0);
    assert.equal((await t.app.catalogue.search(s, { year: 1993 })).total, 1);
    assert.equal((await t.app.catalogue.search(s, { year: 2005 })).total, 0);
    assert.equal((await t.app.catalogue.search(s, { market: "JP" })).total, 1);
    assert.equal(
      (await t.app.catalogue.search(s, { model: "Civic" })).total,
      0,
    );
  } finally {
    await t.cleanup();
  }
});

test("catalogue search: OEM number in any format, words, prefixes, and hostile input", async () => {
  const t = await makeApp();
  try {
    const { staged } = await importCsv(t, BATCH);
    await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    const s = t.actors.VIEWER;
    for (const q of [
      "12204-15030",
      "1220415030",
      "12204 15030",
      "12204-1503",
      "valve sub-assy",
    ])
      assert.ok(
        (await t.app.catalogue.search(s, { q })).items.some(
          (i) => i.oemNumber === "12204-15030",
        ),
        q,
      );
    assert.equal(
      (await t.app.catalogue.search(s, { q: "180sx nut" })).items.every((i) =>
        /nut/i.test(i.description),
      ),
      true,
    );
    assert.equal((await t.app.catalogue.search(s, { q: "180SX" })).total, 22);
    assert.equal(
      (await t.app.catalogue.search(s, { manufacturer: "toyota" })).total,
      1,
    );
    assert.equal(
      (await t.app.catalogue.search(s, { status: "ENDED" })).total,
      4,
    );
    assert.equal(
      (await t.app.catalogue.search(s, { section: "Electronics" })).total,
      5,
    );
    const paged = await t.app.catalogue.search(s, {
      manufacturer: "Nissan",
      pageSize: 10,
      page: 3,
    });
    assert.deepEqual([paged.items.length, paged.total, paged.page], [2, 22, 3]);
    for (const hostile of [
      '"',
      "*",
      "OR AND NOT",
      "'; DROP TABLE catalogue_parts; --",
      "a b c d e f g h i j k l",
      "%",
      "_",
      "\\",
      "near(",
      "col:",
      "\u0000",
    ])
      await assert.doesNotReject(
        t.app.catalogue.search(s, { q: hostile }),
        hostile,
      );
    assert.equal((await t.app.catalogue.stats(s)).parts, 23);
    assert.equal(await code(t.app.catalogue.search(t.actors.SALES, {})), "OK");
  } finally {
    await t.cleanup();
  }
});

test("staged rows can be excluded before importing; cancelling before import writes nothing", async () => {
  const t = await makeApp();
  try {
    const csv =
      "oem_number,description,manufacturer\nA-1,One,Toyota\nA-2,Two,Toyota\nA-3,Three,Toyota";
    const { staged } = await importCsv(t, csv);
    const rows = (await rowsOf(t, staged.id)).items;
    const excluded = await t.app.catalogueImport.excludeRow(
      t.actors.ADMIN,
      staged.id,
      rows[1].id,
      true,
    );
    assert.equal(excluded!.valid, 2);
    const job = await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    assert.equal(job.processed, 2);
    assert.equal(
      job.status,
      "COMPLETED_WITH_WARNINGS",
      "an excluded row is flagged, not hidden",
    );
    assert.equal(await t.app.catalogue.partByOem(t.actors.ADMIN, "A-2"), null);

    const other = await importCsv(
      t,
      "oem_number,description,manufacturer\nB-1,One,Toyota",
    );
    const cancelled = await t.app.catalogueImport.cancel(
      t.actors.ADMIN,
      other.staged.id,
    );
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(await t.app.catalogue.partByOem(t.actors.ADMIN, "B-1"), null);
    assert.equal(
      await code(
        t.app.catalogueImport.excludeRow(
          t.actors.ADMIN,
          other.staged.id,
          "x",
          true,
        ),
      ),
      "CONFLICT",
    );
  } finally {
    await t.cleanup();
  }
});

test("a large import is chunked, cancellable, and resumes without repeating work", async () => {
  const t = await makeApp();
  try {
    const lines = [
      "oem_number,description,manufacturer,vehicle,chassis,market",
    ];
    for (let i = 0; i < 1200; i++)
      lines.push(
        `Z-${String(i).padStart(5, "0")},Part ${i},Toyota,Corolla,E${100 + (i % 9)},EU`,
      );
    const { staged } = await importCsv(t, lines.join("\n"));
    assert.equal(staged.valid, 1200);
    const repo = t.container.repos.catalogue;
    const partial = await t.app.catalogueImport.commit(
      t.actors.ADMIN,
      staged.id,
      {
        chunkSize: 300,
        afterChunk: async (n) => {
          if (n === 2) await repo.requestCancel(staged.id);
        },
      },
    );
    assert.equal(partial.status, "CANCELLED");
    assert.equal(partial.processed, 600);
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 600);
    const resumed = await t.app.catalogueImport.commit(
      t.actors.ADMIN,
      staged.id,
      { chunkSize: 300 },
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual([resumed.processed, resumed.created], [1200, 1200]);
    assert.equal(
      (await t.app.catalogue.stats(t.actors.ADMIN)).parts,
      1200,
      "no part was imported twice",
    );
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).vehicles, 9);
    // search stays fast on a larger set and never loads the catalogue wholesale
    const started = Date.now();
    const hit = await t.app.catalogue.search(t.actors.ADMIN, { q: "Z-00777" });
    assert.equal(hit.items[0].oemNumber, "Z-00777");
    assert.ok(Date.now() - started < 500);
    assert.ok(
      (
        await t.app.catalogue.search(t.actors.ADMIN, {
          q: "Part",
          pageSize: 20,
        })
      ).items.length <= 20,
    );
  } finally {
    await t.cleanup();
  }
});

test("catalogue import and governance are permission controlled", async () => {
  const t = await makeApp();
  try {
    const csv = "oem_number,description,manufacturer\nP-1,One,Toyota";
    for (const role of ["SALES", "INVENTORY", "VIEWER"] as const) {
      assert.equal(
        await code(t.app.catalogueImport.detect(t.actors[role], csv)),
        "FORBIDDEN",
        role,
      );
      assert.equal(
        await code(
          t.app.catalogueImport.stageCsv(t.actors[role], {
            content: csv,
            fileName: "x",
            mapping: { oem_number: "oem_number", manufacturer: "manufacturer" },
            attested: true,
          }),
        ),
        "FORBIDDEN",
        role,
      );
      assert.equal(
        await code(t.app.catalogueImport.listJobs(t.actors[role])),
        "FORBIDDEN",
        role,
      );
      assert.equal(
        await code(
          t.app.catalogue.saveSource(t.actors[role], {
            providerKey: "x",
            name: "X",
          }),
        ),
        "FORBIDDEN",
        role,
      );
    }
    const { staged } = await importCsv(t, csv);
    await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    const part = (await t.app.catalogue.partByOem(t.actors.ADMIN, "P-1"))!;
    await t.app.catalogue.setVerification(
      t.actors.ADMIN,
      part.id,
      "MANUALLY_VERIFIED",
    );
    assert.equal(
      (await t.app.catalogue.part(t.actors.VIEWER, part.id)).verification,
      "MANUALLY_VERIFIED",
    );
    assert.equal(
      await code(
        t.app.catalogue.setVerification(
          t.actors.ADMIN,
          part.id,
          "LICENSED_DATA",
        ),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.catalogue.setVerification(t.actors.SALES, part.id, "DISPUTED"),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      (await t.app.catalogueImport.listJobs(t.actors.ADMIN)).length,
      1,
    );
    const events = await t.app.audit.query(t.actors.OWNER, {
      entityType: "import_job",
    });
    assert.deepEqual(events.map((e) => e.action).sort(), [
      "catalogue.import.commit",
      "catalogue.import.stage",
    ]);
  } finally {
    await t.cleanup();
  }
});

test("Import to My Products: separate records, a preserved link, duplicate protection, and an untouched reference", async () => {
  const t = await makeApp();
  try {
    const { supplier, location } = await seedBasics(t);
    const { staged } = await importCsv(t, BATCH);
    await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    const ref = (await t.app.catalogue.partByOem(
      t.actors.ADMIN,
      "11258-D0101",
    ))!;
    const before = JSON.stringify(ref);
    const a = t.actors.ADMIN;

    const product = await t.app.products.importFromReference(a, ref.id, {
      sku: "NUT-11258",
      priceMinor: 1500,
      costMinor: 700,
      supplierId: supplier.id,
      supplierPartNumber: "SN-9",
      locationId: location.id,
      openingQuantity: 12,
      reorderLevel: 5,
    });
    assert.equal(product.name, "Nut");
    assert.equal(product.brand, "Nissan");
    assert.equal(product.priceMinor, 1500);
    const detail = await t.app.products.detail(a, product.id);
    assert.deepEqual(detail.totals, { onHand: 12, reserved: 0, available: 12 });
    assert.equal(detail.referenceLinks[0].referencePartId, ref.id);
    assert.deepEqual(detail.numbers.map((n) => n.type).sort(), [
      "INTERNAL_SKU",
      "OEM_OE",
    ]);
    assert.equal(detail.suppliers[0].supplierPartNumber, "SN-9");
    // the reference record shows the link but is otherwise byte-for-byte unchanged
    const after = (await t.app.catalogue.part(a, ref.id))!;
    assert.deepEqual(
      after.linkedProducts.map((l) => [l.sku, l.available]),
      [["NUT-11258", 12]],
    );
    assert.equal(
      JSON.stringify({ ...after, linkedProducts: [] }),
      JSON.stringify({ ...ref, linkedProducts: [] }),
      "reference data is not mutated by shop data",
    );
    assert.equal(
      (await t.app.catalogue.search(a, { q: "11258-D0101" })).items[0]
        .linkedProducts[0].sku,
      "NUT-11258",
    );

    // accidental duplicate is refused with a pointer to the existing product
    const dupe = (await t.app.products
      .importFromReference(a, ref.id, { sku: "NUT-2" })
      .catch((e) => e)) as AppError;
    assert.equal(dupe.code, "ALREADY_IMPORTED");
    assert.equal((dupe.details as { sku: string }).sku, "NUT-11258");
    // an intentional second commercial product is allowed
    const second = await t.app.products.importFromReference(a, ref.id, {
      sku: "NUT-2",
      allowDuplicate: true,
      priceMinor: 1200,
    });
    assert.equal(
      (await t.app.catalogue.part(a, ref.id))!.linkedProducts.length,
      2,
    );
    assert.notEqual(second.id, product.id);
    assert.equal(
      await code(
        t.app.products.importFromReference(a, ref.id, {
          sku: "NUT-11258",
          allowDuplicate: true,
        }),
      ),
      "CONFLICT",
      "SKU stays unique",
    );
    assert.equal(
      await code(
        t.app.products.importFromReference(a, "no-such-part", { sku: "Q1" }),
      ),
      "NOT_FOUND",
    );
    assert.equal(
      await code(
        t.app.products.importFromReference(t.actors.SALES, ref.id, {
          sku: "Q2",
          allowDuplicate: true,
        }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.products.importFromReference(t.actors.VIEWER, ref.id, {
          sku: "Q3",
          allowDuplicate: true,
        }),
      ),
      "FORBIDDEN",
    );
    assert.equal(before.length > 0, true);
  } finally {
    await t.cleanup();
  }
});

test("supersession relations are read from the catalogue and copied onto the shop product's numbers", async () => {
  const t = await makeApp();
  try {
    const csv =
      "oem_number,description,manufacturer,superseded_by,supersedes\nOLD-100,Old part,Toyota,NEW-100,\nNEW-100,New part,Toyota,,OLD-100; OLDER-100";
    const { staged } = await importCsv(t, csv);
    await t.app.catalogueImport.commit(t.actors.ADMIN, staged.id);
    const old = (await t.app.catalogue.partByOem(t.actors.ADMIN, "OLD-100"))!;
    const fresh = (await t.app.catalogue.partByOem(t.actors.ADMIN, "NEW-100"))!;
    const out = old.relations.find(
      (r) => r.direction === "out" && r.relation === "SUPERSEDED_BY",
    )!;
    assert.equal(out.relatedNumber, "NEW-100");
    assert.equal(
      out.relatedPartId,
      fresh.id,
      "relations link up once the target part exists",
    );
    assert.ok(
      fresh.relations.some(
        (r) =>
          r.direction === "in" &&
          r.relation === "SUPERSEDED_BY" &&
          r.relatedNumber === "OLD-100",
      ),
    );
    assert.ok(
      fresh.relations.some(
        (r) =>
          r.direction === "out" &&
          r.relation === "SUPERSEDES" &&
          r.relatedNumber === "OLDER-100" &&
          r.relatedPartId === null,
      ),
    );
    const product = await t.app.products.importFromReference(
      t.actors.ADMIN,
      old.id,
      { sku: "OLD-SHOP" },
    );
    const numbers = (await t.app.products.detail(t.actors.ADMIN, product.id))
      .numbers;
    assert.equal(
      numbers.find((n) => n.type === "OEM_OE")!.supersededByNumber,
      "NEW-100",
    );
    assert.ok(
      numbers.some((n) => n.type === "REPLACEMENT" && n.display === "NEW-100"),
    );
  } finally {
    await t.cleanup();
  }
});
