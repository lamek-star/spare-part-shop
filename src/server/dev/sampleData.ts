import { crc32, deflateSync } from "node:zlib";
import type { App } from "../domain/app";
import type { Actor } from "../domain/types";
import { buildZip, sha256, ZipSource } from "../catalogue/packageSource";

/**
 * Development-only sample data, loaded on request by an Owner/Admin (never
 * automatically, never in production). It goes through the same services as
 * real data so it exercises real code paths, and every record is plainly
 * marked "Sample". Production databases start empty.
 */
export const SAMPLE_TAG = "Sample";

function png(width: number, height: number, draw: (x: number, y: number) => number): Uint8Array {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = draw(x, y);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
/** A schematic "filter cutaway": outlines of a few shapes, clearly not a real drawing. */
function schematic(): { bytes: Uint8Array; rects: Record<string, [number, number, number, number]> } {
  const rects: Record<string, [number, number, number, number]> = { "1": [120, 90, 260, 200], "2": [300, 240, 420, 330], "3": [500, 110, 640, 180] };
  const bytes = png(800, 500, (x, y) => {
    for (const [x1, y1, x2, y2] of Object.values(rects)) {
      const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2;
      const edge = inside && (x - x1 < 3 || x2 - x < 3 || y - y1 < 3 || y2 - y < 3);
      if (edge) return 40;
      if (inside) return 225;
    }
    return 255;
  });
  return { bytes, rects };
}

const PARTS: [string, string, string, string, string][] = [
  // oem, manufacturer, description, pnc, status
  ["90915-10009", "Toyota", "Element Sub-Assy, Oil Filter", "15601", "Active"],
  ["04152-YZZA1", "Toyota", "Filter Kit, Oil, Cartridge Type", "15601", "Active"],
  ["15690-65010", "Toyota", "Valve Sub-Assy, Oil Filter Bypass", "15690", "Ended"],
  ["17801-0H010", "Toyota", "Element Sub-Assy, Air Cleaner Filter", "17801", "Active"],
  ["90980-01415", "Toyota", "Pad Kit, Disc Brake, Front", "04465", "Active"],
  ["11110-36F00", "Nissan", "Oil Pan Assembly", "11110", "Discontinued"],
];

export interface SampleReport {
  warehouses: number;
  suppliers: number;
  customers: number;
  products: number;
  referenceParts: number;
  skipped: string[];
}

export async function loadSampleData(app: App, actor: Actor): Promise<SampleReport> {
  const skipped: string[] = [];
  const existing = await app.products.list(actor, { q: SAMPLE_TAG, pageSize: 1 });
  if (existing.total > 0) return { warehouses: 0, suppliers: 0, customers: 0, products: 0, referenceParts: 0, skipped: ["Sample data is already loaded."] };

  const main = await app.masterData.createWarehouse(actor, { name: `${SAMPLE_TAG} main warehouse` });
  const yard = await app.masterData.createWarehouse(actor, { name: `${SAMPLE_TAG} showroom` });
  const { locations } = await app.masterData.listWarehouses(actor);
  const locOf = (warehouseId: string) => locations.find((l) => l.warehouseId === warehouseId)!;
  const rackA = await app.masterData.createLocation(actor, main.id, { rack: "A", shelf: "1", bin: "01" });
  const rackB = await app.masterData.createLocation(actor, main.id, { rack: "B", shelf: "2", bin: "04" });

  const suppliers = [];
  for (const [name, terms] of [["Sample Parts Depot", "Net 30"], ["Sample Gulf Trading", "Net 15"], ["Sample Direct Imports", "Prepaid"]] as const)
    suppliers.push(await app.masterData.createSupplier(actor, { name, paymentTerms: terms, country: "UAE", email: `${name.split(" ").pop()!.toLowerCase()}@sample.invalid` }));
  const customers = [];
  for (const [name, email] of [["Sample Al Quoz Garage", "garage@sample.invalid"], ["Sample City Motors", "city@sample.invalid"], ["Sample Fleet Services", "fleet@sample.invalid"]] as const)
    customers.push(await app.masterData.createCustomer(actor, { name, email, country: "UAE", paymentTerms: "Net 30" }));

  const catalogue = sampleCatalogue();
  const job = await app.cataloguePackage.importPackage(actor, catalogue, { imagesLicenseConfirmed: true, label: "Sample catalogue" });
  if (job.status === "FAILED") skipped.push(`Sample catalogue: ${job.message}`);

  const products: [string, string, string, number, number, number, string | null][] = [
    // sku, name, brand, price, cost, qty, oem
    ["SMP-OIL-001", "Oil filter element", "Toyota", 4500, 2600, 40, "90915-10009"],
    ["SMP-OIL-002", "Oil filter kit, cartridge", "Toyota", 6200, 3900, 18, "04152-YZZA1"],
    ["SMP-AIR-001", "Air filter element", "Toyota", 5800, 3100, 12, "17801-0H010"],
    ["SMP-BRK-001", "Front brake pad kit", "Toyota", 21500, 12800, 6, "90980-01415"],
    ["SMP-SPK-001", "Spark plug (iridium)", "NGK", 3200, 1500, 60, null],
    ["SMP-WPR-001", "Wiper blade 24in", "Bosch", 3900, 1900, 25, null],
    ["SMP-BAT-001", "Battery 70Ah", "Varta", 41000, 28000, 3, null],
    ["SMP-LMP-001", "Headlight bulb H7", "Osram", 2500, 1100, 2, null],
  ];
  let made = 0;
  for (const [i, [sku, name, brand, priceMinor, costMinor, quantity, oem]] of products.entries()) {
    try {
      const target = i % 3 === 1 ? rackB : i % 3 === 2 ? locOf(yard.id) : rackA;
      const created = await app.products.create(actor, { sku, name: `${name} (${SAMPLE_TAG})`, brand, category: "Sample", priceMinor, costMinor, reorderLevel: 5, defaultSupplierId: suppliers[i % suppliers.length].id, openingStock: { locationId: target.id, quantity } });
      if (oem) await app.products.addNumber(actor, created.id, { display: oem, type: "OEM", brand });
      made++;
    } catch (e) {
      skipped.push(`${sku}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { warehouses: 2, suppliers: suppliers.length, customers: customers.length, products: made, referenceParts: PARTS.length, skipped };
}

/** Builds the sample reference catalogue as an in-memory offline package. */
export function sampleCatalogue(): ZipSource {
  const { bytes, rects } = schematic();
  const parts = ["oem_number,manufacturer,description,pnc,status,source_record_id", ...PARTS.map((p) => `${p[0]},${p[1]},"${p[2]}",${p[3]},${p[4]},SMP-${p[0]}`)].join("\n");
  const fitments = [
    "oem_number,manufacturer,make,model,chassis,market,production_from,production_to,engine,catalogue,section",
    "90915-10009,Toyota,Toyota,Corolla,ZZE122,EU,2000-11,2007-10,1ZZ-FE,SMP-EN,Engine oil filter",
    "04152-YZZA1,Toyota,Toyota,Corolla,ZZE122,EU,2000-11,2007-10,1ZZ-FE,SMP-EN,Engine oil filter",
    "15690-65010,Toyota,Toyota,Land Cruiser,FZJ80,GCC,1990-01,1997-12,1FZ-FE,SMP-EN,Engine oil filter",
    "17801-0H010,Toyota,Toyota,Camry,ACV40,GCC,2006-01,2011-12,2AZ-FE,SMP-EN,Air cleaner",
    "90980-01415,Toyota,Toyota,Corolla,ZZE122,EU,2000-11,2007-10,1ZZ-FE,SMP-BR,Front brake",
  ].join("\n");
  const drawings = ["code,title,catalogue,section,image_file,rights", "SMP-FIG-1,Oil filter (sample schematic),SMP-EN,Engine oil filter,images/diagrams/SMP-FIG-1.png,COMPANY_OWNED"].join("\n");
  const drawingParts = [
    "drawing,oem_number,manufacturer,callout,x1,y1,x2,y2,space,quantity",
    `SMP-FIG-1,90915-10009,Toyota,1,${rects["1"].join(",")},PIXEL,1`,
    `SMP-FIG-1,04152-YZZA1,Toyota,2,${rects["2"].join(",")},PIXEL,1`,
    `SMP-FIG-1,15690-65010,Toyota,3,${rects["3"].join(",")},PIXEL,1`,
  ].join("\n");
  const supersessions = ["oem_number,manufacturer,relation,related_number", "15690-65010,Toyota,SUPERSEDED_BY,15690-65011"].join("\n");
  const files: Record<string, string | Uint8Array> = { "parts.csv": parts, "fitments.csv": fitments, "drawings.csv": drawings, "drawing_parts.csv": drawingParts, "supersessions.csv": supersessions, "images/diagrams/SMP-FIG-1.png": bytes };
  const enc = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  const manifest = {
    package_format_version: 1,
    package_id: "sample-catalogue",
    provider: "sample",
    source: "Sample data generated by the application",
    manufacturer: "Toyota",
    created_at: "2026-01-01T00:00:00Z",
    checksums: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(enc(v))])),
  };
  return new ZipSource(buildZip({ "manifest.json": JSON.stringify(manifest), ...files }));
}
