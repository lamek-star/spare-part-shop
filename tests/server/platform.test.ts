import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  permissionsFor,
  permissionsOf,
  type Permission,
} from "../../src/server/domain/permissions";
import {
  CAPABILITY_PERMISSIONS,
  permissionsFromCapabilities,
  roleFromCapabilities,
} from "../../src/server/platform/capabilities";
import { IntraForgeClient } from "../../src/server/platform/intraforge";
import { composePlatform } from "../../src/server/platform/container";
import { Database, type SqlDatabase } from "../../src/server/db/connection";
import { migrate } from "../../src/server/db/migrate";
import {
  openTestPostgres,
  testStoreIsPostgres,
} from "../../src/server/db/testStore";
import { createApp } from "../../src/server/domain/app";
import { createHttpHandler } from "../../src/server/http/core";
import { buildRouter } from "../../src/server/http/routes";
import type { AppContainer } from "../../src/server/standalone/container";

// ------------------------------------------------------------ the mapping

// IntraForge's four staff roles (apps/backend/permissions/catalog.py).
const ALL = Object.keys(CAPABILITY_PERMISSIONS);
const INTRAFORGE_ROLES: Record<string, string[]> = {
  "spare-parts-manager": ALL,
  "spare-parts-sales": [
    "spareparts.view",
    "spareparts.catalogue.read",
    "spareparts.products.read",
    "spareparts.inventory.read",
    "spareparts.sales.read",
    "spareparts.sales.manage",
    "spareparts.reports.sales",
  ],
  "spare-parts-inventory": [
    "spareparts.view",
    "spareparts.catalogue.read",
    "spareparts.products.read",
    "spareparts.products.manage",
    "spareparts.cost.read",
    "spareparts.inventory.read",
    "spareparts.inventory.manage",
    "spareparts.purchasing.read",
    "spareparts.purchasing.manage",
    "spareparts.reports.inventory",
  ],
  "spare-parts-viewer": [
    "spareparts.view",
    "spareparts.catalogue.read",
    "spareparts.products.read",
    "spareparts.inventory.read",
  ],
};
const sorted = (xs: readonly string[]) => [...xs].sort();

test("platform: IntraForge's staff roles reproduce this application's roles exactly", () => {
  assert.deepEqual(
    sorted(
      permissionsFromCapabilities(INTRAFORGE_ROLES["spare-parts-manager"]),
    ),
    sorted(permissionsFor("OWNER")),
  );
  for (const [role, mine] of [
    ["spare-parts-sales", "SALES"],
    ["spare-parts-inventory", "INVENTORY"],
    ["spare-parts-viewer", "VIEWER"],
  ] as const) {
    assert.deepEqual(
      sorted(permissionsFromCapabilities(INTRAFORGE_ROLES[role])),
      sorted(permissionsFor(mine)),
      role,
    );
    assert.equal(roleFromCapabilities(INTRAFORGE_ROLES[role]), mine);
  }
  assert.equal(roleFromCapabilities(ALL), "ADMIN");
  // no capability: nothing at all, not the VIEWER role's rights
  assert.deepEqual(permissionsOf({ role: "VIEWER", permissions: [] }), []);
  // unknown capability strings grant nothing
  assert.deepEqual(permissionsFromCapabilities(["database.write", "x"]), []);
});

// ------------------------------------------------------------ a fake IntraForge

const TOKEN = "s".repeat(40);
interface Fake {
  url: string;
  server: Server;
  calls: { method: string; path: string; body: unknown }[];
  sessions: Map<string, { capabilities: string[]; user: string }>;
  audit: Map<string, unknown>;
  files: Map<string, Buffer>;
  deleted: string[];
  config: Record<string, unknown>;
  down: boolean;
  corrupt: boolean;
}

