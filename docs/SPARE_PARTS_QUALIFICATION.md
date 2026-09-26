# Spare Parts Final Qualification Report

Date: 2026-09-26 · Repository: `C:\Users\Hp\Documents\intraforge-spareparts-demo`
· Branch: `codex/spareparts-reference` · Scope: Spare Parts only.

## 1. Executive summary

The prototype (browser-only data, persona "login", demo adapter) has been
replaced by a standalone, offline-first application: a Next.js 16 UI over a
versioned HTTP API, domain services with server-side permission checks, and
SQLite persistence behind provider interfaces that IntraForge can later
replace. It covers the Reference Catalogue (CSV wizard, offline packages,
manual entry, search, part pages, drawing viewer with hotspots, image-rights
gating), My Products (photos, fitment, stock, supplier, OEM reference, sales,
history), inventory with a movement ledger and reservations, customers and
suppliers, enquiry → quotation → order → invoice → payment with PDFs,
purchasing, barcode/QR labels, reports, users, settings, audit, backup/restore.

Evidence: 135/135 server tests, 10/10 Playwright browser tests, strict type
check, production build with no warnings, Prettier check, `npm audit` clean.

**Final status: PARTIAL** — see section 18 for exactly what keeps it from PASS.

## 2. Repository and baseline

| Item                          | Value                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                        | `codex/spareparts-reference` (not pushed, not merged, not rebased)                                                                                         |
| Starting commit               | `c41cc75` feat: complete the gated Toyota catalogue import mechanism                                                                                       |
| Pre-existing uncommitted work | Committed unchanged as a checkpoint: `7099192`                                                                                                             |
| Commits in this phase         | `b10932e`, `66b4013`, `9402907`, `73a3aa6`, `56c6167`, `3e46733`, `dcfa62e`, `2a333f8`, `57bf5ce`, `7e57ce4`, `467ce0c`, and the commit adding this report |
| Working tree at the end       | only `next-env.d.ts` modified (rewritten by `next dev`; left as found)                                                                                     |
| Not committed                 | `.env.local`, `.dev-certs/`, `.data*/`, `test-results/` — all git-ignored; no secrets are tracked                                                          |
| IntraForge repo               | Not modified by this phase. Its 9 uncommitted files date from 11:50–13:00, before this phase's first commit (16:28)                                        |

## 3. Architecture

Browser → `/api/v1` (cookie session + CSRF) → `src/server/http` → domain
services (`src/server/domain`, `src/server/catalogue`) → provider interfaces
(`src/server/providers`) → standalone SQLite/disk implementations
(`src/server/standalone`). One serialized SQLite connection (WAL,
`synchronous=FULL`, foreign keys, CHECK constraints, immutability triggers).
Integer minor-unit money. Details:
[SPARE_PARTS_ARCHITECTURE.md](SPARE_PARTS_ARCHITECTURE.md),
[SPARE_PARTS_DATA_MODEL.md](SPARE_PARTS_DATA_MODEL.md).

Providers: IdentityProvider, ProductRepository, InventoryRepository,
WarehouseRepository, CustomerRepository, SupplierRepository,
EnquiryRepository, QuotationRepository, OrderRepository, InvoiceRepository,
PaymentRepository, CatalogueStorageProvider, CatalogueProvider (registry),
FileStorage, AuditProvider, ConfigurationProvider, UnitOfWork
(`providers/core.ts`, `data.ts`, `sales.ts`, `catalogue.ts`, `contracts.ts`).

## 4. Reference Catalogue

Normalized: manufacturer → model → vehicle, catalogue → section, drawing →
callout → part, fitments with engines, supersessions/relations, per-source
facts and source records. FTS5 search accepts any number format and ranks
exact/prefix number matches first; filters for manufacturer, model, chassis,
engine, market, status, "on a drawing". Part page: My Products status
(**✓ In My Products · SKU · available · VIEW MY PRODUCT**, or **IMPORT TO MY
PRODUCTS**, duplicate import refused with `ALREADY_IMPORTED`), fitment table,
supersessions, drawings, provenance, verification. Drawing viewer: image with
PIXEL/PERCENT hotspots, every part line grouped by callout, filter, add to
enquiry. Reference records never carry shop price, cost or stock.

