import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeHttpApp, Client, type HttpApp } from "./http-helpers";
import { buildZip, sha256 } from "../../src/server/catalogue/packageSource";
import { rolePermissions, permissions, type Permission } from "../../src/server/domain/permissions";

const PNG = (() => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 300);
  new DataView(b.buffer).setUint32(20, 200);
  return b;
})();
const fileForm = (name: string, bytes: Uint8Array | string, type: string, fields: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("file", new Blob([bytes as BlobPart], { type }), name);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function withApp(fn: (t: HttpApp) => Promise<void>) {
  const t = await makeHttpApp();
  try {
    await fn(t);
  } finally {
    await t.cleanup();
  }
}

test("first-run setup creates the Owner exactly once; login/logout/me work with an HttpOnly cookie", async () => {
  const t = await makeHttpApp();
  try {
    const anon = t.client();
    assert.equal((await anon.get("/auth/status")).data.needsSetup, false, "seeded by makeHttpApp");
    const again = await anon.post("/auth/setup", { email: "second@example.test", displayName: "X", password: "correct-horse-battery" });
    assert.equal(again.status, 403, "setup is closed once a user exists");
    const c = t.client();
    const login = await c.login("owner@example.test");
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, "OWNER");
    assert.ok(login.data.csrfToken.length >= 20);
    assert.equal(login.data.user.passwordHash, undefined);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /sp_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const me = await c.get("/auth/me");
    assert.equal(me.data.shopName, "Test Auto Parts");
    assert.ok(me.data.permissions.includes("users.manage"));
    assert.equal((await c.post("/auth/logout")).status, 204);
    assert.equal((await c.get("/auth/me")).status, 401, "the session is gone server-side");
    // a stolen cookie does not survive logout either
    const stolen = t.client();
    const l2 = await stolen.login("owner@example.test");
    const saved = stolen.cookie;
    await stolen.post("/auth/logout");
    stolen.cookie = saved;
    assert.equal((await stolen.get("/auth/me")).status, 401);
    void l2;
  } finally {
    await t.cleanup();
  }
});

test("the very first request on an empty database offers setup, and only setup", async () => {
  const { createContainer } = await import("../../src/server/standalone/container");
  const { createApp } = await import("../../src/server/domain/app");
  const { createHttpHandler } = await import("../../src/server/http/core");
  const { buildRouter } = await import("../../src/server/http/routes");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "sp-empty-"));
  const container = await createContainer({ dataDir: dir });
  try {
    const c = new Client(createHttpHandler(buildRouter(), async () => ({ app: createApp(container), container }), { log: () => undefined }));
    assert.deepEqual((await c.get("/auth/status")).data, { needsSetup: true, shopName: "" });
    assert.equal((await c.get("/products")).status, 401);
    const weak = await c.post("/auth/setup", { email: "o@example.test", displayName: "O", password: "short" });
    assert.equal(weak.status, 400);
    const ok = await c.post("/auth/setup", { email: "o@example.test", displayName: "O", password: "a-long-enough-passphrase", shopName: "Zed Parts" });
    assert.equal(ok.status, 201);
    assert.equal((await c.get("/auth/status")).data.shopName, "Zed Parts");
  } finally {
    await container.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unauthenticated, cross-site and token-less requests are refused before any work happens", async () => {
  await withApp(async (t) => {
    const anon = t.client();
    for (const path of ["/products", "/customers", "/catalogue/search?q=a", "/reports/dashboard", "/inventory/balances", "/audit", "/settings", "/files/x"]) assert.equal((await anon.get(path)).status, 401, path);
    const owner = await t.as("OWNER");
    const noToken = await owner.post("/customers", { name: "X" }, { csrf: false });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.error.code, "FORBIDDEN");
    owner.csrf = "wrong-token-wrong-token-wrong";
    assert.equal((await owner.post("/customers", { name: "X" })).status, 403, "wrong CSRF token");
    const good = await t.as("OWNER");
    assert.equal((await good.post("/customers", { name: "X" }, { origin: "http://evil.example" })).status, 403, "cross-origin write");
    assert.equal((await good.post("/customers", { name: "X" })).status, 201);
    assert.equal((await good.post("/auth/login", { email: "owner@example.test", password: "correct-horse-battery" }, { origin: "http://evil.example" })).status, 403, "login CSRF");
    assert.equal((await good.post("/customers", { name: "Y" }, { origin: null })).status, 201, "non-browser clients without Origin still need the token");
  });
});

