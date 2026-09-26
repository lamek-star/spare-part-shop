# Spare Parts

A standalone, offline-first application for a spare-parts shop: a **Reference
Catalogue** of manufacturer part numbers, fitment and drawings; **My
Products** with photos, stock, suppliers and pricing; inventory across
warehouses and racks; customers and suppliers; and the sales chain
**enquiry → quotation → order → invoice → payment**, with PDFs, barcode/QR
labels and reports. All data lives in one SQLite database and one folder on
your own server. No cloud service, no telemetry, no external requests.

It is designed so IntraForge can later provide identity, storage, audit and
settings behind stable interfaces. **No IntraForge integration exists in this
build.**

## Run it

Requires Node 24 or newer.

```
npm install
npm run build
npm start                    # http://127.0.0.1:3000
```

Open the address; the first screen creates your shop and the **Owner**
account. (Or: `SPAREPARTS_OWNER_PASSWORD=… npm run owner:create -- you@shop.example "Your Name"`.)
There are no default passwords and a new installation starts empty.

Development: `npm run dev`. To fill a development database with clearly
labelled sample data, start it with `SPAREPARTS_ENABLE_SAMPLE_DATA=1` and use
the button on the empty dashboard (ignored in production builds).

Data location: `SPAREPARTS_DATA_DIR` (default `./.data`). Back it up with
`npm run backup -- <empty folder>` (safe while running) and restore with
`npm run restore -- <folder>` into an empty data directory.

## Using it

1. **Administration → Users**: add staff with a role (Owner, Admin, Sales,
   Inventory, Viewer). **Shop settings**: shop name, tax, currency, terms.
2. **Catalogue → Import**: bring in a CSV or an offline catalogue package.
   Search it under **Reference Catalogue**; open a part for fitment,
   supersessions and drawings; click **IMPORT TO MY PRODUCTS** to create your
   own product (once) with your SKU, price and opening stock.
3. **Stock & Locations**: warehouses, racks, shelves, bins. Receive, adjust
   and transfer stock; every change is a permanent movement.
4. **Sales**: add parts to an **enquiry**, create a **quotation** (PDF), turn
   it into an **order** (stock is reserved), record the **delivery** (stock is
   deducted), **invoice** what was delivered (PDF) and record **payments**.
5. **Scan / Lookup**: scan a Code 128 or QR label, or type any part number.

## Documentation

- [Architecture and operations](docs/SPARE_PARTS_ARCHITECTURE.md)
- [Data model](docs/SPARE_PARTS_DATA_MODEL.md) · [generated schema](docs/generated/SCHEMA.md)
- [Roles and permissions](docs/SPARE_PARTS_PERMISSIONS.md) · [API routes](docs/generated/API_ROUTES.md)
- [Catalogue import](docs/CATALOGUE_IMPORT.md)
- [IntraForge integration contract](docs/INTRAFORGE_INTEGRATION_CONTRACT.md)
- [Qualification report](docs/SPARE_PARTS_QUALIFICATION.md)
- [IntraForge platform requirements](docs/INTRAFORGE_PLATFORM_REQUIREMENTS.md) (earlier planning note)

## Tests

```
npm test                 # server suites: real SQLite + real router (Node test runner)
npm run typecheck
npm run build
npm run test:e2e         # Playwright against a real dev server (needs Chrome)
npm run format:check
```
