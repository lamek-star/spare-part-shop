import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeApp, type TestApp } from "./helpers";
import { AppError } from "../../src/server/kernel/errors";
import { DirectorySource, PackageError, ZipSource, buildZip, safeEntryName, sha256 } from "../../src/server/catalogue/packageSource";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError ? e.code : `UNEXPECTED:${(e as Error).message}`;
  }
};
/** A tiny but real PNG header (800x600) — enough to be sniffed and measured. */
function png(seed = 0, w = 800, h = 600): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[24] = 8;
  b[30] = seed;
  return b;
}
type Files = Record<string, string | Uint8Array>;
const PARTS = [
  "oem_number,manufacturer,description,pnc,status,source_record_id,source_url,price_usd",
  "15600-25010,Toyota,Filter Sub-Assy Oil,15601,Ended,R-1,https://example.com/p/1,",
  "15621-41010,Toyota,Gasket Oil Filter Body,15621,Ended,R-2,,4.50",
  "90404-19003,Toyota,Union (for oil filter),15600A,Available,R-3,,",
].join("\n");
const FITMENTS = [
  "oem_number,manufacturer,make,model,chassis,market,production_from,production_to,engine,catalogue,section",
  "15600-25010,Toyota,Toyota,Carina,TA6#; CA60,EU,1981-08,1983-09,2T; 3T,221230,Engine oil filter",
  "15621-41010,Toyota,Toyota,Carina,CA60,EU,1981-08,1982-08,1C,221230,Engine oil filter",
].join("\n");
const DRAWINGS = ["code,title,catalogue,section,image_file,source_image_url,rights", "MA4481A,Oil filter,221230,Engine oil filter,images/diagrams/MA4481A.png,https://example.com/MA4481A.png,LICENSED_FOR_INTERNAL_USE"].join("\n");
const DRAWING_PARTS = [
  "drawing,oem_number,manufacturer,callout,x1,y1,x2,y2,space,quantity",
  "MA4481A,15600-25010,Toyota,15601,297,246,352,262,PIXEL,1",
  "MA4481A,15621-41010,Toyota,15621,226,272,290,290,PIXEL,",
  "MA4481A,90404-19003,Toyota,15600A,120,140,190,160,PIXEL,",
].join("\n");
const SUPERSESSIONS = ["oem_number,manufacturer,relation,related_number,notes", "15600-25010,Toyota,SUPERSEDED_BY,15600-25011,Replaced in 1983"].join("\n");

/** Builds a valid package's files, with a manifest carrying correct
 * checksums and counts unless overridden. */
