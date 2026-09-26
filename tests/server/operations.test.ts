import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/server/db/connection";
import { migrate } from "../../src/server/db/migrate";
import { migrations } from "../../src/server/db/migrations";
import { createContainer } from "../../src/server/standalone/container";
import { createApp } from "../../src/server/domain/app";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "../../src/server/ops/backup";
import { makeApp, seedBasics } from "./helpers";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("migrations: a fresh database gets every migration once, in order, and is internally consistent", async () => {
  const db = Database.open(":memory:");
  try {
    const first = await migrate(db);
    assert.deepEqual(
      first.applied,
      migrations.map((m) => m.version),
    );
    const again = await migrate(db);
    assert.deepEqual(again.applied, []);
    assert.deepEqual(
      again.alreadyApplied,
      migrations.map((m) => m.version),
    );
    await db.read((h) => {
      assert.equal(
        h.get<{ integrity_check: string }>("PRAGMA integrity_check")
          ?.integrity_check,
        "ok",
      );
      assert.deepEqual(h.all("PRAGMA foreign_key_check"), []);
      const tables = h
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table'",
        )
        .map((r) => r.name);
      for (const t of [
        "app_config",
        "users",
        "sessions",
        "audit_events",
        "files",
        "products",
        "stock_movements",
        "stock_balances",
        "reservations",
        "quotations",
        "sales_orders",
        "invoices",
        "payments",
        "purchase_orders",
        "catalogue_parts",
        "fitments",
        "drawings",
        "drawing_callouts",
        "import_jobs",
        "product_reference_links",
      ])
        assert.ok(tables.includes(t), `table ${t}`);
    });
  } finally {
    await db.close();
  }
});

