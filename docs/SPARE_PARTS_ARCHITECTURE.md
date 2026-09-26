# Spare Parts — architecture

Spare Parts is a standalone, offline-first web application for a spare-parts
shop: a **Reference Catalogue** (what manufacturers say exists), **My
Products** (what the shop stocks and sells), inventory, customers and
suppliers, and the sales chain enquiry → quotation → order → invoice →
payment, with reports. It runs on one server with **no external services**:
one SQLite database and one directory of managed files.

It is built so that IntraForge can later replace identity, storage, audit and
configuration behind stable interfaces. **No IntraForge integration exists in
this build** (see [the contract](INTRAFORGE_INTEGRATION_CONTRACT.md)).

## Layers

```
Browser (React 19, Next.js 16 App Router, src/app + src/ui)
   │  fetch /api/v1/…  (cookie session + CSRF header)
   ▼
HTTP layer            src/server/http        routing, session/CSRF/origin checks,
   │                                         body limits, error mapping
   ▼
Domain services       src/server/domain      business rules + permission checks
   │  (App = createApp(providers))           src/server/catalogue  import pipelines
   ▼
Provider interfaces   src/server/providers   IdentityProvider, *Repository,
   │                                         FileStorage, AuditProvider,
   │                                         ConfigurationProvider, UnitOfWork
   ▼
Standalone providers  src/server/standalone  SQLite + local disk implementations
   │
   ▼
SQLite (node:sqlite, WAL)  +  data/files/    — one data directory
```

Rules that keep the seams honest:

- Domain services depend only on `providers/*` types. Nothing in `domain/` or
  `catalogue/` imports SQLite, `fs` (except the package reader), or HTTP.
- Every service method checks its permission itself (`requirePermission`), and
  the HTTP route names the same permission (defence in depth). The UI hides
  actions the role cannot use, but authorization is never decided there.
- Every write goes through `UnitOfWork.write`, so a business operation and its
  audit events commit or roll back together.
- The browser talks only to same-origin `/api/v1`. The server code contains no
  outbound network calls (enforced by a test that scans `src/server`).

## Source layout

| Path                     | Purpose                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `src/app/(app)/…`        | Pages (client components). One folder per screen.                                   |
| `src/ui/`                | API client, session, shell, tables/forms, drawing viewer.                           |
| `src/server/kernel/`     | `AppError`, integer money math, ids.                                                |
| `src/server/db/`         | Connection (serialized transactions), migrations.                                   |
| `src/server/providers/`  | Interfaces only (`contracts.ts` gives them business names).                         |
| `src/server/standalone/` | SQLite/local-disk implementations and the composition root (`container.ts`).        |
| `src/server/domain/`     | Products, inventory, sales, purchasing, reports, catalogue, documents, permissions. |
| `src/server/catalogue/`  | CSV parsing/import, offline package reader/importer, catalogue model.               |
| `src/server/http/`       | Framework-neutral handler; `routes.ts` is the whole API surface.                    |
| `src/server/documents/`  | Minimal PDF writer and quotation/invoice layout.                                    |
| `src/server/labels/`     | Code 128 and QR generators (no dependencies).                                       |
| `src/server/ops/`        | Backup/restore, generated documentation.                                            |
| `src/server/dev/`        | Development-only sample data.                                                       |
| `scripts/`               | CLIs: `owner:create`, `backup`, `restore`, `catalogue:import`, `docs:generate`.     |
| `tests/server/`          | Node test-runner suites (real SQLite, real router).                                 |
| `tests/e2e/`             | Playwright browser tests against a real server.                                     |

## Persistence and concurrency

- One SQLite file (`<data dir>/spareparts.sqlite`), WAL mode,
  `synchronous=FULL`, foreign keys on. Node's built-in `node:sqlite`.
- One connection, **strictly serialized**: every operation queues on a mutex,
  a write runs in `BEGIN IMMEDIATE … COMMIT`, and a thrown error rolls the
  whole operation back. Nested calls join the outer transaction.
- Integrity is enforced twice: in code and by the database (CHECK constraints
  such as `reserved <= on_hand`, foreign keys, unique keys, and triggers that
  make stock movements and payments immutable).
- Managed files live under `<data dir>/files/` with generated keys; the
  client's file name is only metadata. Every read re-verifies the SHA-256.