function buildFiles(over: { manifest?: Record<string, unknown>; files?: Files; skipChecksums?: boolean } = {}): Files {
  const files: Files = {
    "parts.csv": PARTS,
    "fitments.csv": FITMENTS,
    "drawings.csv": DRAWINGS,
    "drawing_parts.csv": DRAWING_PARTS,
    "supersessions.csv": SUPERSESSIONS,
    "images/diagrams/MA4481A.png": png(1),
    ...over.files,
  };
  const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  const rowCount = (name: string) => (typeof files[name] === "string" ? (files[name] as string).split("\n").length - 1 : 0);
  const manifest = {
    package_format_version: 1,
    package_id: "Toyota-Carina-EU-221230",
    provider: "toyota-epc",
    manufacturer: "Toyota",
    market: "EU",
    catalogue: "221230",
    source: "Toyota parts catalogue",
    created_at: "2026-09-20T00:00:00Z",
    record_counts: { parts: rowCount("parts.csv"), fitments: rowCount("fitments.csv"), drawings: rowCount("drawings.csv"), drawing_parts: rowCount("drawing_parts.csv"), supersessions: rowCount("supersessions.csv") },
    asset_counts: { diagrams: 1 },
    checksums: over.skipChecksums ? undefined : Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(bytes(v))])),
    ...over.manifest,
  };
  return { "manifest.json": JSON.stringify(manifest, null, 2), ...files };
}
function writeDir(files: Files): string {
  const dir = mkdtempSync(join(tmpdir(), "sp-pkg-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const importFrom = (t: TestApp, files: Files, opts: { confirm?: boolean } = { confirm: true }) => {
  const dir = writeDir(files);
  return t.app.cataloguePackage.importPackage(t.actors.ADMIN, new DirectorySource(dir), { imagesLicenseConfirmed: opts.confirm }).finally(() => rmSync(dir, { recursive: true, force: true }));
};

test("a full package imports parts, fitments, supersessions, drawings, callouts and images with provenance", async () => {
  const t = await makeApp();
  try {
    const job = await importFrom(t, buildFiles());
    assert.equal(job.status, "COMPLETED", JSON.stringify(job.manifest));
    assert.equal(job.kind, "PACKAGE");
    const a = t.actors.ADMIN;
    const stats = await t.app.catalogue.stats(a);
    assert.deepEqual([stats.parts, stats.drawings, stats.drawingsWithImages, stats.callouts, stats.relations], [3, 1, 1, 3, 1]);

    const part = (await t.app.catalogue.partByOem(a, "15600-25010"))!;
    assert.equal(part.description, "Filter Sub-Assy Oil");
    assert.equal(part.pnc, "15601");
    assert.equal(part.statusClass, "ENDED");
    assert.deepEqual(part.fitments.map((f) => f.chassis).sort(), ["CA60", "TA6#"]);
    assert.deepEqual(part.fitments[0].engines, ["2T", "3T"]);
    assert.equal(part.fitments[0].section, "Engine oil filter");
    assert.equal(part.fitments[0].productionFrom, "1981-08");
    assert.equal(part.drawings[0].code, "MA4481A");
    assert.equal(part.drawings[0].callout, "15601");
    assert.equal(part.drawings[0].hasImage, true);
    assert.equal(part.relations[0].relation, "SUPERSEDED_BY");
    assert.equal(part.relations[0].relatedNumber, "15600-25011");
    assert.equal(part.sources[0].sourceKey, "toyota-epc");
    assert.equal(part.sources[0].externalId, "R-1");
    assert.equal(part.sources[0].importJobId, job.id);
    assert.equal(part.sources[0].sourceUrl, "https://example.com/p/1");
    assert.equal((await t.app.catalogue.partByOem(a, "15621-41010"))!.facts[0].priceUsdMinor, 450);

    const drawing = await t.app.catalogue.drawing(a, part.drawings[0].drawingId);
    assert.equal(drawing.imageAvailable, true);
    assert.equal(drawing.rights, "LICENSED_FOR_INTERNAL_USE");
    assert.deepEqual([drawing.width, drawing.height], [800, 600]);
    assert.deepEqual(drawing.callouts.find((c) => c.label === "15601")!.rect, { x1: 297, y1: 246, x2: 352, y2: 262 });
    assert.equal(drawing.callouts.length, 3);
    assert.equal(drawing.callouts[0].parts.length, 1);
    const bytes = await t.app.catalogue.assetBytes(a, drawing.assetId!);
    assert.equal(bytes!.mime, "image/png");
    assert.deepEqual([...bytes!.bytes], [...png(1)]);
    // selecting a part finds its drawing and vice versa
    assert.equal((await t.app.catalogue.search(a, { hasDrawing: true })).total, 3);
    assert.equal((await t.app.catalogue.search(a, { section: "oil filter" })).total, 3);
  } finally {
    await t.cleanup();
  }
});

test("without image-rights confirmation no image bytes are stored; metadata and hotspots still are", async () => {
  const t = await makeApp();
  try {
    const job = await importFrom(t, buildFiles(), { confirm: false });
    assert.equal(job.status, "COMPLETED_WITH_WARNINGS");
    assert.ok(job.manifest && JSON.stringify(job.manifest).includes("image was not stored"));
    const a = t.actors.ADMIN;
    const drawing = await t.app.catalogue.drawing(a, (await t.app.catalogue.partByOem(a, "15600-25010"))!.drawings[0].drawingId);
    assert.equal(drawing.imageAvailable, false);
    assert.equal(drawing.rights, "EXTERNAL_REFERENCE");
    assert.equal(drawing.sourceImageUrl, "https://example.com/MA4481A.png");
    assert.equal(drawing.callouts.length, 3, "hotspots are data, not licensed artwork");
    assert.equal(await t.app.catalogue.assetBytes(a, drawing.assetId!), null);
    assert.equal(await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM files WHERE kind = 'CATALOGUE_DRAWING'")), 0);
  } finally {
    await t.cleanup();
  }
});

test("a locally stored image is only served while its recorded rights allow display", async () => {
  const t = await makeApp();
  try {
    await importFrom(t, buildFiles());
    const a = t.actors.ADMIN;
    const drawing = await t.app.catalogue.drawing(a, (await t.app.catalogue.partByOem(a, "15600-25010"))!.drawings[0].drawingId);
    assert.notEqual(await t.app.catalogue.assetBytes(a, drawing.assetId!), null);
    assert.equal(await code(t.app.catalogue.setImageRights(a, drawing.assetId!, "DO_NOT_REPUBLISH", "short")), "VALIDATION", "evidence is required");
    await t.app.catalogue.setImageRights(a, drawing.assetId!, "DO_NOT_REPUBLISH", "Owner withdrew permission on 2026-09-21");
    assert.equal(await t.app.catalogue.assetBytes(a, drawing.assetId!), null, "withdrawn permission stops display immediately");
    assert.equal((await t.app.catalogue.drawing(a, drawing.id)).imageAvailable, false);
    assert.equal(await code(t.app.catalogue.setImageRights(t.actors.SALES, drawing.assetId!, "COMPANY_OWNED", "we own this drawing")), "FORBIDDEN");
    assert.equal(await code(t.app.catalogue.setImageRights(a, drawing.assetId!, "ANYTHING", "some evidence text")), "VALIDATION");
  } finally {
    await t.cleanup();
  }
});

test("importing the same package again is idempotent: nothing duplicated, images not stored twice", async () => {
  const t = await makeApp();
  try {
    await importFrom(t, buildFiles());
    const before = await t.app.catalogue.stats(t.actors.ADMIN);
    const filesBefore = await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM files"));
    const again = await importFrom(t, buildFiles());
    assert.equal(again.created, 0, JSON.stringify(again.manifest));
    assert.deepEqual(await t.app.catalogue.stats(t.actors.ADMIN), { ...before, importJobs: before.importJobs + 1 });
    assert.equal(await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM files")), filesBefore);
    assert.equal(await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM part_facts")), 3);
  } finally {
    await t.cleanup();
  }
});

test("after import the catalogue no longer depends on the source folder, and needs no network", async () => {
  const t = await makeApp();
  const realFetch = globalThis.fetch;
  try {
    const dir = writeDir(buildFiles());
    await t.app.cataloguePackage.importPackage(t.actors.ADMIN, new DirectorySource(dir), { imagesLicenseConfirmed: true });
    rmSync(dir, { recursive: true, force: true }); // "eject the USB stick"
    globalThis.fetch = (() => {
      throw new Error("network access attempted during offline operation");
    }) as typeof fetch;
    const a = t.actors.VIEWER;
    const hit = await t.app.catalogue.search(a, { q: "15600 25010" });
    assert.equal(hit.items[0].oemNumber, "15600-25010");
    const part = await t.app.catalogue.part(a, hit.items[0].id);
    const drawing = await t.app.catalogue.drawing(a, part.drawings[0].drawingId);
    assert.equal(drawing.imageAvailable, true);
    assert.equal((await t.app.catalogue.assetBytes(a, drawing.assetId!))!.bytes.length, 40);
    assert.equal((await t.app.catalogue.browse(a, { manufacturer: "Toyota" })).models[0].name, "Carina");
  } finally {
    globalThis.fetch = realFetch;
    await t.cleanup();
  }
});

test("an archive (.ifcatalog / zip) imports exactly like a folder, compressed or not", async () => {
  for (const deflate of [false, true]) {
    const t = await makeApp();
    try {
      const zip = buildZip(buildFiles() as Record<string, Uint8Array | string>, { deflate });
      const source = new ZipSource(zip);
      assert.equal(source.kind, "archive");
      const report = await t.app.cataloguePackage.preview(t.actors.ADMIN, source);
      assert.equal(report.ok, true, JSON.stringify(report.issues));
      assert.deepEqual(report.assets, { declared: 1, found: 1, storable: 1 });
      const job = await t.app.cataloguePackage.importPackage(t.actors.ADMIN, source, { imagesLicenseConfirmed: true });
      assert.equal(job.status, "COMPLETED");
      assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 3);
      assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).drawingsWithImages, 1);
    } finally {
      await t.cleanup();
    }
  }
});

test("preview reports what a package holds and writes nothing", async () => {
  const t = await makeApp();
  try {
    const dir = writeDir(buildFiles());
    const report = await t.app.cataloguePackage.preview(t.actors.ADMIN, new DirectorySource(dir));
    rmSync(dir, { recursive: true, force: true });
    assert.equal(report.ok, true);
    assert.deepEqual(report.tables.parts, { rows: 3, valid: 3, invalid: 0 });
    assert.equal(report.manifest!.package_id, "Toyota-Carina-EU-221230");
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 0);
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).importJobs, 0);
  } finally {
    await t.cleanup();
  }
});

