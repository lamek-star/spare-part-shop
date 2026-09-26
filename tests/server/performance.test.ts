import test from "node:test";
import assert from "node:assert/strict";
import { makeApp } from "./helpers";
import { detectColumns } from "../../src/server/catalogue/importer";
import { parseCsv } from "../../src/server/catalogue/csv";

// SPAREPARTS_PERF_PARTS lowers the size for profiling runs only.
const PARTS = Number(process.env.SPAREPARTS_PERF_PARTS ?? 20_000);
function syntheticCsv(rows: number): string {
  const makes = ["Toyota", "Nissan", "Honda", "Mazda"];
  const models = ["Corolla", "Camry", "Skyline", "Civic", "Demio", "Hilux"];
  const lines = [
    "oem_number,description,manufacturer,vehicle,chassis,engine,production_from,production_to,category,market,source",
  ];
  for (let i = 0; i < rows; i++) {
    const n = String(10000 + i).padStart(5, "0");
    lines.push(
      `${11000 + (i % 90)}-${n},"Gasket, part ${i} valve cover seal",${makes[i % 4]},${models[i % 6]},CH${i % 300},E${i % 40},198${i % 10}-01,199${i % 10}-12,Engine,EU,Synthetic`,
    );
  }
  return lines.join("\n");
}
const time = async <T>(fn: () => Promise<T>) => {
  const t = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t };
};

test(
  `performance: ${PARTS.toLocaleString("en-US")} reference parts import, then search stays fast`,
  { timeout: 300_000 },
  async () => {
    const t = await makeApp();
    try {
      const csv = syntheticCsv(PARTS);
      const a = t.actors.ADMIN;
      const detected = detectColumns(parseCsv(csv));
      const staged = await time(() =>
        t.app.catalogueImport.stageCsv(a, {
          content: csv,
          fileName: "big.csv",
          mapping: detected.suggestedMapping,
          attested: true,
        }),
      );
      assert.equal(staged.value.valid, PARTS);
      const committed = await time(() =>
        t.app.catalogueImport.commit(a, staged.value.id, { chunkSize: 1000 }),
      );
      assert.equal(committed.value.status, "COMPLETED");
      assert.equal(committed.value.created, PARTS);
      console.log(
        `  import: stage ${Math.round(staged.ms)} ms, commit ${Math.round(committed.ms)} ms (${Math.round(PARTS / (committed.ms / 1000))} rows/s)`,
      );
      assert.ok(
        staged.ms + committed.ms < 240_000,
        "import of 20k rows finishes in a reasonable time",
      );

      const exact = await time(() =>
        t.app.catalogue.search(a, { q: "11005-10005" }),
      );
      assert.equal(exact.value.items[0].oemNumber, "11005-10005");
      const compact = await time(() =>
        t.app.catalogue.search(a, { q: "1100510005" }),
      );
      assert.equal(compact.value.items[0].oemNumber, "11005-10005");
      const prefix = await time(() =>
        t.app.catalogue.search(a, { q: "11005" }),
      );
      assert.ok(prefix.value.total >= 100);
      const words = await time(() =>
        t.app.catalogue.search(a, {
          q: "valve cover seal",
          manufacturer: "Nissan",
          pageSize: 50,
        }),
      );
      assert.ok(words.value.total > 1000);
      const browse = await time(() => t.app.catalogue.browse(a, {}));
      const stats = await time(() => t.app.catalogue.stats(a));
      console.log(
        `  search: exact ${exact.ms.toFixed(1)} ms, compact ${compact.ms.toFixed(1)} ms, prefix ${prefix.ms.toFixed(1)} ms, words ${words.ms.toFixed(1)} ms, browse ${browse.ms.toFixed(1)} ms, stats ${stats.ms.toFixed(1)} ms`,
      );
      for (const [name, r] of Object.entries({
        exact,
        compact,
        prefix,
        words,
        browse,
        stats,
      }))
        assert.ok(r.ms < 1500, `${name} search took ${r.ms.toFixed(0)} ms`);

      // re-importing the same file is idempotent and does not blow up
      const again = await t.app.catalogueImport.stageCsv(a, {
        content: csv,
        fileName: "big.csv",
        mapping: detected.suggestedMapping,
        attested: true,
      });
      assert.equal(again.duplicates + again.valid, PARTS);
    } finally {
      await t.cleanup();
    }
  },
);