test("every route is permission checked on the server: no role can exceed its permission set", async () => {
  await withApp(async (t) => {
    const probes: { method: "GET" | "POST"; path: string; perm: Permission; body?: unknown }[] = [
      { method: "GET", path: "/users", perm: "users.manage" },
      { method: "GET", path: "/audit", perm: "audit.read" },
      { method: "GET", path: "/customers", perm: "customers.read" },
      { method: "POST", path: "/customers", perm: "customers.write", body: { name: "Probe" } },
      { method: "GET", path: "/suppliers", perm: "suppliers.read" },
      { method: "POST", path: "/suppliers", perm: "suppliers.write", body: { name: "Probe" } },
      { method: "GET", path: "/products", perm: "products.read" },
      { method: "POST", path: "/products", perm: "products.write", body: { sku: "PROBE-1", name: "Probe" } },
      { method: "GET", path: "/inventory/balances", perm: "inventory.read" },
      { method: "POST", path: "/warehouses", perm: "warehouses.write", body: { name: "Probe WH" } },
      { method: "GET", path: "/enquiries", perm: "enquiries.read" },
      { method: "GET", path: "/quotations", perm: "quotations.read" },
      { method: "GET", path: "/orders", perm: "orders.read" },
      { method: "GET", path: "/invoices", perm: "invoices.read" },
      { method: "GET", path: "/purchase-orders", perm: "purchasing.read" },
      { method: "GET", path: "/catalogue/search?q=a", perm: "catalogue.read" },
      { method: "GET", path: "/catalogue/import/jobs", perm: "catalogue.import" },
      { method: "GET", path: "/catalogue/assets", perm: "catalogue.admin" },
      { method: "PUT", path: "/settings", perm: "settings.manage", body: { shopName: "Probe" } } as never,
    ];
    for (const role of ["OWNER", "ADMIN", "SALES", "INVENTORY", "VIEWER"] as const) {
      const c = await t.as(role);
      for (const p of probes) {
        const res = p.method === "GET" ? await c.get(p.path) : await c.send(p.method, p.path, { json: p.body ?? {} });
        const allowed = rolePermissions[role].has(p.perm);
        if (allowed) assert.notEqual(res.status, 403, `${role} ${p.method} ${p.path} should pass the permission gate (${res.status} ${JSON.stringify(res.body)})`);
        else assert.equal(res.status, 403, `${role} ${p.method} ${p.path} must be forbidden`);
      }
    }
    // the matrix covers real permissions only
    for (const p of probes) assert.ok((permissions as readonly string[]).includes(p.perm));
  });
});

test("cost prices are hidden from roles without products.cost.read, over the wire", async () => {
  await withApp(async (t) => {
    const inv = await t.as("INVENTORY");
    const created = await inv.post("/products", { sku: "OIL-1", name: "Oil filter", priceMinor: 10000, costMinor: 6000 });
    assert.equal(created.status, 201);
    assert.equal(created.data.costMinor, 6000);
    for (const role of ["SALES", "VIEWER"] as const) {
      const c = await t.as(role);
      const detail = await c.get(`/products/${created.data.id}`);
      assert.equal(detail.data.product.costMinor, null, role);
      assert.ok(!JSON.stringify(detail.body).includes("6000"), `${role}: cost must not appear anywhere in the response`);
      assert.equal((await c.get("/products?q=OIL")).data.items[0].costMinor, null);
    }
  });
});