test("a corrupt, incomplete or unsupported package is rejected as a whole and imports nothing", async () => {
  const t = await makeApp();
  try {
    const rejected = async (files: Files, expect: RegExp) => {
      const job = await importFrom(t, files);
      assert.equal(job.status, "FAILED", expect.source);
      assert.match(job.message + JSON.stringify(job.manifest), expect);
      assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 0, "nothing imported from a rejected package");
    };
    const good = buildFiles();
    // a changed file no longer matches its recorded checksum
    await rejected({ ...good, "parts.csv": PARTS.replace("Filter Sub-Assy Oil", "Tampered") }, /Checksum mismatch/);
    // record counts say more rows than the file has
    await rejected(buildFiles({ manifest: { record_counts: { parts: 99 } } }), /declares 99/);
    // a listed file is missing
    const missing = buildFiles();
    delete missing["fitments.csv"];
    await rejected(missing, /missing from the package/);
    // a manifest from a newer format
    await rejected(buildFiles({ manifest: { package_format_version: 7 } }), /format version 7/);
    // no manifest / bad JSON / missing identity
    const noManifest = buildFiles();
    delete noManifest["manifest.json"];
    await rejected(noManifest, /no manifest\.json/);
    await rejected({ ...buildFiles(), "manifest.json": "{not json" }, /not valid JSON/);
    await rejected(buildFiles({ manifest: { package_id: "", provider: undefined } }), /package_id is required/);
    await rejected(buildFiles({ manifest: { package_id: "../evil" } }), /package_id may only use/);
    // an image the manifest counts but the drawings do not reference
    await rejected(buildFiles({ manifest: { asset_counts: { diagrams: 4 } } }), /declares 4 diagram/);
    // completely empty package
    await rejected({ "manifest.json": JSON.stringify({ package_format_version: 1, package_id: "empty", provider: "x" }) }, /contains no catalogue data/);
    const audit = await t.app.audit.query(t.actors.OWNER, { entityType: "import_job" });
    assert.ok(audit.every((e) => e.action === "catalogue.package.reject"));
  } finally {
    await t.cleanup();
  }
});

