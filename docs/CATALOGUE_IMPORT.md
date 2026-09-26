# Reference Catalogue — import

Three ways to put data in the Reference Catalogue, all through the same
validated, idempotent, provenance-keeping write path. None of them touch My
Products, prices or stock. **Nothing is ever fetched from the internet by the
application.**

| Provider                                            | Where                                                      | Network |
| --------------------------------------------------- | ---------------------------------------------------------- | ------- |
| CSV file                                            | Import → CSV import                                        | no      |
| Offline package (`.ifcatalog`, `.zip`, or a folder) | Import → Offline package, or `npm run catalogue:import`    | no      |
| Manual entry                                        | `POST /api/v1/catalogue/parts`                             | no      |
| Online providers (Toyota EPC, Nengun)               | **not shipped** — need the data owner's licence/permission | would   |

The provider registry (`src/server/providers/contracts.ts`) records this. A
future online provider must emit the same normalized rows and should also be
able to export an offline package, so the shop can work without it.

Permission: `catalogue.import` (Owner and Admin). Image-rights changes and
source management need `catalogue.admin` (Owner and Admin).

## CSV import (wizard)

1. **Choose a file.** UTF-8 CSV (a byte-order mark, quoted fields, commas and
   line breaks inside quotes are handled). Limits: 100 MB, 500,000 rows, 80
   columns, 8,192 characters per field. Binary files are refused.
2. **Detect and map.** The file's columns are matched to catalogue fields by
   name (e.g. `OEM No`, `part_number`, `Part Number` → `oem_number`); nothing
   depends on a fixed header set. You can override every mapping and set a
   default manufacturer, source name and market. Required: part number and
   manufacturer (or a default manufacturer). Fields: `oem_number`,
   `description`, `manufacturer`, `pnc`, `part_group`, `status`,
   `vehicle_make`, `vehicle`, `generation`, `chassis`, `frame`, `body`,
   `engine`, `transmission`, `production_from`, `production_to`, `market`,
   `category`, `catalogue`, `figures`, `callout`, `supersedes`,
   `superseded_by`, `price_usd`, `price_jpy`, `source`, `source_url`,
   `source_record_id`, `notes`.
3. **Confirm rights to use the data** (a required checkbox, recorded), then
   **validate and preview**. Every row is checked and classified:
   VALID (create or update), DUPLICATE (same key repeated in the file),
   INVALID (with the reason and line number), CONFLICT, and warnings (missing
   description, spreadsheet-formula-looking cells). The job page shows counts
   of rows detected / valid / invalid / duplicates / new / existing / updated /
   warnings / errors, and you can exclude individual rows.
4. **Import.** Rows are committed in chunks of 500, each chunk in its own
   transaction with a savepoint per row, so one bad row never blocks the rest.
   Small files finish within the request; large ones continue in the
   background while the page polls. An interrupted job can be **resumed**
   (remaining rows only) and a running job can be **cancelled** (rows already
   imported remain).
5. **Summary and history.** The job records status, counts, the mapping used,
   the file's SHA-256 and who ran it; Import → History lists every job.

Job statuses: `PENDING`, `REVIEW_REQUIRED`, `RUNNING`, `COMPLETED`,
`COMPLETED_WITH_WARNINGS`, `FAILED`, `CANCELLED`.

Importing the same file again is idempotent: rows are keyed on source + part
number + vehicle + market + production range + catalogue, so nothing is
duplicated and unchanged rows are reported as "already present".

`tests/fixtures/catalogue/intraforge_reference_catalogue_batch_001.csv`
("Batch 001") is used as a test fixture only. No column of it is hard-coded
anywhere in the importer.

## Offline package

A package is a folder or a single archive (`.ifcatalog` is a ZIP with a
different extension):

```
manifest.json
sources.csv  manufacturers.csv  vehicles.csv  catalogues.csv
parts.csv  fitments.csv  supersessions.csv  drawings.csv  drawing_parts.csv
images/diagrams/…   images/reference/…
```

`manifest.json`:

```json
{
  "package_format_version": 1,
  "package_id": "toyota-carina-eu-221230",
  "provider": "toyota-epc",
  "manufacturer": "Toyota",
  "market": "EU",
  "catalogue": "221230",
  "source": "Toyota parts catalogue",
  "created_at": "2026-09-20T00:00:00Z",
  "record_counts": {
    "parts": 3,
    "fitments": 2,
    "drawings": 1,
    "drawing_parts": 3,
    "supersessions": 1
  },
  "asset_counts": { "diagrams": 1 },
  "checksums": {
    "parts.csv": "<sha256>",
    "images/diagrams/MA4481A.png": "<sha256>"
  }
}
```

Tables and columns (all optional unless marked; `manufacturer` may be given
once in the manifest instead of per row):

