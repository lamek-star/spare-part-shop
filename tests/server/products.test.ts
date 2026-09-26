import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeApp, seedBasics } from "./helpers";
import { AppError } from "../../src/server/kernel/errors";
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_IMAGE_BYTES,
  sniffImage,
} from "../../src/server/domain/products";

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
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
]);
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

test("customers and suppliers persist with generated codes, validation and search", async () => {
  const t = await makeApp();
  try {
    const o = t.actors.OWNER;
    const c1 = await t.app.masterData.createCustomer(o, {
      name: "Al Noor Auto",
      email: "a@noor.test",
      country: "AE",
      creditLimitMinor: 500000,
    });
    const c2 = await t.app.masterData.createCustomer(o, {
      name: "Bravo Motors",
    });
    assert.deepEqual([c1.code, c2.code], ["CUS-000001", "CUS-000002"]);
    assert.equal(
      await code(t.app.masterData.createCustomer(o, { name: "" })),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.masterData.createCustomer(o, {
          name: "Bad",
          email: "not-an-email",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.masterData.createCustomer(o, { name: "Bad", currency: "dirham" }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.masterData.createCustomer(o, {
          name: "Bad",
          creditLimitMinor: -5,
        }),
      ),
      "VALIDATION",
    );
    const found = await t.app.masterData.listCustomers(o, { q: "noor" });
    assert.deepEqual(
      found.items.map((c) => c.name),
      ["Al Noor Auto"],
    );
    const updated = await t.app.masterData.updateCustomer(o, c1.id, {
      phone: "+971 50 000 0000",
    });
    assert.equal(updated.phone, "+971 50 000 0000");
    assert.equal(updated.name, "Al Noor Auto");
    const s = await t.app.masterData.createSupplier(o, {
      name: "Tokyo Parts Co",
      country: "JP",
      currency: "JPY",
    });
    assert.equal(s.code, "SUP-000001");
    assert.equal((await t.app.masterData.listSuppliers(o, {})).total, 1);
    // LIKE wildcards in a search are literal
    assert.equal(
      (await t.app.masterData.listCustomers(o, { q: "%" })).total,
      0,
    );
  } finally {
    await t.cleanup();
  }
});

test("products: unique SKU, validation, opening stock, auto SKU number, optimistic locking", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const o = t.actors.OWNER;
    assert.equal(
      await code(
        t.app.products.create(o, {
          sku: "oil-001",
          name: "Dup",
          priceMinor: 1,
        }),
      ),
      "CONFLICT",
      "SKU is unique case-insensitively",
    );
    assert.equal(
      await code(
        t.app.products.create(o, { sku: "", name: "No sku", priceMinor: 1 }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.products.create(o, { sku: "N1", name: "Neg", priceMinor: -1 }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.products.create(o, { sku: "N2", name: "Frac", priceMinor: 10.5 }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.app.products.create(o, {
          sku: "N3",
          name: "Bad cond",
          priceMinor: 1,
          condition: "BROKEN",
        }),
      ),
      "VALIDATION",
    );
    const detail = await t.app.products.detail(o, product.id);
    assert.equal(
      detail.numbers.some(
        (n) =>
          n.type === "INTERNAL_SKU" && n.normalized === "OIL001" && n.primary,
      ),
      true,
    );
    assert.deepEqual(detail.totals, { onHand: 10, reserved: 0, available: 10 });
    const updated = await t.app.products.update(o, product.id, {
      priceMinor: 12000,
      expectedUpdatedAt: detail.product.updatedAt,
    });
    assert.equal(updated.priceMinor, 12000);
    assert.equal(
      await code(
        t.app.products.update(o, product.id, {
          priceMinor: 13000,
          expectedUpdatedAt: detail.product.updatedAt,
        }),
      ),
      "STALE",
    );
    assert.equal(
      await code(
        t.app.products.update(o, product.id, { sku: "OIL-001", name: "" }),
      ),
      "VALIDATION",
    );
    const audit = await t.app.audit.query(o, {
      entityType: "product",
      entityId: product.id,
    });
    const change = audit.find((e) => e.action === "product.price_change")!;
    assert.deepEqual(change.metadata, { fromMinor: 10000, toMinor: 12000 });
  } finally {
    await t.cleanup();
  }
});

test("cost price is permission controlled everywhere it could leak", async () => {
  const t = await makeApp();
  try {
    const { product, supplier } = await seedBasics(t);
    await t.app.products.setSupplier(t.actors.OWNER, product.id, {
      supplierId: supplier.id,
      costMinor: 5500,
      supplierPartNumber: "SP-1",
    });
    const asSales = await t.app.products.detail(t.actors.SALES, product.id);
    assert.equal(asSales.product.costMinor, null);
    assert.ok(asSales.suppliers.every((s) => s.costMinor === null));
    assert.equal(
      (await t.app.products.list(t.actors.SALES, {})).items[0].costMinor,
      null,
    );
    assert.equal(
      (await t.app.products.lookup(t.actors.SALES, "OIL-001"))!.product
        .costMinor,
      null,
    );
    assert.equal(
      (await t.app.products.detail(t.actors.INVENTORY, product.id)).product
        .costMinor,
      6000,
    );
    assert.equal(
      (await t.app.products.detail(t.actors.ADMIN, product.id)).product
        .costMinor,
      6000,
    );
    assert.equal(
      await code(
        t.app.products.update(t.actors.SALES, product.id, { costMinor: 1 }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.products.update(t.actors.VIEWER, product.id, { priceMinor: 1 }),
      ),
      "FORBIDDEN",
    );
    assert.equal(
      await code(
        t.app.products.create(t.actors.SALES, {
          sku: "S1",
          name: "x",
          priceMinor: 1,
        }),
      ),
      "FORBIDDEN",
    );
  } finally {
    await t.cleanup();
  }
});

test("search finds products by name, SKU, brand or any number in any format; low-stock filter uses available stock", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const o = t.actors.OWNER;
    await t.app.products.addNumber(o, product.id, {
      display: "90915-10009",
      type: "OEM_OE",
      brand: "Toyota",
    });
    for (const q of [
      "oil",
      "oil-001",
      "OIL001",
      "toyota",
      "9091510009",
      "90915 10009",
      "90915-10009",
    ])
      assert.equal((await t.app.products.list(o, { q })).total, 1, q);
    assert.equal(
      (await t.app.products.list(o, { q: "nothing-matches" })).total,
      0,
    );
    assert.equal(
      await code(
        t.app.products.addNumber(o, product.id, {
          display: "9091510009",
          type: "OEM_OE",
        }),
      ),
      "CONFLICT",
    );
    assert.equal(
      (await t.app.products.list(o, { lowStockOnly: true })).total,
      0,
    );
    await t.app.inventory.adjust(o, {
      productId: product.id,
      locationId: (await t.container.repos.masterData.listLocations())[0].id,
      delta: -8,
      reason: "count",
    });
    assert.equal(
      (await t.app.products.list(o, { lowStockOnly: true })).total,
      1,
      "2 available <= reorder level 3",
    );
    const hit = await t.app.products.lookup(o, "90915 10009");
    assert.equal(hit?.product.sku, "OIL-001");
    assert.equal(hit?.available, 2);
    assert.equal(await t.app.products.lookup(o, "no-such-code"), null);
  } finally {
    await t.cleanup();
  }
});

test("sniffing identifies images from their bytes, not their names", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(JPEG), "jpeg");
  assert.equal(sniffImage(SVG), null);
  assert.equal(sniffImage(HTML), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

test("product photos: validated by content, ordered, one primary, deleted with their file", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const o = t.actors.OWNER;
    const one = await t.app.products.addImage(o, product.id, {
      bytes: PNG,
      fileName: "front.png",
      caption: "Front",
    });
    const two = await t.app.products.addImage(o, product.id, {
      bytes: JPEG,
      fileName: "side.JPG",
    });
    assert.equal(one.isPrimary, true, "the first photo becomes primary");
    assert.equal(two.isPrimary, false);
    assert.equal(one.mime, "image/png");
    assert.match(one.url, /^\/api\/v1\/files\/[0-9a-f-]{36}$/);
    await t.app.products.setPrimaryImage(o, product.id, two.id);
    let images = (await t.app.products.detail(o, product.id)).images;
    assert.deepEqual(
      images.map((i) => [i.id === two.id, i.isPrimary]).filter((x) => x[1]),
      [[true, true]],
    );
    await t.app.products.reorderImages(o, product.id, [two.id, one.id]);
    images = (await t.app.products.detail(o, product.id)).images;
    assert.deepEqual(
      images.map((i) => i.id),
      [two.id, one.id],
    );
    assert.equal(
      await code(t.app.products.reorderImages(o, product.id, [one.id])),
      "VALIDATION",
    );
    // the bytes are really stored and verified on read
    const stored = await t.container.repos.files.get(one.fileId);
    assert.deepEqual([...stored!.bytes], [...PNG]);
    // deleting the primary promotes another
    await t.app.products.removeImage(o, product.id, two.id);
    images = (await t.app.products.detail(o, product.id)).images;
    assert.equal(images.length, 1);
    assert.equal(images[0].isPrimary, true);
    assert.equal(
      await t.container.repos.files.get(two.fileId),
      null,
      "file removed with the photo",
    );
  } finally {
    await t.cleanup();
  }
});

test("product photo uploads reject spoofed, oversized and dangerous files", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const o = t.actors.OWNER;
    const add = (bytes: Uint8Array, fileName: string) =>
      code(t.app.products.addImage(o, product.id, { bytes, fileName }));
    assert.equal(
      await add(SVG, "logo.svg"),
      "VALIDATION",
      "SVG can carry script",
    );
    assert.equal(
      await add(HTML, "photo.png"),
      "VALIDATION",
      "HTML renamed to .png",
    );
    assert.equal(
      await add(PNG, "photo.jpg"),
      "VALIDATION",
      "extension must match the content",
    );
    assert.equal(await add(PNG, "noext"), "VALIDATION");
    assert.equal(await add(new Uint8Array(0), "empty.png"), "VALIDATION");
    assert.equal(
      await add(
        new Uint8Array([...PNG, ...new Uint8Array(MAX_IMAGE_BYTES)]),
        "big.png",
      ),
      "VALIDATION",
    );
    assert.equal(
      await add(PNG, "../../etc/passwd.png"),
      "OK",
      "a hostile name is only metadata; it is sanitised, never used as a path",
    );
    const files = await t.container.db.read((h) =>
      h.all<{ original_name: string; storage_key: string }>(
        "SELECT original_name, storage_key FROM files",
      ),
    );
    assert.equal(files.length, 1);
    assert.doesNotMatch(files[0].original_name, /[\\/]/);
    assert.match(files[0].storage_key, /^[0-9a-f]{2}\/[0-9a-f-]{36}$/);
    assert.equal(
      await code(
        t.app.products.addImage(t.actors.SALES, product.id, {
          bytes: PNG,
          fileName: "x.png",
        }),
      ),
      "FORBIDDEN",
    );
    for (let i = 1; i < MAX_IMAGES_PER_PRODUCT; i++)
      await t.app.products.addImage(o, product.id, {
        bytes: PNG,
        fileName: `p${i}.png`,
      });
    assert.equal(await add(PNG, "one-too-many.png"), "CONFLICT");
  } finally {
    await t.cleanup();
  }
});