test("bad rows are skipped and listed with their line; good rows still import", async () => {
  const t = await makeApp();
  try {
    const files = buildFiles({
      skipChecksums: true,
      manifest: { record_counts: undefined },
      files: {
        "parts.csv": PARTS + "\n,Toyota,No number,,,,,\nBAD-PRICE,Toyota,x,,,,,12.345",
        "fitments.csv": FITMENTS + "\nNOT-IN-PARTS,Toyota,Toyota,Carina,CA60,EU,1981,1983,,221230,x\n15600-25010,Toyota,Toyota,Carina,CA60,EU,1990-13,,,221230,x",
        "drawing_parts.csv": DRAWING_PARTS + "\nMA4481A,15600-25010,Toyota,X,10,10,5,5,PIXEL,\nMA4481A,15600-25010,Toyota,Y,10,,,,PIXEL,",
      },
    });
    const job = await importFrom(t, files);
    assert.equal(job.status, "COMPLETED_WITH_WARNINGS");
    const issues = ((job.manifest as { issues: { level: string; where: string; message: string }[] }).issues).filter((i) => i.level === "error");
    const byWhere = Object.fromEntries(issues.map((i) => [i.where, i.message]));
    assert.match(byWhere["parts.csv line 5"], /oem_number is required/);
    assert.match(byWhere["parts.csv line 6"], /price_usd/);
    assert.match(byWhere["fitments.csv line 4"], /not in parts\.csv/);
    assert.match(byWhere["fitments.csv line 5"], /production_from is not a valid date|not a valid date/);
    assert.match(byWhere["drawing_parts.csv line 5"], /inverted/);
    assert.match(byWhere["drawing_parts.csv line 6"], /all of x1, y1, x2 and y2/);
    assert.equal((await t.app.catalogue.stats(t.actors.ADMIN)).parts, 3, "the three good parts imported");
  } finally {
    await t.cleanup();
  }
});