async function fakeIntraForge(): Promise<Fake> {
  const fake: Fake = {
    url: "",
    server: null as unknown as Server,
    calls: [],
    sessions: new Map(),
    audit: new Map(),
    files: new Map(),
    deleted: [],
    config: { shopName: "Harbour Motors", currency: "AED", defaultTaxBp: 500 },
    down: false,
    corrupt: false,
  };
  fake.server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const path = (req.url ?? "").replace("/api/v1/internal/service-apps", "");
    const ct = String(req.headers["content-type"] ?? "");
    const body = ct.startsWith("application/json")
      ? JSON.parse(raw.toString() || "{}")
      : null;
    fake.calls.push({ method: req.method!, path, body });
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (fake.down) return send(502);
    if (req.headers["x-intraforge-service-token"] !== TOKEN)
      return send(401, { detail: "no" });
    if (path === "/sessions/introspect/") {
      const s = fake.sessions.get(body.token);
      if (!s) return send(401, { active: false });
      return send(200, {
        active: true,
        user: {
          id: s.user,
          email: `${s.user}@example.test`,
          displayName: s.user,
        },
        capabilities: s.capabilities,
        csrfToken: "csrf-" + body.token,
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
        sessionId: "1",
      });
    }
    if (path === "/sessions/revoke/") {
      fake.sessions.delete(body.token);
      return send(200, { ok: true });
    }
    if (path === "/audit-events/") {
      for (const e of body.events) fake.audit.set(e.id, e);
      return send(200, {
        accepted: body.events.map((e: { id: string }) => e.id),
      });
    }
    if (path === "/config/" && req.method === "GET")
      return send(200, fake.config);
    if (path === "/config/" && req.method === "PATCH") {
      if (body.actorId !== "owner") return send(403, { detail: "no" });
      Object.assign(fake.config, body.patch);
      return send(200, fake.config);
    }
    if (path === "/files/" && req.method === "POST") {
      const form = await new Response(raw, {
        headers: { "content-type": ct },
      }).formData();
      const file = form.get("file") as File;
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = randomUUID();
      fake.files.set(id, bytes);
      return send(201, {
        id,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mime: file.type,
        quarantined: false,
      });
    }
    const m = /^\/files\/([0-9a-f-]+)\/$/.exec(path);
    if (m && req.method === "GET") {
      const bytes = fake.files.get(m[1]);
      if (!bytes) return send(404);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(fake.corrupt ? Buffer.from("tampered") : bytes);
    }
    if (m && req.method === "DELETE") {
      fake.deleted.push(m[1]);
      fake.files.delete(m[1]);
      return send(204);
    }
    if (path === "/users/")
      return send(200, {
        results: [...fake.sessions.values()].map((s) => ({
          id: s.user,
          email: `${s.user}@example.test`,
          displayName: s.user,
          active: true,
          capabilities: s.capabilities,
        })),
      });
    return send(404);
  });
  await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  return fake;
}

async function platformApp() {
  const fake = await fakeIntraForge();
  const dir = mkdtempSync(join(tmpdir(), "sp-platform-"));
  let db: SqlDatabase;
  let closeDb: () => Promise<void>;
  if (testStoreIsPostgres()) {
    const s = await openTestPostgres(dir);
    db = s.db;
    closeDb = s.close;
  } else {
    const d = Database.open(":memory:");
    db = d;
    closeDb = () => d.close();
  }
  await migrate(db);
  const client = new IntraForgeClient({
    internalUrl: fake.url,
    serviceToken: TOKEN,
    timeoutMs: 2000,
  });
  const parts = composePlatform(db, client);
  const container = {
    db,
    ...parts,
    dataDir: dir,
    self: {
      installed: true,
      app: { id: "app-1", display_name: "Harbour Motors" },
    },
    close: async () => undefined,
  } as unknown as AppContainer;
  const app = createApp(container);
  const settle = () => new Promise((r) => setTimeout(r, 150));
  return {
    fake,
    db,
    app,
    container,
    parts,
    settle,
    async cleanup() {
      parts.relay.stop();
      await closeDb();
      await new Promise((r) => fake.server.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ------------------------------------------------------------ identity + HTTP

test("platform: the IntraForge session opens the app; nothing else does", async () => {
  const t = await platformApp();
  try {
    const token = "tok-" + "x".repeat(30);
    t.fake.sessions.set(token, {
      user: "sales",
      capabilities: INTRAFORGE_ROLES["spare-parts-sales"],
    });
    const handler = createHttpHandler(
      buildRouter(),
      async () => ({ app: t.app, container: t.container }),
      {
        sessionCookie: "ifapp_spare_parts",
        cookiePath: "/apps/spare-parts/",
        log: () => {},
      },
    );
    const call = (path: string, init: RequestInit = {}, cookie = true) =>
      handler(
        new Request(`http://shop.test/api/v1${path}`, {
          ...init,
          headers: {
            ...(cookie ? { cookie: `ifapp_spare_parts=${token}` } : {}),
            ...(init.headers ?? {}),
          },
        }),
      );
    const me = await call("/auth/me");
    assert.equal(me.status, 200);
    const body = (await me.json()) as {
      data: { user: { role: string }; permissions: Permission[] };
    };
    assert.equal(body.data.user.role, "SALES");
    assert.ok(body.data.permissions.includes("payments.record"));
    assert.ok(!body.data.permissions.includes("products.cost.read"));
    assert.ok(
      !("permissions" in body.data.user),
      "the raw grant list is not echoed",
    );
    // a SALES user may not see costs or receive stock
    assert.equal((await call("/reports/inventory-valuation")).status, 403);
    // no cookie, a wrong cookie, the old app cookie: all anonymous
    assert.equal((await call("/auth/me", {}, false)).status, 401);
    const other = await handler(
      new Request("http://shop.test/api/v1/auth/me", {
        headers: { cookie: "sp_session=" + token },
      }),
    );
    assert.equal(other.status, 401);
    // state changes need the CSRF token IntraForge derived for this session
    const noCsrf = await call("/customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://shop.test",
      },
      body: JSON.stringify({ name: "Walk-in" }),
    });
    assert.equal(noCsrf.status, 403);
    const ok = await call("/customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://shop.test",
        "x-csrf-token": "csrf-" + token,
      },
      body: JSON.stringify({ name: "Walk-in" }),
    });
    assert.equal(ok.status, 201);
    // the app's own sign-in and user management are closed
    const login = await call(
      "/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://shop.test",
        },
        body: JSON.stringify({ email: "a@b.c", password: "x" }),
      },
      false,
    );
    assert.equal(
      ((await login.json()) as { error: { code: string } }).error.code,
      "USE_INTRAFORGE",
    );
    // logging out revokes in IntraForge
    await call("/auth/logout", {
      method: "POST",
      headers: { origin: "http://shop.test", "x-csrf-token": "csrf-" + token },
    });
    assert.ok(!t.fake.sessions.has(token));
  } finally {
    await t.cleanup();
  }
});