test("migrations: upgrading a database created by an earlier release keeps its data and adds the new schema", async () => {
  const dir = tmp("sp-upgrade-");
  const file = join(dir, "spareparts.sqlite");
  try {
    // "release 1": migrations 0001-0003 only, with real rows in it
    const old = Database.open(file);
    await migrate(old, migrations.slice(0, 3));
    await old.write((h) => {
      const now = new Date().toISOString();
      h.run(
        `INSERT INTO customers(id, code, name, currency, status, created_at, updated_at) VALUES ('c1','CUS-000001','Legacy Garage','AED','ACTIVE',?,?)`,
        [now, now],
      );
      h.run(
        `INSERT INTO warehouses(id, code, name, status) VALUES ('w1','WH-000001','Old warehouse','ACTIVE')`,
      );
      h.run(
        `INSERT INTO locations(id, warehouse_id, code) VALUES ('l1','w1','MAIN')`,
      );
    });
    assert.equal(
      await old.read((h) =>
        h.count(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'import_jobs'",
        ),
      ),
      0,
      "the catalogue schema does not exist yet",
    );
    await old.close();

    // "release 2": start the current application on the same file
    const c = await createContainer({ dataDir: dir });
    try {
      const applied = await c.db.read((h) =>
        h
          .all<{ version: string }>(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
          .map((r) => r.version),
      );
      assert.deepEqual(
        applied,
        migrations.map((m) => m.version),
      );
      assert.equal(
        await c.db.read(
          (h) =>
            h.get<{ name: string }>(
              "SELECT name FROM customers WHERE id = 'c1'",
            )?.name,
        ),
        "Legacy Garage",
      );
      assert.equal(
        await c.db.read((h) =>
          h.count(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'import_jobs'",
          ),
        ),
        1,
      );
      assert.deepEqual(
        await c.db.read((h) => h.all("PRAGMA foreign_key_check")),
        [],
      );
      // and the new features work on the upgraded database
      const app = createApp(c);
      const owner = await c.identity.createUser(null, {
        email: "o@example.test",
        displayName: "O",
        role: "OWNER",
        password: "correct-horse-battery",
      });
      const list = await app.masterData.listCustomers(owner, {});
      assert.equal(list.total, 1);
      assert.equal((await app.catalogue.stats(owner)).parts, 0);
    } finally {
      await c.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrations: history is append-only, so an edited migration is refused", async () => {
  const db = Database.open(":memory:");
  try {
    await migrate(db);
    const tampered = migrations.map((m, i) =>
      i === 1 ? { ...m, sql: m.sql + "\n-- edited" } : m,
    );
    await assert.rejects(
      () => migrate(db, tampered),
      /was modified after it was applied/,
    );
  } finally {
    await db.close();
  }
});

test("a failed migration rolls back completely instead of leaving a half-upgraded database", async () => {
  const db = Database.open(":memory:");
  try {
    await migrate(db, migrations.slice(0, 2));
    await assert.rejects(() =>
      migrate(db, [
        ...migrations.slice(0, 2),
        {
          version: "9999",
          name: "broken",
          sql: "CREATE TABLE ok_table(id TEXT); CREATE TABLE ok_table(id TEXT);",
        },
      ]),
    );
    assert.equal(
      await db.read((h) =>
        h.count(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ok_table'",
        ),
      ),
      0,
    );
    assert.equal(
      await db.read((h) =>
        h.count("SELECT COUNT(*) AS n FROM schema_migrations"),
      ),
      2,
    );
  } finally {
    await db.close();
  }
});

test("backup and restore: everything comes back — data, photos, and stock ledger — and damage is detected", async () => {
  const t = await makeApp();
  const backupDir = tmp("sp-backup-");
  const restoreDir = tmp("sp-restore-");
  rmSync(backupDir, { recursive: true, force: true });
  try {
    const { product } = await seedBasics(t);
    const png = new Uint8Array(40);
    png.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52,
    ]);
    const img = await t.app.products.addImage(t.actors.OWNER, product.id, {
      bytes: png,
      fileName: "a.png",
      primary: true,
    });

    const manifest = await createBackup(t.container.db, t.dir, backupDir);
    assert.equal(manifest.files.count, 1);
    assert.equal(
      verifyBackup(backupDir).database.sha256,
      manifest.database.sha256,
    );
    await assert.rejects(
      () => createBackup(t.container.db, t.dir, backupDir),
      /must be empty/,
    );

    // the live database keeps working while and after a backup
    await t.app.masterData.createCustomer(t.actors.OWNER, {
      name: "After backup",
    });

    rmSync(restoreDir, { recursive: true, force: true });
    restoreBackup(backupDir, restoreDir);
    assert.throws(
      () => restoreBackup(backupDir, restoreDir),
      /never overwrites/,
    );
    const restored = await createContainer({ dataDir: restoreDir });
    try {
      const app = createApp(restored);
      const owner = await restored.identity.authenticate(
        (
          await restored.identity.signIn({
            email: "owner@example.test",
            password: "correct-horse-battery",
            ip: null,
            userAgent: null,
          })
        ).token,
      );
      const actor = owner!.actor;
      assert.equal(
        (await app.products.detail(actor, product.id)).product.sku,
        "OIL-001",
      );
      assert.equal(
        (await app.masterData.listCustomers(actor, {})).items.some(
          (c) => c.name === "After backup",
        ),
        false,
        "the backup is a point in time",
      );
      assert.equal(
        (await app.masterData.listCustomers(actor, {})).items.some(
          (c) => c.name === "Acme Garage",
        ),
        true,
      );
      const file = await restored.repos.files.get(img.fileId);
      assert.deepEqual([...file!.bytes], [...png]);
      assert.deepEqual(await restored.repos.inventory.verifyIntegrity(), []);
    } finally {
      await restored.close();
    }

    // damage is caught before anything is restored
    writeFileSync(join(backupDir, "spareparts.sqlite"), "corrupt");
    assert.throws(() => verifyBackup(backupDir), /damaged/);
    assert.throws(() => verifyBackup(tmp("sp-notbackup-")), /not a backup/);
  } finally {
    await t.cleanup();
    for (const d of [backupDir, restoreDir])
      rmSync(d, { recursive: true, force: true });
  }
});

test("offline: the server code contains no outbound network calls, and a full workflow runs with the network cut", async () => {
  // static guard: nothing under src/server may reach for the network
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  for (const file of walk(join(process.cwd(), "src/server")).filter((f) =>
    /\.tsx?$/.test(f),
  )) {
    const code = readFileSync(file, "utf8");
    assert.ok(!/\bfetch\s*\(/.test(code), `${file} calls fetch()`);
    assert.ok(
      !/from\s+["']node:(http|https|net|dgram|dns|tls)["']/.test(code),
      `${file} imports a network module`,
    );
    assert.ok(
      !/\bXMLHttpRequest\b|\bWebSocket\b/.test(code),
      `${file} uses a network API`,
    );
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network is unavailable");
  }) as typeof fetch;
  const t = await makeApp();
  try {
    const { customer, product } = await seedBasics(t);
    const s = t.actors.SALES;
    const q = await t.app.sales.createQuotation(s, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 2, unitPriceMinor: 10000 }],
    });
    await t.app.sales.issueQuotation(s, q.id);
    await t.app.sales.acceptQuotation(s, q.id);
    const order = await t.app.sales.convertToOrder(s, q.id);
    await t.app.sales.fulfillOrder(s, order.id, {});
    const inv = await t.app.sales.invoiceOrder(s, order.id, {});
    await t.app.sales.recordPayment(s, inv.id, {
      amountMinor: inv.totalMinor,
      method: "CASH",
    });
    const pdf = await t.app.documents.invoicePdf(s, inv.id);
    assert.ok(pdf.bytes.length > 500);
    assert.equal(
      (await t.app.reports.dashboard(t.actors.OWNER)).outstandingInvoices,
      0,
    );
    assert.deepEqual(await t.container.repos.inventory.verifyIntegrity(), []);
  } finally {
    globalThis.fetch = realFetch;
    await t.cleanup();
  }
  assert.ok(existsSync(process.cwd()));
});

test("generated reference documentation is up to date with the code", async () => {
  const { apiRoutes, permissionsMatrix, schemaReference } =
    await import("../../src/server/ops/generatedDocs");
  const prettier = await import("prettier");
  const fmt = (s: string) => prettier.format(s, { parser: "markdown" });
  const read = (f: string) =>
    readFileSync(join(process.cwd(), "docs/generated", f), "utf8").replace(
      /\r\n/g,
      "\n",
    );
  assert.equal(
    read("PERMISSIONS_MATRIX.md"),
    await fmt(permissionsMatrix()),
    "run npm run docs:generate",
  );
  assert.equal(
    read("API_ROUTES.md"),
    await fmt(apiRoutes()),
    "run npm run docs:generate",
  );
  assert.equal(
    read("SCHEMA.md"),
    await fmt(await schemaReference()),
    "run npm run docs:generate",
  );
});