test(
  "performance: thousands of products, movements and documents keep lists, lookups and reports quick",
  { timeout: 300_000 },
  async () => {
    const t = await makeApp();
    try {
      const o = t.actors.OWNER;
      const wh = await t.app.masterData.createWarehouse(o, { name: "Big" });
      const loc = (await t.app.masterData.listWarehouses(o)).locations.find(
        (l) => l.warehouseId === wh.id,
      )!;
      const cust = await t.app.masterData.createCustomer(o, {
        name: "Volume Buyer",
      });
      const N = 2000;
      const created = await time(async () => {
        for (let i = 0; i < N; i++)
          await t.app.products.create(o, {
            sku: `P-${String(i).padStart(5, "0")}`,
            name: `Part number ${i} gasket`,
            brand: "B" + (i % 20),
            category: "C" + (i % 8),
            priceMinor: 1000 + i,
            costMinor: 500,
            reorderLevel: 5,
            openingStock: { locationId: loc.id, quantity: 10 + (i % 7) },
          });
      });
      console.log(
        `  created ${N} products with opening stock in ${Math.round(created.ms)} ms`,
      );
      const list = await time(() =>
        t.app.products.list(o, { q: "gasket", pageSize: 50 }),
      );
      assert.equal(list.value.items.length, 50);
      const byNumber = await time(() => t.app.products.lookup(o, "P-01500"));
      assert.equal(byNumber.value?.product.sku, "P-01500");
      const low = await time(() =>
        t.app.products.list(o, { lowStockOnly: true, pageSize: 50 }),
      );
      const dash = await time(() => t.app.reports.dashboard(o));
      const val = await time(() => t.app.reports.inventoryValuation(o));
      const levels = await time(() =>
        t.app.inventory.stockLevels(o, { q: "Part number 19", pageSize: 50 }),
      );
      console.log(
        `  list ${list.ms.toFixed(1)} ms, lookup ${byNumber.ms.toFixed(1)} ms, low-stock ${low.ms.toFixed(1)} ms, dashboard ${dash.ms.toFixed(1)} ms, valuation ${val.ms.toFixed(1)} ms, stock ${levels.ms.toFixed(1)} ms`,
      );
      for (const [name, r] of Object.entries({
        list,
        byNumber,
        low,
        dash,
        val,
        levels,
      }))
        assert.ok(r.ms < 1500, `${name} took ${r.ms.toFixed(0)} ms`);
      assert.equal((await t.app.inventory.verifyIntegrity(o)).length, 0);

      // hot queries use indexes, not table scans. PostgreSQL's planner
      // rightly prefers a scan of a tiny table, so it is asked whether an
      // index exists for the query (sequential scans disabled) instead.
      const plan = (sql: string, params: (string | number)[] = []) =>
        t.container.db.read(async (h) => {
          if (h.dialect === "postgres") {
            await h.exec("SET LOCAL enable_seqscan = off");
            return (
              await h.all<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params)
            )
              .map((r) => r["QUERY PLAN"])
              .join(" | ");
          }
          return (
            await h.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
          )
            .map((r) => r.detail)
            .join(" | ");
        });
      for (const [what, sql, params] of [
        [
          "balances by product",
          "SELECT * FROM stock_balances WHERE product_id = ?",
          ["x"],
        ],
        [
          "movements by product",
          "SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 20",
          ["x"],
        ],
        [
          "product by sku",
          "SELECT * FROM products WHERE sku = ? COLLATE NOCASE",
          ["x"],
        ],
        [
          "product numbers lookup",
          "SELECT * FROM product_numbers WHERE normalized = ?",
          ["x"],
        ],
        [
          "invoices by customer",
          "SELECT * FROM invoices WHERE customer_id = ?",
          ["x"],
        ],
        [
          "audit by entity",
          "SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC",
          ["a", "b"],
        ],
        ["fitments by part", "SELECT * FROM fitments WHERE part_id = ?", ["x"]],
        [
          "callouts by drawing",
          "SELECT * FROM drawing_callouts WHERE drawing_id = ?",
          ["x"],
        ],
      ] as [string, string, string[]][]) {
        const p = await plan(sql, params);
        assert.ok(
          /USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY|PRIMARY KEY|Index (Only )?Scan|Bitmap Index Scan/i.test(
            p,
          ),
          `${what} does not use an index: ${p}`,
        );
      }
      void cust;
    } finally {
      await t.cleanup();
    }
  },
);
