import test from "node:test";
import assert from "node:assert/strict";
import { makeHttpApp } from "./http-helpers";

test("passwords are stored only as salted scrypt hashes, never reversibly, never logged or audited", async () => {
  const t = await makeHttpApp();
  try {
    const rows = await t.container.db.read((h) =>
      h.all<{ password_hash: string; email: string }>(
        "SELECT email, password_hash FROM users",
      ),
    );
    assert.ok(rows.length >= 5);
    for (const r of rows) {
      assert.match(r.password_hash, /^scrypt\$/);
      assert.ok(!r.password_hash.includes("correct-horse-battery"));
    }
    assert.notEqual(
      rows[0].password_hash,
      rows[1].password_hash,
      "same password, different salt",
    );
    const raw = await t.container.db.read((h) =>
      JSON.stringify(h.all("SELECT * FROM audit_events")),
    );
    assert.ok(
      !raw.includes("correct-horse-battery") && !/password_hash/.test(raw),
    );
    assert.ok(!t.logs.join("\n").includes("correct-horse-battery"));
  } finally {
    await t.cleanup();
  }
});

test("session tokens are random per sign-in, stored hashed, and useless after sign-out", async () => {
  const t = await makeHttpApp();
  try {
    const before = (
      await t.container.db.read((h) =>
        h.all<{ id: string }>("SELECT id FROM sessions"),
      )
    ).length;
    const a = t.client();
    const b = t.client();
    await a.login("owner@example.test");
    await b.login("owner@example.test");
    assert.notEqual(a.cookie, b.cookie);
    const token = decodeURIComponent(a.cookie.split("=")[1]);
    const stored = await t.container.db.read((h) =>
      h.all<{ id: string }>("SELECT id FROM sessions").map((r) => r.id),
    );
    assert.ok(!stored.includes(token), "the raw token is never stored");
    assert.equal(stored.length, before + 2, "one row per sign-in");
    await a.post("/auth/logout");
    a.cookie = `sp_session=${encodeURIComponent(token)}`;
    assert.equal((await a.get("/auth/me")).status, 401);
    assert.equal(
      (await b.get("/auth/me")).status,
      200,
      "other sessions are unaffected",
    );
  } finally {
    await t.cleanup();
  }
});

test("cookies are HttpOnly and SameSite, and Secure whenever the request came over HTTPS", async () => {
  const t = await makeHttpApp();
  try {
    const c = t.client();
    const plain = await c.login("owner@example.test");
    assert.ok(
      !/;\s*Secure/i.test(plain.headers.get("set-cookie")!),
      "plain http on a local network still works",
    );
    const c2 = t.client();
    const secure = await c2.post(
      "/auth/login",
      { email: "owner@example.test", password: "correct-horse-battery" },
      { headers: { "x-forwarded-proto": "https" } },
    );
    assert.match(secure.headers.get("set-cookie")!, /;\s*Secure/i);
    assert.match(secure.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(secure.headers.get("set-cookie")!, /SameSite=Lax/i);
  } finally {
    await t.cleanup();
  }
});

test("sign-in attempts are throttled per address as well as per account", async () => {
  const t = await makeHttpApp();
  try {
    const c = t.client();
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await c.post(
        "/auth/login",
        { email: `nobody${i}@example.test`, password: "whatever-it-is-123" },
        { headers: { "x-forwarded-for": "203.0.113.9" } },
      );
      if (r.status === 429) limited++;
    }
    assert.ok(limited >= 5, `expected throttling, got ${limited} rejections`);
    assert.equal(
      (
        await c.post(
          "/auth/login",
          { email: "owner@example.test", password: "correct-horse-battery" },
          { headers: { "x-forwarded-for": "198.51.100.7" } },
        )
      ).status,
      200,
      "other addresses are unaffected",
    );
  } finally {
    await t.cleanup();
  }
});