## 5. Catalogue import

- **CSV**: detect → map (alias-based, overridable, defaults) → rights
  attestation → validate and classify every row (valid/invalid/duplicate/
  conflict, warnings, line numbers) → review/exclude → chunked commit with
  per-row savepoints → summary and history. UTF-8/BOM/quoted fields; binary
  refused; statuses PENDING, REVIEW_REQUIRED, RUNNING, COMPLETED,
  COMPLETED_WITH_WARNINGS, FAILED, CANCELLED; resumable and cancellable;
  idempotent. Batch 001 is a test fixture only; no column is hard-coded.
- **Package**: `.ifcatalog`/`.zip`/folder with `manifest.json` and nine CSV
  tables; checksum, record-count and asset-count verification; whole-package
  rejection on structural failure; per-row skips with file+line otherwise;
  hardened reader (traversal, absolute paths, symlinks, duplicates, ZIP64,
  encryption, CRC, size and ratio limits). CLI `npm run catalogue:import`.
- **Provenance**: source + source record per fact; conflicting facts kept
  side by side; display chosen by source priority.
- **Images/diagrams**: bytes stored only with an explicit rights confirmation;
  served only while rights allow; `DO_NOT_REPUBLISH` stops display at once;
  never silently replaced; content-sniffed PNG/JPEG/GIF/WebP only.
- **Offline**: after import the source can be removed; tested with the source
  deleted and `fetch` disabled.
- **Not done**: reference-part photos (`images/reference/`) are not imported.

## 6. My Products

List with photo, stock, price, cost (role-gated), low-stock filter, category
filter. Product page tabs: Overview (photos: multiple, primary, reorder,
delete; validated by content/extension/size; served with nosniff + sandbox
CSP; barcode/QR labels), Fitment (from the linked reference), Stock (by
location, receive/transfer/adjust, recent movements), Supplier, OEM Reference
(part numbers, link/unlink reference parts), Sales (units, value, recent
invoices, void excluded), History (audit + stock ledger).

## 7. Inventory

Warehouses → locations (rack/shelf/bin); immutable movement ledger; balances
with `0 ≤ reserved ≤ on_hand` enforced by the database; reservations split on
partial fulfilment; transfers; adjustments with reasons; integrity check
(balances recomputed from movements and reservations) exposed in the UI and
asserted after every business test; stock levels list with search.

## 8. Customers and suppliers

Persisted with permanent codes, search, status, detail pages listing their
quotations/orders/invoices or purchase orders.

## 9. Enquiry → quotation → order → invoice → payment

Per-user enquiry cart (owner-only edits) → submitted enquiry → quotation
(auto-priced from matching products; editable while DRAFT with a staleness
check; issue/accept/reject/cancel; lazy expiry; PDF) → order (reserves stock;
reject or back-order a shortfall) → deliveries (deduct stock) → invoice of
delivered-uninvoiced quantity (PDF) → immutable payments (no overpayment) →
void (unpaid only; re-opens billable quantity) → returns (re-stock). Money
math in integer minor units with single rounding points.

## 10. Authentication and permissions

First-run Owner setup, no default credentials; scrypt; hashed session tokens;
HttpOnly/SameSite cookies (Secure over HTTPS); 12 h idle / 7 day absolute;
CSRF token + same-origin check; lockout and per-address throttling; forced
password change; last-Owner safeguard; five roles, 33 permissions; every route
and every service method checks. Matrix:
[generated/PERMISSIONS_MATRIX.md](generated/PERMISSIONS_MATRIX.md); routes:
[generated/API_ROUTES.md](generated/API_ROUTES.md) (122 routes).

## 11. Reports