| Table                                                                | Columns                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parts.csv`                                                          | **`oem_number`**, `manufacturer`, `description`, `pnc`, `part_group`, `status`, `source_record_id`, `source_url`, `price_usd`, `price_jpy`, `notes`                                                                                                 |
| `fitments.csv`                                                       | **`oem_number`**, **`model`** (or `vehicle`), `manufacturer`, `make`, `generation`, `chassis` (`;`-separated), `frame`, `body`, `engine`, `transmission`, `market`, `production_from`, `production_to`, `catalogue`, `section`, `position`, `notes` |
| `supersessions.csv`                                                  | **`oem_number`**, **`related_number`**, `manufacturer`, `relation` (SUPERSEDES, SUPERSEDED_BY, REPLACEMENT, INTERCHANGE, ALTERNATIVE, EQUIVALENT, CROSS_REFERENCE), `notes`                                                                         |
| `drawings.csv`                                                       | **`code`**, `title`, `catalogue`, `section`, `image_file`, `source_image_url`, `rights`                                                                                                                                                             |
| `drawing_parts.csv`                                                  | **`drawing`**, **`oem_number`**, `manufacturer`, `callout`, `x1 y1 x2 y2`, `space` (PIXEL or PERCENT), `quantity`, `sequence`                                                                                                                       |
| `sources.csv`, `manufacturers.csv`, `vehicles.csv`, `catalogues.csv` | reference tables for shared metadata                                                                                                                                                                                                                |

Validation before anything is written (Import → Offline package shows this as
a check report and `npm run catalogue:import` prints it):

- format version supported; manifest well formed; `package_id` restricted to
  letters, digits, dots, dashes and underscores;
- every listed file present and its **SHA-256 equal to the manifest**;
  `record_counts` and `asset_counts` equal to what is actually in the package;
- a package with no catalogue data at all is refused;
- row-level problems (missing part number, bad date, inverted hotspot,
  unknown relation, part missing from `parts.csv`…) are reported **with the
  file and line**, the bad rows are skipped, and the good rows import
  (status `COMPLETED_WITH_WARNINGS`);
- a manifest/checksum/structure failure rejects the **whole** package and
  imports nothing (a `FAILED` job records why).

Safe extraction: entry names are normalized and must stay inside the package
(no `..`, absolute paths, drive letters, backslash tricks, NUL bytes,
duplicate names); symbolic links are refused; ZIP64 and encryption are
refused; at most 200,000 entries, 256 MB per file, a compression ratio ≤ 250,
and every member's declared size and CRC-32 must match its bytes (so a zip
bomb or a tampered archive cannot be expanded). Nothing is ever extracted to
disk: entries are read in memory and stored through `FileStorage`.

After import the catalogue lives entirely inside the application's own
storage. **The USB stick, folder or archive can be removed** and search, part
pages, drawings and hotspots keep working (a test deletes the source and cuts
the network first).

### Drawings and image rights

Drawing **metadata and hotspots are data**, imported regardless. Image
**bytes** are stored only when the operator ticks "I confirm we are licensed to
store and display these images". Without it the drawing keeps its
`source_image_url` (shown as a link) and rights `EXTERNAL_REFERENCE`, the job
reports a warning, and the viewer shows the parts list without the picture.
A stored image is served only while its rights are one of
LICENSED_FOR_INTERNAL_USE, LICENSED_FOR_DISPLAY, COMPANY_OWNED or
MANUFACTURER_AUTHORIZED; setting `DO_NOT_REPUBLISH` (with at least a short
written evidence note) stops display at once. A stored image is never silently
replaced by a later import (the warning says so).

Images are validated by content, not extension: PNG, JPEG, GIF or WebP only (SVG is
refused because it can carry script), ≤ 64 MB, with dimensions read from the
header so hotspots in pixel space can be scaled.

For a folder of loose drawings named `<figure code>.png|jpg` (for example a
saved page's `_files` folder) use `PackageImportService.importDrawingImages`
(rights confirmation required; duplicate codes are ignored; non-images
counted as skipped).

## Manual entry

`POST /api/v1/catalogue/parts` with the same field names as the CSV fields
(`oem_number`, `manufacturer`, `description`, `vehicle`, `chassis`, …). It is
validated like a CSV row and stored with source "Manual entry",
verification UNVERIFIED.

## Governance

- **Sources** (`catalogue_sources`): provider key, name, licence status,
  redistribution status, image-usage status, priority (higher priority wins
  the displayed description), active flag.
- **Verification** per part: UNVERIFIED → SOURCE_VERIFIED / MANUALLY_VERIFIED /
  DISPUTED (Owner/Admin).
- Every import, cancellation, rights change and verification is written to
  the audit log.
- CSV formula injection: cells starting with `= + - @` (or tab/CR) are stored
  as plain text and prefixed with `'` on export.

## Command line

```
npm run catalogue:import -- <folder | file.ifcatalog | file.zip> [--images-licensed]
```

Runs as the first active Owner. Exit code 1 when the package is rejected.