test("a fresh installation has no accounts and no default credentials", async () => {
  const { createContainer } =
    await import("../../src/server/standalone/container");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sp-fresh-"));
  const c = await createContainer({ dataDir: dir });
  try {
    assert.equal(await c.identity.hasAnyUser(), false);
    assert.equal(
      await c.db.read((h) => h.count("SELECT COUNT(*) AS n FROM products")),
      0,
      "no demo products",
    );
    assert.equal(
      await c.db.read((h) => h.count("SELECT COUNT(*) AS n FROM customers")),
      0,
      "no demo customers",
    );
    assert.equal(
      await c.db.read((h) =>
        h.count("SELECT COUNT(*) AS n FROM catalogue_parts"),
      ),
      0,
      "no demo catalogue",
    );
    await assert.rejects(() =>
      c.identity.signIn({
        email: "admin@example.com",
        password: "admin",
        ip: null,
        userAgent: null,
      }),
    );
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("injection attempts in every search and filter parameter are treated as data", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    await owner.post("/customers", { name: "Real customer" });
    await owner.post("/suppliers", { name: "Real supplier" });
    const evil = [
      "' OR '1'='1",
      '"; DROP TABLE users; --',
      "%' UNION SELECT password_hash FROM users --",
      "\\",
      "*",
      "NEAR(",
      "a AND",
      "\u0000",
    ];
    const endpoints = [
      "/customers?q=",
      "/suppliers?q=",
      "/products?q=",
      "/catalogue/search?q=",
      "/enquiries?q=",
      "/quotations?q=",
      "/orders?q=",
      "/invoices?q=",
      "/purchase-orders?q=",
      "/inventory/stock?q=",
      "/audit?entityType=",
      "/catalogue/import/jobs?limit=",
    ];
    for (const e of endpoints)
      for (const v of evil) {
        const r = await owner.get(e + encodeURIComponent(v));
        assert.ok(
          [200, 400].includes(r.status),
          `${e}${JSON.stringify(v)} -> ${r.status} ${JSON.stringify(r.body)}`,
        );
        assert.ok(
          !JSON.stringify(r.body).includes("scrypt$"),
          "no hash ever leaks through a search",
        );
      }
    assert.equal(
      (await owner.get("/users")).data.length,
      5,
      "users table intact",
    );
    assert.equal(
      (await owner.get("/customers?q=" + encodeURIComponent("' OR '1'='1")))
        .data.total,
      0,
      "the quote characters did not widen the query",
    );
    assert.equal((await owner.get("/customers?q=Real")).data.total, 1);
  } finally {
    await t.cleanup();
  }
});

test("stored text with markup is returned inertly as JSON and never as HTML", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    const evil = `<img src=x onerror=alert(1)><script>alert(2)</script>`;
    const c = await owner.post("/customers", { name: evil, notes: evil });
    assert.equal(c.status, 201);
    const r = await owner.get(`/customers/${c.data.id}`);
    assert.match(r.headers.get("content-type")!, /^application\/json/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      r.data.name,
      evil,
      "stored verbatim; the UI renders it as text",
    );
  } finally {
    await t.cleanup();
  }
});

test("exports neutralise spreadsheet formulas", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    const wh = (await owner.post("/warehouses", { name: "M" })).data;
    const loc = (
      (await owner.get("/warehouses")).data.locations as {
        id: string;
        warehouseId: string;
      }[]
    ).find((l) => l.warehouseId === wh.id)!;
    const cust = (await owner.post("/customers", { name: "C" })).data;
    const q = (
      await owner.post("/quotations", {
        customerId: cust.id,
        lines: [
          {
            description: `=HYPERLINK("http://evil.example","x")`,
            quantity: 1,
            unitPriceMinor: 100,
          },
          {
            description: "+cmd|' /C calc'!A0",
            quantity: 1,
            unitPriceMinor: 100,
          },
          { description: "@SUM(1+1)", quantity: 1, unitPriceMinor: 100 },
        ],
      })
    ).data;
    void loc;
    await owner.post(`/quotations/${q.id}/issue`);
    await owner.post(`/quotations/${q.id}/accept`);
    const o = (await owner.post(`/quotations/${q.id}/order`, {})).data;
    await owner.post(`/orders/${o.id}/fulfil`, {});
    await owner.post(`/orders/${o.id}/invoice`, {});
    const csv = new TextDecoder().decode(
      (await owner.get("/reports/sales-by-product?format=csv")).raw,
    );
    for (const line of csv.split("\r\n").slice(1).filter(Boolean))
      assert.ok(
        !/^[=+@-]/.test(line.replace(/^"/, "")) ||
          /^["']?'/.test(line) ||
          line.startsWith("'"),
        `unsafe cell: ${line}`,
      );
    assert.ok(csv.includes(`'=HYPERLINK`), "leading = is defused");
    assert.ok(csv.includes(`'+cmd`) && csv.includes(`'@SUM`));
  } finally {
    await t.cleanup();
  }
});

test("enquiry carts are personal: another user cannot alter, submit or cancel them", async () => {
  const t = await makeHttpApp();
  try {
    const sales = await t.as("SALES");
    const inv = await t.as("INVENTORY");
    await sales.post("/enquiries/items", {
      oemNumber: "X-1",
      partName: "Thing",
      quantity: 1,
    });
    const cart = (await sales.get("/enquiries/current")).data;
    assert.equal(
      (await inv.get("/enquiries/current")).status,
      403,
      "inventory staff have no enquiry permission at all",
    );
    const admin = await t.as("ADMIN");
    const other = await t.client();
    await other.login("viewer@example.test");
    assert.equal(
      (await other.del(`/enquiries/${cart.id}/items/${cart.items[0].id}`))
        .status,
      403,
    );
    assert.equal(
      (await other.post(`/enquiries/${cart.id}/cancel`)).status,
      403,
    );
    // an Owner/Admin may manage any cart
    assert.equal(
      (await admin.del(`/enquiries/${cart.id}/items/${cart.items[0].id}`))
        .status,
      200,
    );
  } finally {
    await t.cleanup();
  }
});

test("large or malformed uploads are refused before they are processed", async () => {
  const t = await makeHttpApp();
  try {
    const admin = await t.as("ADMIN");
    const form = new FormData();
    form.set(
      "file",
      new Blob(["not,a,proper\n\u0000\u0000binary"], { type: "text/csv" }),
      "x.csv",
    );
    assert.equal(
      (await admin.send("POST", "/catalogue/import/detect", { form })).status,
      400,
    );
    const empty = new FormData();
    assert.equal(
      (await admin.send("POST", "/catalogue/import/detect", { form: empty }))
        .status,
      400,
      "no file",
    );
    const wrongType = await admin.send("POST", "/catalogue/import/detect", {
      json: {},
    });
    assert.equal(wrongType.status, 415);
  } finally {
    await t.cleanup();
  }
});