test("orphaned files are found and cleaned up; referenced files are never touched", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const o = t.actors.OWNER;
    const img = await t.app.products.addImage(o, product.id, {
      bytes: PNG,
      fileName: "keep.png",
    });
    const orphan = await t.container.repos.files.put({
      bytes: PNG,
      originalName: "stray.png",
      mime: "image/png",
      kind: "PRODUCT_IMAGE",
    });
    const orphanPath = join(t.dir, "files", orphan.id.slice(0, 2), orphan.id);
    assert.equal(existsSync(orphanPath), true);
    assert.equal(await t.app.products.cleanupOrphanFiles(o), 1);
    assert.equal(existsSync(orphanPath), false);
    assert.notEqual(await t.container.repos.files.get(img.fileId), null);
    assert.equal(
      await code(t.app.products.cleanupOrphanFiles(t.actors.SALES)),
      "FORBIDDEN",
    );
  } finally {
    await t.cleanup();
  }
});

test("a tampered stored file fails its integrity check", async () => {
  const t = await makeApp();
  try {
    const { product } = await seedBasics(t);
    const img = await t.app.products.addImage(t.actors.OWNER, product.id, {
      bytes: PNG,
      fileName: "a.png",
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(t.dir, "files", img.fileId.slice(0, 2), img.fileId),
      new Uint8Array([1, 2, 3]),
    );
    await assert.rejects(t.container.repos.files.get(img.fileId), /integrity/);
  } finally {
    await t.cleanup();
  }
});