test("errors are structured, business-level, and never leak internals", async () => {
  await withApp(async (t) => {
    const c = await t.as("OWNER");
    const invalid = await c.post("/customers", { name: "" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION");
    assert.match(invalid.body.error.message, /Name is required/);
    assert.ok(invalid.body.error.requestId);
    assert.equal((await c.get("/products/does-not-exist")).body.error.code, "NOT_FOUND");
    assert.equal((await c.get("/nope")).status, 404);
    const wrongMethod = await c.send("DELETE", "/customers", {});
    assert.equal(wrongMethod.status, 405);
    assert.match(wrongMethod.headers.get("allow")!, /GET/);
    assert.equal((await c.send("POST", "/customers", { body: "not json", headers: { "content-type": "application/json" } })).body.error.code, "VALIDATION");
    assert.equal((await c.send("POST", "/customers", { body: "name=x", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await c.send("POST", "/customers", { body: "[1]", headers: { "content-type": "application/json" } })).status, 400);
    assert.equal((await c.get("/products?page=abc")).status, 400);
    assert.equal((await c.get("/products/%00")).status, 400);
    const huge = await c.send("POST", "/customers", { body: JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) }), headers: { "content-type": "application/json" } });
    assert.equal(huge.status, 413);
    // hostile ids and search strings are treated as data
    for (const evil of ["' OR 1=1 --", "1; DROP TABLE products", "../../etc/passwd", "<script>alert(1)</script>"]) {
      const r = await c.get(`/products/${encodeURIComponent(evil)}`);
      assert.equal(r.status, 404, evil);
      assert.equal((await c.get(`/products?q=${encodeURIComponent(evil)}`)).status, 200, evil);
      assert.equal((await c.get(`/catalogue/search?q=${encodeURIComponent(evil)}`)).status, 200, evil);
    }
    assert.equal((await c.get("/products")).data.total, 0, "no table was harmed");
    // an unexpected fault becomes a generic 500 with a reference, and the detail stays in the log
    const original = t.container.repos.products.list;
    t.container.repos.products.list = async () => {
      throw new Error("secret /var/db/path SELECT * FROM users");
    };
    const boom = await c.get("/products");
    t.container.repos.products.list = original;
    assert.equal(boom.status, 500);
    assert.equal(boom.body.error.code, "INTERNAL");
    assert.ok(!JSON.stringify(boom.body).includes("secret"));
    assert.ok(!JSON.stringify(boom.body).includes("SELECT"));
    assert.match(boom.body.error.message, new RegExp(boom.body.error.requestId));
    assert.ok(t.logs.some((l) => l.includes("secret /var/db/path") && l.includes(boom.body.error.requestId)));
  });
});

test("responses carry no-store and nosniff headers and no CORS grants", async () => {
  await withApp(async (t) => {
    const c = await t.as("OWNER");
    const r = await c.get("/products");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
    assert.ok(r.headers.get("x-request-id"));
  });
});

test("sign-in locks after repeated failures and tells the user, without revealing which part was wrong", async () => {
  await withApp(async (t) => {
    const c = t.client();
    const unknown = await c.login("nobody@example.test", "whatever-password");
    const wrong = await c.login("sales@example.test", "not-the-password");
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.error.message, wrong.body.error.message, "no user enumeration");
    for (let i = 0; i < 6; i++) await c.login("sales@example.test", "not-the-password");
    const locked = await c.login("sales@example.test", "correct-horse-battery");
    assert.equal(locked.status, 429);
    assert.match(locked.body.error.message, /Too many failed sign-in attempts/);
  });
});

test("a new user must change the temporary password before doing anything else", async () => {
  await withApp(async (t) => {
    const owner = await t.as("OWNER");
    const made = await owner.post("/users", { email: "new@example.test", displayName: "New Hire", role: "SALES", password: "temporary-pass-123" });
    assert.equal(made.data.mustChangePassword, true);
    const c = t.client();
    const l = await c.login("new@example.test", "temporary-pass-123");
    assert.equal(l.data.mustChangePassword, true);
    const blocked = await c.get("/customers");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal((await c.get("/auth/me")).status, 200);
    assert.equal((await c.post("/auth/password", { currentPassword: "temporary-pass-123", newPassword: "temporary-pass-123" })).status, 400);
    const changed = await c.post("/auth/password", { currentPassword: "temporary-pass-123", newPassword: "a-much-better-passphrase" });
    assert.equal(changed.status, 200);
    assert.equal((await c.get("/customers")).status, 401, "all sessions end after a password change");
    assert.equal((await c.login("new@example.test", "a-much-better-passphrase")).data.mustChangePassword, false);
  });
});