- The data directory is chosen by `SPAREPARTS_DATA_DIR` (default `./.data`).

## Money, stock and the sales chain

- **Money** is integer minor units (`priceMinor: 12345` = 123.45). Percentages
  are basis points. Line totals and tax are computed with BigInt and rounded
  half away from zero once per line and once for tax (`kernel/money.ts`).
- **Stock** is a ledger: immutable `stock_movements`, cached in
  `stock_balances(on_hand, reserved)`, with `available = on_hand − reserved`.
  `verifyIntegrity()` recomputes balances from movements and reservations.
- **Sales chain**: confirming an order _reserves_ stock; recording a delivery
  _deducts_ it; an invoice bills only delivered-and-uninvoiced quantity;
  payments are immutable and cannot exceed the balance; voiding an invoice
  (only when unpaid) makes its quantities billable again; returns re-stock.
  Quotations expire lazily when read.
- **Numbers**: `QUO-2026-000001`, `SO-…`, `INV-…`, `PO-…`, `ENQ-…`, `GRN-…`,
  `RET-…`, and permanent codes `CUS-000001`, `SUP-…`, `WH-…`, allocated
  atomically inside the transaction.

## Authentication and sessions

Local accounts with scrypt password hashes (per-user salt), opaque random
session tokens stored only as SHA-256 hashes, `HttpOnly; SameSite=Lax`
cookies (`Secure` over HTTPS), 12-hour idle / 7-day absolute session life,
account lockout after repeated failures, per-address throttling, forced
password change for administrator-created accounts, and a last-Owner
safeguard. First run shows a setup screen that creates the Owner; there are
no default credentials. Details: [permissions](SPARE_PARTS_PERMISSIONS.md).

## Documents, labels, files

- Quotation and invoice PDFs are rendered on the server from stored records
  and kept through `FileStorage` (kind `QUOTATION_PDF` / `INVOICE_PDF`, one
  current copy per document).
- Product photos are kind `PRODUCT_IMAGE`; catalogue drawings are kind
  `CATALOGUE_DRAWING` and are served only through the rights-checked
  `/catalogue/assets/:id` route.
- Barcode (Code 128) and QR labels are generated as SVG. The scan/lookup page
  resolves a scanned SKU or any registered part number to the product.

## Offline operation

Everything the application needs is in the data directory: catalogue data and
drawings are copied in on import, the UI has no CDN or external font
dependency, and the browser makes no third-party requests (the Playwright
suite fails if it sees one). A backup is a folder copy — see below.

## Operations

```
npm install
npm run build && npm start            # production, bound to 127.0.0.1
SPAREPARTS_OWNER_PASSWORD=… npm run owner:create -- owner@shop.example "Owner Name"   # optional; the web setup screen does the same
npm run backup -- D:\backups\2026-09-26     # consistent copy of database + files (app may keep running)
npm run restore -- D:\backups\2026-09-26    # into an EMPTY data directory, app stopped
npm run catalogue:import -- D:\packages\toyota-eu.ifcatalog --images-licensed
```

Environment: `SPAREPARTS_DATA_DIR` (data location), `SPAREPARTS_ALLOWED_ORIGINS`
(extra origins allowed to make state-changing calls, comma-separated),
`SPAREPARTS_SECURE_COOKIES=1` (force the Secure flag behind a TLS proxy),
`SPAREPARTS_ENABLE_SAMPLE_DATA=1` (development only; ignored in production).
Backups hold personal and commercial data: protect them like the live data.
Migrations run automatically at start-up, in one transaction; a migration that
was edited after being applied is refused.

## Designed for, not implemented

- **Backup**: implemented (`ops/backup.ts`). Scheduling is left to the
  operating system.
- **Configurable shop name**: stored in settings, never hard-coded; shown in
  the shell, login page and documents.
- **Launch from IntraForge**: not implemented. The session/identity seam
  (`IdentityProvider`) and same-origin API make a later launch-and-sign-in
  possible without changing business code.

## Legacy prototype

Earlier prototype code (browser-only demo adapter, persona-based
authorization, JSON catalogue store, Toyota EPC / Nengun / IntraForge-storage
clients, IntraForge OIDC sign-in) was removed from the running application
because it faked authorization and mixed demo data into the runtime. It
remains in git history at commit `7099192` for a future adapter to mine.