Dashboard (each figure gated by permission), stock on hand, low stock,
inventory valuation at cost, sales by month, sales by product, customer
activity, outstanding invoices with days overdue, quotation conversion,
supplier overview, per-product sales. All computed from persisted rows; CSV
export with formula neutralisation.

## 12. Offline qualification

| Check                                               | Evidence                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No outbound calls in server code                    | `operations.test.ts` scans `src/server` for `fetch`, `http/https/net/dgram/dns/tls`, WebSocket, XHR |
| Full sales workflow with network disabled           | `operations.test.ts` (fetch replaced by a thrower)                                                  |
| Catalogue works after the package source is deleted | `catalogue-package.test.ts`                                                                         |
| Browser makes no third-party requests               | Playwright `afterAll` asserts zero non-local requests across all 10 tests                           |
| No CDN/fonts                                        | system fonts; icons bundled                                                                         |
| Backup/restore round trip                           | `operations.test.ts` (data, photos, ledger integrity; damage detected)                              |

## 13. Security review

Controls verified by tests (`security.test.ts`, `http.test.ts`,
`catalogue-*.test.ts`, `products.test.ts`): authentication, session
revocation, cookie flags, CSRF and cross-origin writes, per-route and
per-service authorization for all five roles, IDOR (cross-product photo
deletion, other users' carts, file kinds), input validation, 1 MB JSON and
per-route upload limits, content-sniffed uploads (SVG/script refused), CSV
formula injection on export, SQL injection and FTS syntax in every search
parameter, stored-markup returned only as JSON with nosniff, package
extraction attacks (traversal, symlinks, duplicates, bombs, CRC tampering),
no secrets in audit/logs, no stack traces in responses, no CORS grants, no
default credentials, dev-only sample data refused in production, page
headers (`X-Frame-Options`, `frame-ancestors`, nosniff, no `X-Powered-By`),
`npm audit`: 0 vulnerabilities.

Fixed during this phase's review: personal enquiry carts could be altered by
other users; a second "primary" photo caused a 500; binary files were accepted
as CSV; cookie lifetime exceeded the session lifetime; page security headers
were missing; the legacy `/api/catalogue` trusted an `x-demo-role` header
(removed with the legacy routes).

Residual risks: rate-limit buckets are in memory (reset on restart); the
per-address limit trusts `X-Forwarded-For` (per-account lockout still
applies); page CSP does not restrict scripts (Next.js inline runtime); TLS is
expected from a reverse proxy; HawkScan DAST was **not run** (no
`HAWK_API_KEY` in this environment).

## 14. Test results (final run on `467ce0c`)

| Suite                                                                                                                                                                                                                 | Result                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Server tests (`npm test`, Node test runner, real SQLite + real router)                                                                                                                                                | **135 / 135 pass**, 0 fail, 0 skipped                                                            |
| — catalogue-csv 17 · catalogue-package 16 · db 6 · documents 4 · http 19 · identity 9 · inventory 7 · labels 3 · money 4 · operations 7 · performance 2 · products 10 · purchasing-reports 5 · sales 16 · security 10 | all pass                                                                                         |
| Unit-level (money, labels, db, PDF writer)                                                                                                                                                                            | included above                                                                                   |
| Integration (HTTP stack, documents, operations, security)                                                                                                                                                             | included above                                                                                   |
| Frontend unit tests                                                                                                                                                                                                   | none (UI covered by E2E)                                                                         |
| E2E (Playwright, Chrome)                                                                                                                                                                                              | **10 / 10 pass**                                                                                 |
| Type check (`tsc --noEmit`, strict)                                                                                                                                                                                   | **PASS**                                                                                         |
| Build (`next build`)                                                                                                                                                                                                  | **PASS**, 0 warnings                                                                             |
| Lint                                                                                                                                                                                                                  | ESLint is not configured in this project; Prettier check **PASS**                                |
| Migrations: fresh database                                                                                                                                                                                            | **PASS**                                                                                         |
| Migrations: upgrade from a 0001–0003 database with data                                                                                                                                                               | **PASS**                                                                                         |
| Migrations: edited migration refused / failed migration rolls back                                                                                                                                                    | **PASS** / **PASS**                                                                              |
| Generated docs up to date                                                                                                                                                                                             | **PASS**                                                                                         |
| Performance: 20,000-row CSV import                                                                                                                                                                                    | stage 1.4 s, commit 33.4 s (~600 rows/s); searches 5–23 ms                                       |
| Performance: 2,000 products                                                                                                                                                                                           | list, lookup, low stock, dashboard, valuation, stock levels all < 10 ms; hot queries use indexes |
| `npm audit`                                                                                                                                                                                                           | 0 vulnerabilities                                                                                |
| HawkScan DAST                                                                                                                                                                                                         | **NOT RUN** (no API key)                                                                         |

The earlier prototype's tests (adapter, component, import-admin, Nengun,
Toyota EPC, unified-client, live) were removed together with the code they
tested.