test("disabling a user ends their session at once; the last Owner cannot be removed", async () => {
  await withApp(async (t) => {
    const owner = await t.as("OWNER");
    const sales = await t.as("SALES");
    assert.equal((await sales.get("/customers")).status, 200);
    const users = (await owner.get("/users")).data as { id: string; email: string }[];
    const salesUser = users.find((u) => u.email === "sales@example.test")!;
    assert.equal((await owner.patch(`/users/${salesUser.id}`, { status: "DISABLED" })).status, 200);
    assert.equal((await sales.get("/customers")).status, 401);
    assert.equal((await t.client().login("sales@example.test")).status, 401);
    const ownerUser = users.find((u) => u.email === "owner@example.test")!;
    assert.equal((await owner.patch(`/users/${ownerUser.id}`, { role: "ADMIN" })).status, 409);
    const admin = await t.as("ADMIN");
    assert.equal((await admin.patch(`/users/${salesUser.id}`, { role: "OWNER" })).status, 403, "an Admin cannot promote anyone");
  });
});

test("product photos: validated, ordered, primary, served only to authorised users; unsafe files refused", async () => {
  await withApp(async (t) => {
    const inv = await t.as("INVENTORY");
    const p = (await inv.post("/products", { sku: "PH-1", name: "Photo part" })).data;
    const up = (name: string, bytes: Uint8Array | string, type: string, extra: Record<string, string> = {}) => inv.send("POST", `/products/${p.id}/images`, { form: fileForm(name, bytes, type, extra) });
    const a = await up("front.png", PNG, "image/png", { caption: "Front", primary: "true" });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.data.isPrimary, true);
    const b = await up("../../evil name.png", PNG, "image/png");
    assert.equal(b.status, 201);
    assert.ok(!String(b.data.url).includes(".."), "the client's file name never becomes a path");
    // wrong content, wrong claim, script, oversize, empty
    assert.equal((await up("x.png", "<script>alert(1)</script>", "image/png")).status, 400, "content is sniffed, not trusted");
    assert.equal((await up("x.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml")).status, 400, "SVG can carry script");
    assert.equal((await up("x.png", new Uint8Array(0), "image/png")).status, 400);
    assert.equal((await up("big.png", new Uint8Array(9 * 1024 * 1024).fill(1), "image/png")).status, 413);
    const detail = (await inv.get(`/products/${p.id}`)).data;
    assert.equal(detail.images.length, 2);
    // reorder and primary
    const [first, second] = detail.images;
    assert.equal((await inv.put(`/products/${p.id}/images/order`, { ids: [second.id, first.id] })).status, 200);
    assert.equal((await inv.put(`/products/${p.id}/images/${second.id}/primary`)).status, 200);
    const after = (await inv.get(`/products/${p.id}`)).data.images;
    assert.deepEqual(after.map((i: { id: string }) => i.id), [second.id, first.id]);
    assert.equal(after.filter((i: { isPrimary: boolean }) => i.isPrimary).length, 1);
    // served with safe headers to any signed-in role that may read products; refused when anonymous
    const url = (after[0] as { url: string }).url;
    const viewer = await t.as("VIEWER");
    const served = await viewer.get(url.replace("/api/v1", ""));
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.match(served.headers.get("content-security-policy")!, /sandbox/);
    assert.deepEqual([...served.raw], [...PNG]);
    assert.equal((await t.client().get(url.replace("/api/v1", ""))).status, 401);
    // another product cannot delete this product's image (IDOR)
    const other = (await inv.post("/products", { sku: "PH-2", name: "Other" })).data;
    assert.equal((await inv.del(`/products/${other.id}/images/${first.id}`)).status, 404);
    assert.equal((await viewer.send("POST", `/products/${p.id}/images`, { form: fileForm("v.png", PNG, "image/png") })).status, 403);
    assert.equal((await inv.del(`/products/${p.id}/images/${second.id}`)).status, 204);
    assert.equal((await inv.get(`/products/${p.id}`)).data.images.length, 1);
    assert.equal((await inv.get(`/files/${second.fileId}`)).status, 404, "removed image bytes are gone");
  });
});

