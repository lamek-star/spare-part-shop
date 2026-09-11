# Spare parts release readiness

Snapshot as of 2026-09-11, branch `codex/spareparts-reference`. This tracks
completion against the standalone-application milestone (finish the app
before any IntraForge integration work begins). It supersedes the narrower
[READINESS.md](READINESS.md) for scope tracking; READINESS.md remains as the
original validation record.

## Completed

- Layered architecture: UI components never call `fetch`/storage directly;
  everything goes through `Services` (`src/services/contracts.ts`) to the
  demo adapter (`src/adapters/demo.ts`) or the catalogue HTTP client
  (`src/catalogue/client.ts`). The only future integration point is
  `src/integrations/intraforge/contract.ts`.
- Reference catalogue vs company products kept strictly separate: catalogue
  records carry no cost/price/warehouse/quantity; "Add to My Products" is the
  only path that creates a commercial `Part`, and it copies identifying
  fields once rather than linking live.
- Full part-number system: 15 `NumberType` variants, `display`/`normalized`
  pair preserved separately, normalized-number search, provenance on
  reference numbers.
- Vehicle compatibility: explicit `Compatibility` (company) and `Fitment`
  (catalogue) join records only — never inferred from number similarity.
- Exploded diagram browser: make → model → variant → year/engine → category
  → diagram, with callout-to-row and row-to-callout highlight sync. Diagram
  artwork is an original SVG created for this app; no copied manufacturer or
  Nengun artwork ships.
- "Add to My Products" workflow with SKU/supplier/cost/price/warehouse/
  reorder capture; adopted products retain `preferredCataloguePartId` and
  `referenceProvenance`, and reference-side updates never touch company
  fields (tested).
- Company product management: catalogue, categories, brands, pricing, cost,
  margin, currency, status, images, documents, suppliers, reorder settings,
  search, filtering, pagination.
- Movement-based inventory: `Stock` (on hand/reserved/available) is always
  derived from `Movement` history and confirmed-sale reservations, never
  independently edited. Transfers post paired movements atomically.
  Adjustments cannot consume reserved stock or go negative.
