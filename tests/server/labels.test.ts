import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import {
  PATTERNS,
  code128Svg,
  code128Values,
  code128Widths,
} from "../../src/server/labels/code128";
import { qrMatrix, qrSvg, MAX_QR_BYTES } from "../../src/server/labels/qr";
import { labelSvg } from "../../src/server/labels/label";
import { makeHttpApp } from "./http-helpers";

test("Code 128: the pattern table is well formed and encoding follows the standard", () => {
  assert.equal(PATTERNS.length, 107);
  assert.equal(new Set(PATTERNS).size, 107, "all patterns distinct");
  PATTERNS.forEach((p, i) =>
    assert.equal(
      [...p].reduce((n, c) => n + Number(c), 0),
      i === 106 ? 13 : 11,
      `pattern ${i}`,
    ),
  );
  // the checksum example from the Code 128 specification: "PJJ123C" (subset B) has check value 55
  assert.deepEqual(
    code128Values("PJJ123C"),
    [104, 48, 42, 42, 17, 18, 19, 35, 55, 106],
  );
  const widths = code128Widths("OIL-001");
  assert.equal(
    widths.reduce((a, b) => a + b, 0),
    11 * 9 + 13,
    "start + 7 chars + check = 9 symbols of 11 modules, plus the 13-module stop",
  );
  assert.throws(() => code128Values(""), /1 to 80/);
  assert.throws(() => code128Values("tab\there"), /printable/);
  assert.throws(() => code128Values("naïve"), /printable/);
  const svg = code128Svg('A"<b>&');
  assert.ok(
    !svg.includes("<b>") && !svg.includes('A"<'),
    "caption text is escaped",
  );
  assert.match(svg, /^<svg /);
});

test("QR encoder produces exactly the same symbols as an independent implementation", () => {
  const samples = [
    "A",
    "OIL-001",
    "https://shop.example/scan?code=15690-65010",
    "0123456789".repeat(3),
    "The quick brown fox jumps over the lazy dog".repeat(2),
    "x".repeat(120),
    "y".repeat(MAX_QR_BYTES),
    "Ünïcödé — 日本語",
  ];
  for (const text of samples) {
    const mine = qrMatrix(text);
    const ref = QRCode.create(
      [{ data: text, mode: "byte" }] as never,
      { errorCorrectionLevel: "M" } as never,
    ) as unknown as {
      modules: { size: number; get(r: number, c: number): number };
      version: number;
    };
    assert.equal(
      mine.length,
      ref.modules.size,
      `size for ${text.slice(0, 20)}`,
    );
    let diff = 0;
    for (let y = 0; y < mine.length; y++)
      for (let x = 0; x < mine.length; x++)
        if (mine[y][x] !== (ref.modules.get(y, x) === 1)) diff++;
    assert.equal(
      diff,
      0,
      `${diff} modules differ for "${text.slice(0, 24)}" (version ${ref.version})`,
    );
  }
  assert.throws(() => qrMatrix("z".repeat(MAX_QR_BYTES + 1)), /Too long/);
  assert.throws(() => qrMatrix(""), /needs some text/);
  assert.match(qrSvg("OIL-001", { caption: "OIL-<001>" }), /OIL-&#60;001&#62;/);
});

test("labels are served for products the caller may read, and the scanned code resolves back to the product", async () => {
  const t = await makeHttpApp();
  try {
    const inv = await t.as("INVENTORY");
    const p = (
      await inv.post("/products", {
        sku: "OIL-001",
        name: "Oil filter",
        priceMinor: 1000,
      })
    ).data;
    await inv.post(`/products/${p.id}/numbers`, {
      display: "15690-65010",
      type: "OEM",
    });
    const viewer = await t.as("VIEWER");
    for (const kind of ["code128", "qr"]) {
      const r = await viewer.get(`/products/${p.id}/label.svg?type=${kind}`);
      assert.equal(r.status, 200, kind);
      assert.match(r.headers.get("content-type")!, /image\/svg\+xml/);
      assert.match(new TextDecoder().decode(r.raw), /^<svg /);
    }
    assert.equal(
      (await viewer.get(`/products/${p.id}/label.svg?type=nope`)).status,
      400,
    );
    assert.equal(
      (await t.client().get(`/products/${p.id}/label.svg`)).status,
      401,
    );
    assert.equal((await viewer.get("/products/missing/label.svg")).status, 404);
    // what a scanner "types": the SKU (or any registered number) with stray whitespace
    for (const scanned of [
      "OIL-001",
      "  oil-001\n",
      "15690-65010",
      "1569065010",
    ]) {
      const found = await viewer.get(
        `/products/lookup?code=${encodeURIComponent(scanned)}`,
      );
      assert.equal(found.data?.product.id, p.id, JSON.stringify(scanned));
    }
    assert.equal(
      (await viewer.get("/products/lookup?code=UNKNOWN-1")).status,
      404,
    );
  } finally {
    await t.cleanup();
  }
});

test("the whole label: the shop's name, the product, the captioned number, the price, at label-printer or A4-sheet size", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    await owner.put("/settings", { shopName: "Lamek <Spare> & Parts" });
    const inv = await t.as("INVENTORY");
    const p = (
      await inv.post("/products", {
        sku: "BRK-2207",
        name: "Front brake pads for Toyota Corolla 2014 to 2019 models",
        brand: "Brembo",
        category: "Brakes",
        priceMinor: 12550,
      })
    ).data;
    // A viewer may print the label without being allowed to read the rest of the shop's settings.
    const viewer = await t.as("VIEWER");
    const printer = await viewer.get(
      `/products/${p.id}/label.svg?type=code128&size=printer&price=1`,
    );
    assert.equal(printer.status, 200);
    const svg = new TextDecoder().decode(printer.raw);
    assert.match(svg, /viewBox="0 0 50 30"/);
    assert.match(svg, /LAMEK &#60;SPARE&#62; &#38; PARTS/); // escaped, upper case
    assert.match(svg, /Part No\. BRK-2207/);
    assert.match(svg, /Brembo · Brakes/);
    assert.match(svg, /AED 125\.50/);
    assert.match(
      svg,
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+"\/>/,
    ); // barcode bars
    assert.ok(!svg.includes("<script"));
    const sheet = new TextDecoder().decode(
      (await viewer.get(`/products/${p.id}/label.svg?type=qr&size=sheet`)).raw,
    );
    assert.match(sheet, /viewBox="0 0 70 37"/);
    assert.match(sheet, /<path d="M/); // the QR code
    assert.ok(!sheet.includes("AED"), "no price unless asked");
    assert.equal(
      (await viewer.get(`/products/${p.id}/label.svg?size=huge`)).status,
      400,
    );
  } finally {
    await t.cleanup();
  }
});

test("a pharmacy label says Item No. and marks a prescription medicine Rx", () => {
  const svg = labelSvg(
    {
      shop: "Lamek Pharmacy",
      name: "Amoxicillin 500 mg capsules",
      details: ["Amoxicillin 500 mg capsule", "Pack of 21"],
      number: "MED-0042",
      numberCaption: "Item No.",
      flag: "Rx",
    },
    "printer",
    "code128",
  );
  assert.match(svg, />Rx</);
  assert.match(svg, /Item No\. MED-0042/);
  assert.match(svg, /LAMEK PHARMACY/);
});