## 15. Files and migrations

- Added: `src/server/**` (kernel, db + migrations `0001_core`,
  `0002_products_inventory`, `0003_sales_purchasing`,
  `0004_reference_catalogue`, providers, standalone, domain, catalogue, http,
  documents, labels, ops, dev), `src/ui/**`, `src/app/(app)/**` (32 pages),
  `src/app/api/v1/[...path]/route.ts`, `scripts/*.mts`, `tests/server/**`,
  `tests/e2e/workflow.spec.ts`, `tests/fixtures/catalogue/**`, docs listed in
  the README, `docs/generated/**`.
- Removed from the running app (kept in git history at `7099192`): browser demo
  adapter and seed, persona authorization, old `Workspace`/components, JSON
  catalogue store, Toyota EPC / Nengun / IntraForge-storage clients,
  IntraForge OIDC sign-in routes, and the demo-era docs.

## 16. Known limitations

1. Reference-part photos in packages (`images/reference/`) are not imported;
   only drawings are.
2. PDFs use the built-in Helvetica (WinAnsi): Arabic and other non-Latin text
   prints as "?".
3. Online catalogue providers (Toyota EPC, Nengun) are not shipped; the
   earlier gated Toyota EPC warm-up/admin import and IntraForge storage client
   were removed from the runtime (history `7099192`). Catalogue data comes
   from CSV, offline packages or manual entry.
4. One currency per shop; no FX. No e-mail sending (PDFs are downloaded).
5. Barcode scanning expects a keyboard-wedge scanner; no camera scanning.
6. Single-process SQLite: one server, not horizontally scalable. A large
   import interrupted by a restart must be resumed manually (Resume button).
7. No migration of the prototype's browser/JSON data (it was demo data).
8. Browser testing on Chrome only; phone-width layout checked for overflow on
   seven screens, not fully designed for phones.
9. TLS, process supervision and scheduled backups are the operator's
   responsibility.

## 17. Deferred IntraForge integration work

Per [INTRAFORGE_INTEGRATION_CONTRACT.md](INTRAFORGE_INTEGRATION_CONTRACT.md):
IdentityProvider over platform sessions with role mapping; FileStorage;
AuditProvider; ConfigurationProvider with atomic numbering; repositories one
alias at a time; migration scripts (users → platform ids, files, business
data, catalogue via offline package); switching the composition root; launch
from IntraForge. None of this was started.

## 18. Final status: PARTIAL

The application meets the brief's core qualification criteria with test
evidence: real persistence, backend-enforced roles, separated catalogue and
products with IMPORT TO MY PRODUCTS, CSV and offline-package import with
provenance and rights gating, inventory ledger, the full sales chain with
decimal-safe money and PDFs, reports, offline operation, migrations,
backup/restore, security controls and documentation.

It is **not** marked PASS because: reference-part photos are not imported
(limitation 1); PDFs cannot print non-Latin text (limitation 2); the DAST scan
was not run; and previously built online-provider and IntraForge sign-in code
was removed from the runtime rather than carried forward (limitation 3). No
IntraForge code, database, configuration or installer was touched, and
nothing was pushed, merged, rebased or published.