test("hostile paths in a package cannot escape it or overwrite anything", async () => {
  for (const name of ["../evil.csv", "/etc/passwd", "C:/Windows/x.csv", "a/../../b.csv", "..\\x.csv", "x\0y.csv"])
    assert.throws(() => safeEntryName(name), PackageError, name);
  assert.equal(safeEntryName("images\\diagrams\\a.png"), "images/diagrams/a.png");
  assert.equal(safeEntryName("./parts.csv"), "parts.csv");
  assert.throws(() => new ZipSource(buildZip({ "../evil.csv": "x" })), /leave the package/);
  assert.throws(() => new ZipSource(buildZip({ "/abs.csv": "x" })), /absolute/);
  assert.throws(() => new ZipSource(buildZip({ "link.csv": "x" }, { symlink: ["link.csv"] })), /symbolic link/);
  assert.throws(() => new ZipSource(new Uint8Array(200)), PackageError);
  assert.throws(() => new ZipSource(new Uint8Array(5)), PackageError);
  // two entries that normalize to the same name would let one overwrite the other
  const dup = buildZip({ "a.csv": "1", "./a.csv": "2" });
  assert.throws(() => new ZipSource(dup), /twice/);
});

test("decompression bombs and tampered archives are refused", () => {
  const bomb = buildZip({ "big.csv": new Uint8Array(10 * 1024 * 1024) }, { deflate: true });
  assert.throws(() => new ZipSource(bomb), /compression ratio/);
  const ok = buildZip({ "a.csv": "hello world hello world" });
  const tampered = new Uint8Array(ok);
  const at = new TextDecoder().decode(tampered).indexOf("hello");
  tampered[at] = 0x48; // change a byte of the stored data, leaving its CRC as it was
  assert.throws(() => new ZipSource(tampered).read("a.csv"), /integrity check/);
  const src = new ZipSource(ok);
  assert.equal(new TextDecoder().decode(src.read("a.csv")), "hello world hello world");
  assert.throws(() => src.read("nope.csv"), /not in the package/);
});