test("platform: losing a capability in IntraForge takes effect within seconds", async () => {
  const t = await platformApp();
  try {
    const identity = t.parts.identity;
    const token = "tok-" + "y".repeat(30);
    t.fake.sessions.set(token, {
      user: "u",
      capabilities: INTRAFORGE_ROLES["spare-parts-inventory"],
    });
    assert.ok(
      (await identity.authenticate(token))?.actor.permissions?.includes(
        "inventory.write",
      ),
    );
    t.fake.sessions.delete(token);
    assert.ok(await identity.authenticate(token), "cached for a few seconds");
    await new Promise((r) => setTimeout(r, 5200));
    assert.equal(await identity.authenticate(token), null);
  } finally {
    await t.cleanup();
  }
});

// ------------------------------------------------------------ audit relay

test("platform: audit events relay after commit, exactly the committed ones, and survive an outage", async () => {
  const t = await platformApp();
  try {
    const actor = { id: "owner", displayName: "Owner" };
    await t.db.write(() =>
      t.parts.repos.audit.record(actor, {
        action: "product.create",
        entityType: "product",
        entityId: "p1",
        summary: "created",
      }),
    );
    await assert.rejects(
      t.db.write(async () => {
        await t.parts.repos.audit.record(actor, {
          action: "product.update",
          entityType: "product",
          entityId: "p1",
          summary: "rolled back",
        });
        throw new Error("boom");
      }),
    );
    await t.settle();
    assert.deepEqual(
      [...t.fake.audit.values()].map((e) => (e as { action: string }).action),
      ["product.create"],
    );
    assert.equal(await t.parts.relay.pending(), 0);

    t.fake.down = true;
    await t.parts.repos.audit.record(actor, {
      action: "stock.adjust",
      entityType: "product",
      summary: "during outage",
    });
    await t.settle();
    assert.equal(await t.parts.relay.pending(), 1, "kept for retry");
    t.fake.down = false;
    await t.parts.relay.flush();
    assert.equal(await t.parts.relay.pending(), 0);
    assert.equal(t.fake.audit.size, 2);
  } finally {
    await t.cleanup();
  }
});

// ------------------------------------------------------------ files and config

test("platform: files live in IntraForge, are verified on read, and are deleted only after commit", async () => {
  const t = await platformApp();
  try {
    const files = t.parts.repos.files;
    const png = Buffer.from("\x89PNG\r\n\x1a\nfake-image-bytes");
    const stored = await files.put({
      bytes: png,
      originalName: "../../evil name.png",
      mime: "image/png",
      kind: "PRODUCT_IMAGE",
      entityType: "product",
      entityId: "p1",
      createdBy: "owner",
    });
    assert.equal(t.fake.files.size, 1);
    assert.equal(stored.originalName, "evil name.png");
    assert.deepEqual(Buffer.from((await files.get(stored.id))!.bytes), png);
    t.fake.corrupt = true;
    await assert.rejects(files.get(stored.id), /integrity/);
    t.fake.corrupt = false;
    await assert.rejects(
      t.db.write(async () => {
        await files.delete(stored.id);
        throw new Error("rollback");
      }),
    );
    await t.settle();
    assert.deepEqual(
      t.fake.deleted,
      [],
      "a rolled-back delete leaves the file",
    );
    assert.ok(await files.meta(stored.id));
    await files.delete(stored.id);
    await t.settle();
    assert.equal(t.fake.deleted.length, 1);
    assert.equal(await files.meta(stored.id), null);
  } finally {
    await t.cleanup();
  }
});

test("platform: shop settings come from IntraForge; numbers stay atomic in the schema", async () => {
  const t = await platformApp();
  try {
    const config = t.parts.repos.config;
    assert.equal((await config.get()).shopName, "Harbour Motors");
    await assert.rejects(
      config.update(
        { id: "sales", email: "", displayName: "", role: "SALES" },
        { phone: "1" },
      ),
      /permission/,
    );
    const updated = await config.update(
      { id: "owner", email: "", displayName: "", role: "ADMIN" },
      { phone: "04 555" },
    );
    assert.equal(updated.phone, "04 555");
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.db.write(() => config.nextNumber("invoice", "INV")),
      ),
    );
    assert.equal(new Set(numbers).size, 20);
  } finally {
    await t.cleanup();
  }
});
