// Dev micro-benchmark: per-statement cost of the PostgreSQL driver paths.
import pg from "pg";
const url = process.env.SPAREPARTS_TEST_PG_URL!;
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query("CREATE TEMP TABLE b (id text primary key, v bigint)");
const N = 5000;
const time = async (label: string, fn: (i: number) => Promise<unknown>) => {
  const t = performance.now();
  for (let i = 0; i < N; i++) await fn(i);
  const ms = performance.now() - t;
  console.log(`${label}: ${(ms / N).toFixed(3)} ms/statement`);
};
await time("unnamed insert", (i) =>
  c.query("INSERT INTO b VALUES ($1,$2)", [`a${i}`, i]),
);
await time("named insert", (i) =>
  c.query({ name: "ins", text: "INSERT INTO b VALUES ($1,$2)", values: [`b${i}`, i] }),
);
await time("unnamed select", (i) =>
  c.query("SELECT v FROM b WHERE id = $1", [`a${i}`]),
);
await time("named select", (i) =>
  c.query({ name: "sel", text: "SELECT v FROM b WHERE id = $1", values: [`a${i}`] }),
);
await time("simple protocol select", () => c.query("SELECT 1"));
await c.end();