test("files that are not product images or documents are never served through the generic file route", async () => {
  await withApp(async (t) => {
    const owner = await t.as("OWNER");
    const f = await t.container.repos.files.put({ bytes: PNG, originalName: "d.png", mime: "image/png", kind: "CATALOGUE_DRAWING" });
    assert.equal((await owner.get(`/files/${f.id}`)).status, 404, "catalogue drawings go through the rights-checked asset route");
    const s = await t.container.repos.files.put({ bytes: new TextEncoder().encode("secret"), originalName: "s.txt", mime: "text/plain", kind: "SOMETHING_ELSE" });
    assert.equal((await owner.get(`/files/${s.id}`)).status, 404);
    assert.equal((await owner.get(`/files/..%2F..%2Fspareparts.sqlite`)).status, 404);
  });
});

test("catalogue CSV wizard over HTTP: detect, stage, review, commit; history persists", async () => {
  await withApp(async (t) => {
    const admin = await t.as("ADMIN");
    const csv = readFileSync(join(process.cwd(), "tests/fixtures/catalogue/intraforge_reference_catalogue_batch_001.csv"));
    const det = await admin.send("POST", "/catalogue/import/detect", { form: fileForm("batch.csv", csv, "text/csv") });
    assert.equal(det.status, 200, JSON.stringify(det.body));
    assert.ok(det.data.rowCount > 10);
    assert.deepEqual(det.data.unmappedRequired, []);
    const noConsent = await admin.send("POST", "/catalogue/import/jobs", { form: fileForm("batch.csv", csv, "text/csv", { mapping: JSON.stringify(det.data.suggestedMapping) }) });
    assert.equal(noConsent.status, 400, "the operator must confirm they may use the data");
    const staged = await admin.send("POST", "/catalogue/import/jobs", { form: fileForm("batch.csv", csv, "text/csv", { mapping: JSON.stringify(det.data.suggestedMapping), attested: "true" }) });
    assert.equal(staged.status, 201, JSON.stringify(staged.body));
    assert.equal(staged.data.status, "REVIEW_REQUIRED");
    const rows = await admin.get(`/catalogue/import/jobs/${staged.data.id}/rows?pageSize=5`);
    assert.equal(rows.data.items.length, 5);
    const done = await admin.post(`/catalogue/import/jobs/${staged.data.id}/commit`);
    assert.ok([200, 202].includes(done.status));
    assert.ok(["COMPLETED", "COMPLETED_WITH_WARNINGS", "RUNNING"].includes(done.data.status));
    const job = (await admin.get(`/catalogue/import/jobs/${staged.data.id}`)).data;
    assert.equal(job.status, "COMPLETED");
    const hit = await admin.get("/catalogue/search?q=12204-15030");
    assert.ok(hit.data.total >= 1);
    const sales = await t.as("SALES");
    assert.equal((await sales.get("/catalogue/search?q=12204-15030")).data.total, hit.data.total, "any staff role can read the catalogue");
    assert.equal((await sales.get("/catalogue/import/jobs")).status, 403, "but only admins see import history");
    assert.equal((await admin.get("/catalogue/import/jobs")).data[0].id, staged.data.id);
  });
});