- Purchasing: Supplier → PO → PO Lines → Receive Goods → Stock Movement →
  Inventory Updated, with DRAFT/CONFIRMED/PARTIALLY RECEIVED/RECEIVED/
  CLOSED/**CANCELLED** states (cancellation added this milestone).
- Sales: Customer → Quotation/Draft → Confirm (reserves stock) → Fulfil →
  Invoice → Payment, plus customer returns, and **order cancellation** before
  fulfillment (added this milestone).
- Confirmation before destructive actions (spec section 19): audited every
  destructive control in `src/components/` this milestone. Order
  cancellation uses the app's dialog-based confirm (`CancelOrderConfirm` in
  `Workspace.tsx`); document removal (`Workspace.tsx`) and catalogue image
  removal (`Gallery` in `CatalogueTools.tsx`) now use an in-place arm/
  confirm pattern (button reads "Remove" → "Confirm remove" on first
  click). Order-line removal while composing a draft (`Forms.tsx`) is
  intentionally left unconfirmed — it edits an unsaved draft, not
  persisted data.
- Pricing centralized in `domain/models.ts totals()`; no per-screen
  duplicate tax/discount math.
- Dashboard: stock valuation, monthly sales, open purchases, low-stock
  count, catalogue parts, out-of-stock, today's sales, pending deliveries,
  active customers/suppliers, recent sales, warehouse stock, replenishment
  watchlist, top-selling parts — no decorative-only cards.
- Global search spans internal SKU, OEM, MPN, aftermarket, supplier,
  cross-reference and barcode numbers, description, brand and vehicle, and
  clearly distinguishes Reference Catalogue results from My Products
  results.
- Documents/images: source, rights status and metadata are preserved;
  images with unknown/prohibited rights render as a placeholder, never as
  company-owned (tested).
- Import pipeline: Upload → Map Columns → Validate → Stage → Review →
  Publish, with duplicate detection, source-identity conflict detection,
  provenance, invalid-row handling, retry, idempotent publish and batch
  history. CSV formula injection, control characters, unsafe URLs and
  oversized files are rejected. JSON/XML/API/web-feed providers are defined
  as extension points and fail closed until a real licensed contract exists.
  Nengun is registered as a disabled source; no scraping occurs.
- Management: branches, warehouses, users, role-permission UI, settings,
  catalogue sources, import batches, audit log. Demo-role UI restrictions
  are explicitly documented as simulation, not authentication.
- Reports: inventory valuation, current/low/out-of-stock, sales by product,
  sales by customer, purchases by supplier, gross margin, top-selling,
  slow-moving, stock movement history, with date filtering and CSV export.
- Security: no `dangerouslySetInnerHTML`/`eval`/`innerHTML`/`document.write`
  in `src/`; no UI component calls `fetch` outside the catalogue client;
  CSV formula/control-character/unsafe-URL rejection; image upload MIME/
  size/dimension validation actually wired into the upload path, not dead
  code.
- Demo data: 48 company parts across 4 warehouses/3 branches, 7 customers,
  5 suppliers, order/movement history; reference catalogue now spans 2
  makes/models/variants (Mitsubishi Lancer Evolution IX, Toyota Corolla),
  5 reference parts, 1 original diagram with 3 synced callouts (broadened
  this milestone — see Known limitations).

## Partial

- **IntraForge platform-requirements table** now uses the exact 5-column
  format requested and covers all 19 named concepts, but it documents
  _intent_, not a verified contract — no IntraForge Core code was read or
  consulted, per the isolation requirement.

## Missing / deliberately deferred

- No ESLint gate — `npm run format:check` (Prettier) is the project's
  established lint-equivalent; this was a prior deliberate decision
  (`docs/catalogues/FOUNDATION.md`), not something this milestone changed.
- No dependency-vulnerability scan was run (e.g. `npm audit`) as part of
  this milestone; `npm ci` reported 0 vulnerabilities at install time.
- Invoice is not a separate entity/AppModel — it is a Sale-kind Order in
  `Invoiced` status. Documented as an intentional simplification in
  [INTRAFORGE_INTEGRATION.md](INTRAFORGE_INTEGRATION.md); splitting it out
  is future integration-time work, not standalone-app work.
- No actual IntraForge adapter implementation — by design; this milestone
  explicitly excludes integration.

## Test evidence

- `npm run typecheck` — strict TypeScript, passes clean.
- `npm test` — 31/31 Node test-runner assertions pass (`tests/*.test.ts`):
  adapter/business-logic invariants (11 → 12 with the new cancellation
  test), catalogue/import invariants (13 → 14 with the new multi-make
  seed-breadth test), 2 component tests, 3 Nengun-migration tests.
- `npm run format:check` — Prettier clean.
- `npm run build` — production build succeeds.
- `npm run test:e2e` — 8/9 → **9/9** Playwright browser tests pass,
  including the new purchase-cancellation-with-confirmation test. Covers
  workflow letters A–H from the milestone brief:
  - A (catalogue: vehicle → category → diagram → callout → part → number):
    `vehicle catalogue diagram adoption and OEM company search`.
  - B (catalogue adoption → SKU/price/supplier → visible under My
    Products): same test, continues into adoption and lookup.
  - C (search: OEM number → normalized search → reference + company
    product): `number search to purchase receipt, customer sale and
invoice`, and the catalogue test above.
  - D (purchasing: supplier → PO → line → receipt → stock increase):
    `number search to purchase receipt, customer sale and invoice`.
  - E (sales: customer → SO → line → fulfil → stock decrease → invoice):
    same test.
  - F (transfer: warehouse A → transfer → warehouse B → movement history):
    `transfer review preserves warehouse and quantity before posting`.
  - G (CSV import: upload → mapping → validation → staging → review →
    publish → searchable): `CSV mapping staging publish and import
permission boundary`.
  - H (permissions: unauthorized action unavailable/denied):
    `sales persona remains outside import administration after reload`,
    plus the CSV test's import-permission-boundary assertions.
  - New this milestone: `purchase cancellation requires confirmation and
blocks further receiving` — exercises the section-19 confirmation-
    dialog requirement end to end.

## Integration prerequisites (before connecting to IntraForge)

See the full capability table in
[INTRAFORGE_PLATFORM_REQUIREMENTS.md](INTRAFORGE_PLATFORM_REQUIREMENTS.md)
and the concept mapping in
[INTRAFORGE_INTEGRATION.md](INTRAFORGE_INTEGRATION.md). Summary:

- Authenticated platform identity and a real permission provider to replace
  the demo persona (`x-demo-role` header is a simulation only).
- AppInstance/tenant scoping for every AppModel.
- Transactional, idempotent commands for stock-affecting operations
  (receive, fulfil, transfer, adjust, cancel).
- Object storage with signed URLs and MIME/rights policy enforcement,
  replacing client-side `data:` URL attachments.
- Server-side indexed search/pagination to replace the single-process
  in-memory/JSON-file reference store.
- A decision on whether Invoice becomes its own AppModel or stays a Sale
  Order status.

## Temporary components to remove/replace during IntraForge integration

- `src/adapters/demo.ts` and browser-persisted company state — replaced
  entirely by the IntraForge adapter behind
  `src/integrations/intraforge/contract.ts`.
- `.catalogue-data/reference-v1.json` single-process file store in
  `src/catalogue/repository.ts` — replaced by platform indexed storage.
- The `x-demo-role` header and demo-persona selector — replaced by real
  authenticated identity and permission checks.
- Base64 `data:` URL document/image storage — replaced by object storage
  with signed URLs.
- The built-in `original-demo` and `company-csv` catalogue sources and all
  seed fixtures (`src/adapters/seed.ts`, `src/catalogue/seed.ts`) — demo
  data only, not to be treated as real catalogue content.

## Known limitations

- All catalogue numbers, fitments, and the demo diagram are fictional/
  illustrative — not verified OEM data (unchanged from READINESS.md).
- Reference catalogue breadth is still small relative to a real parts
  catalogue (5 parts across 2 vehicles after this milestone's expansion) —
  sufficient to exercise every UI path (multi-make filtering, diagram
  browsing, non-diagram categories) but not representative of production
  data volume; that arrives via the real import pipeline or licensed feeds
  post-integration.
- Document/destructive-action confirmation is not uniformly applied across
  every delete control (see Partial, above).
- This remains a single-user local browser demo; no concurrency, no
  multi-tenant isolation, no real authentication — all by design pending
  IntraForge integration.