test("an image path inside drawings.csv cannot point outside the package", async () => {
  const t = await makeApp();
  try {
    const job = await importFrom(
      t,
      buildFiles({ skipChecksums: true, manifest: { record_counts: undefined, asset_counts: undefined }, files: { "drawings.csv": "code,image_file\nMA1,../../secret.png\nMA2,/etc/passwd\nMA3,images/diagrams/missing.png" } }),
    );
    const errors = (job.manifest as { issues: { where: string; message: string }[] }).issues.map((i) => i.message).join(" | ");
    assert.match(errors, /not a safe image path/);
    assert.match(errors, /not in the package/);
    assert.equal(await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM files")), 0);
  } finally {
    await t.cleanup();
  }
});

test("symbolic links inside a package folder are refused", async () => {
  const t = await makeApp();
  const dir = writeDir(buildFiles());
  try {
    let linked = true;
    try {
      symlinkSync(join(dir, "parts.csv"), join(dir, "sneaky.csv"));
    } catch {
      linked = false; // the platform does not allow creating links here
    }
    if (linked) assert.throws(() => new DirectorySource(dir), /symbolic link/);
    assert.throws(() => new DirectorySource(join(dir, "does-not-exist")), /does not exist/);
    assert.throws(() => new DirectorySource(join(dir, "parts.csv")), /not a folder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.cleanup();
  }
});

test("a folder of loose drawings (<figure key>.png) is attached once, only after the rights are confirmed", async () => {
  const t = await makeApp();
  const dir = writeDir({ "pageA_files/MA4481A.png": png(1), "pageA_files/MA5713A.png": png(2, 640, 480), "pageB_files/MA4481A.png": png(1), "pageB_files/app.css": "body{}", "pageB_files/x.download": "junk", "pageB_files/FAKE.png": "not really a png" });
  try {
    const src = () => new DirectorySource(dir);
    assert.equal(await code(t.app.cataloguePackage.importDrawingImages(t.actors.ADMIN, src(), { provider: "toyota-epc", rightsConfirmed: false })), "VALIDATION");
    assert.equal(await code(t.app.cataloguePackage.importDrawingImages(t.actors.SALES, src(), { provider: "toyota-epc", rightsConfirmed: true })), "FORBIDDEN");
    assert.equal(await code(t.app.cataloguePackage.importDrawingImages(t.actors.ADMIN, src(), { provider: "Bad Key!", rightsConfirmed: true })), "VALIDATION");
    const job = await t.app.cataloguePackage.importDrawingImages(t.actors.ADMIN, src(), { provider: "toyota-epc", rightsConfirmed: true, label: "Carina pages" });
    assert.equal(job.status, "COMPLETED_WITH_WARNINGS");
    assert.equal(job.created, 2);
    assert.equal(job.skipped, 1, "the fake PNG");
    const stats = await t.app.catalogue.stats(t.actors.ADMIN);
    assert.deepEqual([stats.drawings, stats.drawingsWithImages], [2, 2]);
    const again = await t.app.cataloguePackage.importDrawingImages(t.actors.ADMIN, src(), { provider: "toyota-epc", rightsConfirmed: true });
    assert.equal(again.created, 0);
    assert.equal(again.unchanged, 2);
    assert.equal(await t.container.db.read((h) => h.count("SELECT COUNT(*) AS n FROM files WHERE kind = 'CATALOGUE_DRAWING'")), 2);
    // a later part import finds the drawing already in place and just links to it
    await importFrom(t, buildFiles({ files: { "images/diagrams/MA4481A.png": png(9) } }));
    const drawing = await t.app.catalogue.drawing(t.actors.ADMIN, (await t.app.catalogue.partByOem(t.actors.ADMIN, "15600-25010"))!.drawings[0].drawingId);
    assert.deepEqual([...(await t.app.catalogue.assetBytes(t.actors.ADMIN, drawing.assetId!))!.bytes], [...png(1)], "the stored image is never silently replaced");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.cleanup();
  }
});

test("package import is permission controlled", async () => {
  const t = await makeApp();
  try {
    const dir = writeDir(buildFiles());
    for (const role of ["SALES", "INVENTORY", "VIEWER"] as const) {
      assert.equal(await code(t.app.cataloguePackage.preview(t.actors[role], new DirectorySource(dir))), "FORBIDDEN", role);
      assert.equal(await code(t.app.cataloguePackage.importPackage(t.actors[role], new DirectorySource(dir), {})), "FORBIDDEN", role);
    }
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await t.cleanup();
  }
});