test("offline package upload: preview, import (zip), rights gate, then serving the diagram", async () => {
  await withApp(async (t) => {
    const admin = await t.as("ADMIN");
    const files: Record<string, string | Uint8Array> = {
      "parts.csv": "oem_number,manufacturer,description\n15600-25010,Toyota,Filter Sub-Assy Oil",
      "drawings.csv": "code,title,image_file,rights\nMA1,Oil filter,images/diagrams/MA1.png,LICENSED_FOR_INTERNAL_USE",
      "drawing_parts.csv": "drawing,oem_number,manufacturer,callout,x1,y1,x2,y2\nMA1,15600-25010,Toyota,15601,10,10,60,30",
      "images/diagrams/MA1.png": PNG,
    };
    const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
    const manifest = { package_format_version: 1, package_id: "toy-1", provider: "toyota-epc", record_counts: { parts: 1, drawings: 1, drawing_parts: 1 }, checksums: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(bytes(v))])) };
    const zip = buildZip({ "manifest.json": JSON.stringify(manifest), ...files });
    const preview = await admin.send("POST", "/catalogue/import/package/preview", { form: fileForm("toy.ifcatalog", zip, "application/zip") });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.ok, true, JSON.stringify(preview.data.issues));
    const bad = await admin.send("POST", "/catalogue/import/package", { form: fileForm("junk.zip", new Uint8Array(500), "application/zip") });
    assert.equal(bad.status, 400);
    const imp = await admin.send("POST", "/catalogue/import/package", { form: fileForm("toy.ifcatalog", zip, "application/zip", { imagesLicenseConfirmed: "true" }) });
    assert.equal(imp.status, 201, JSON.stringify(imp.body));
    assert.equal(imp.data.status, "COMPLETED");
    const part = (await admin.get("/catalogue/parts/by-oem/15600-25010")).data;
    const drawing = (await admin.get(`/catalogue/drawings/${part.drawings[0].drawingId}`)).data;
    assert.equal(drawing.imageAvailable, true);
    const viewer = await t.as("VIEWER");
    const img = await viewer.get(`/catalogue/assets/${drawing.assetId}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await viewer.put(`/catalogue/assets/${drawing.assetId}/rights`, { rights: "DO_NOT_REPUBLISH", evidence: "Owner withdrew consent" })).status, 403);
    assert.equal((await admin.put(`/catalogue/assets/${drawing.assetId}/rights`, { rights: "DO_NOT_REPUBLISH", evidence: "Owner withdrew consent" })).status, 200);
    assert.equal((await viewer.get(`/catalogue/assets/${drawing.assetId}`)).status, 404, "withdrawn rights stop display immediately");
  });
});

test("Reference Catalogue and My Products stay separate; IMPORT TO MY PRODUCTS links them and refuses duplicates", async () => {
  await withApp(async (t) => {
    const admin = await t.as("ADMIN");
    const zip = buildZip({
      "manifest.json": JSON.stringify({ package_format_version: 1, package_id: "p1", provider: "csv" }),
      "parts.csv": "oem_number,manufacturer,description,price_usd\n90915-10009,Toyota,Oil filter,9.50",
    });
    assert.equal((await admin.send("POST", "/catalogue/import/package", { form: fileForm("p.zip", zip, "application/zip") })).status, 201);
    const ref = (await admin.get("/catalogue/parts/by-oem/90915-10009")).data;
    assert.equal(ref.linkedProducts.length, 0);
    for (const k of ["priceMinor", "costMinor", "stock", "sku", "available"]) assert.ok(!(k in ref), `reference part must not carry ${k}`);
    assert.equal((await admin.get("/products")).data.total, 0, "importing a catalogue creates no shop products");
    const inv = await t.as("INVENTORY");
    const made = await inv.post(`/catalogue/parts/${ref.id}/import-to-products`, { sku: "OIL-9", priceMinor: 1500, costMinor: 900 });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.data.sku, "OIL-9");
    const dup = await inv.post(`/catalogue/parts/${ref.id}/import-to-products`, { sku: "OIL-10" });
    assert.equal(dup.status, 409);
    const after = (await admin.get(`/catalogue/parts/${ref.id}`)).data;
    assert.equal(after.linkedProducts[0].sku, "OIL-9");
    const detail = (await inv.get(`/products/${made.data.id}`)).data;
    assert.ok(detail.referenceLinks.length === 1);
    assert.equal((await t.as("VIEWER").then((v) => v.post(`/catalogue/parts/${ref.id}/import-to-products`, { sku: "X" }))).status, 403);
    assert.equal((await inv.get("/products/lookup?code=90915-10009")).data.product.sku, "OIL-9", "the OEM number finds the product");
  });
});

test("the complete sales chain over HTTP: enquiry, quotation, order, fulfil, invoice, payment, with stock effects", async () => {
  await withApp(async (t) => {
    const owner = await t.as("OWNER");
    const wh = (await owner.post("/warehouses", { name: "Main" })).data;
    const loc = ((await owner.get("/warehouses")).data.locations as { id: string; warehouseId: string }[]).find((l) => l.warehouseId === wh.id)!;
    const cust = (await owner.post("/customers", { name: "Acme Garage", email: "a@acme.test" })).data;
    const prod = (await owner.post("/products", { sku: "OIL-001", name: "Oil filter", priceMinor: 10000, costMinor: 6000, openingStock: { locationId: loc.id, quantity: 10 } })).data;
    const sales = await t.as("SALES");
    await sales.post("/enquiries/items", { oemNumber: "OIL-001", partName: "Oil filter", quantity: 4 });
    const draft = (await sales.get("/enquiries/current")).data;
    assert.equal((await sales.post(`/enquiries/${draft.id}/submit`, { customerId: cust.id, contactName: "Buyer" })).data.status, "SUBMITTED");
    const q = (await sales.post(`/enquiries/${draft.id}/quotation`, {})).data;
    assert.equal(q.status, "DRAFT");
    assert.equal((await sales.post(`/quotations/${q.id}/issue`)).data.status, "ISSUED");
    assert.equal((await sales.post(`/quotations/${q.id}/accept`)).data.status, "ACCEPTED");
    const order = (await sales.post(`/quotations/${q.id}/order`, {})).data;
    const stock = async () => (await owner.get(`/products/${prod.id}/stock`)).data as { onHand: number; reserved: number; available: number }[];
    assert.deepEqual([(await stock())[0].onHand, (await stock())[0].reserved, (await stock())[0].available], [10, 4, 6]);
    assert.equal((await sales.post(`/orders/${order.id}/invoice`, {})).status, 409 - 0, "nothing delivered yet, nothing to invoice");
    const delivered = (await sales.post(`/orders/${order.id}/fulfil`, {})).data;
    assert.equal(delivered.status, "FULFILLED");
    assert.deepEqual([(await stock())[0].onHand, (await stock())[0].reserved], [6, 0]);
    const inv = (await sales.post(`/orders/${order.id}/invoice`, {})).data;
    assert.equal(inv.status, "ISSUED");
    const total = inv.totalMinor as number;
    assert.equal((await sales.post(`/invoices/${inv.id}/payments`, { amountMinor: total + 1, method: "CASH" })).status, 400);
    const part = await sales.post(`/invoices/${inv.id}/payments`, { amountMinor: 10000, method: "CASH" });
    assert.equal(part.data.invoice.status, "PARTIALLY_PAID");
    const rest = await sales.post(`/invoices/${inv.id}/payments`, { amountMinor: total - 10000, method: "BANK_TRANSFER" });
    assert.equal(rest.data.invoice.status, "PAID");
    assert.equal((await sales.get(`/invoices/${inv.id}`)).data.payments.length, 2);
    assert.equal((await sales.get("/reports/dashboard")).data.outstandingInvoices, 0);
    const csv = await owner.get("/reports/sales-by-product?format=csv");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type")!, /text\/csv/);
    assert.equal((await t.as("VIEWER").then((v) => v.get("/reports/sales-by-product"))).status, 403);
    assert.deepEqual((await owner.get("/inventory/integrity")).data, [], "stock ledger and balances agree");
  });
});

test("audit trail records who did what, without secrets", async () => {
  await withApp(async (t) => {
    const owner = await t.as("OWNER");
    await owner.post("/customers", { name: "Audited Co" });
    await t.client().login("owner@example.test", "wrong-password-here");
    await owner.post("/users", { email: "z@example.test", displayName: "Z", role: "VIEWER", password: "super-secret-pass-999" });
    const events = (await owner.get("/audit?limit=100")).data as { action: string; actorName?: string; summary: string; metadata?: unknown }[];
    assert.ok(events.some((e) => e.action === "customer.create"));
    assert.ok(events.some((e) => e.action === "user.create"));
    const dump = JSON.stringify(events);
    assert.ok(!dump.includes("super-secret-pass-999"), "passwords never reach the audit log");
    assert.ok(!dump.includes("correct-horse-battery"));
    assert.ok(!/scrypt|password_hash/i.test(dump));
    assert.equal((await (await t.as("SALES")).get("/audit")).status, 403);
  });
});
