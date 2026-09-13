# Spare parts release readiness

Snapshot as of 2026-09-13, branch `codex/spareparts-reference`. Tracks
completion against five milestones in sequence: the standalone-application
build-out, the Nengun catalogue-source analysis and import-preparation
milestone, the EPC part-number-linked diagram rebuild, the Toyota EPC
provider integration that followed it, and the merge of that provider into
one catalogue that followed _that_ (see
[SPARE_PARTS_CATALOG_ARCHITECTURE.md](SPARE_PARTS_CATALOG_ARCHITECTURE.md)
for the full detail on both). It supersedes the narrower
[READINESS.md](READINESS.md) for scope tracking; READINESS.md remains as
the original validation record.

## Fifth milestone: one merged catalogue (2026-09-13)

- Replaced the separate "Toyota EPC" nav item/page with a single
  "Reference Catalogue" page that blends both sources — no visible
  source-based UI split. `src/components/ToyotaEpc.tsx` was deleted; its
  capabilities (VIN lookup, Add to Enquiry/Request Quote/Copy OEM Number
  actions) moved into `ReferenceCatalogue.tsx`, gated on
  `provenance.sourceProvider` per record rather than on which page you're
  on.
- Added `src/catalogue/unifiedClient.ts` (`UnifiedCatalogueClient`): the
  frontend's only catalogue client now, queries local and Toyota in
  parallel and merges the result — makes deduplicated by name, everything
  else concatenated (ids never collide across sources by construction).
  Every merge path degrades to "local only" on a disabled provider or a
  failed request, never an error. 9 new unit tests
  (`tests/unified-client.test.ts`) cover this against a stubbed `fetch`.
- Added two API actions (`toyota-browse`, `toyota-search-parts`) exposing
  `ToyotaEpcProvider` methods that already existed server-side but weren't
  reachable from the client yet.
- `ExplodedDiagramViewer` became fully controlled (`zoom`/`fullscreen` as
  props, no internal toolbar) so `ReferenceCatalogue.tsx` could adopt it
  for both local and Toyota diagrams under one toolbar, replacing its own
  hand-rolled hotspot markup. All pre-existing diagram e2e assertions
  (zoom %, "Fit"/"Fullscreen" labels, hotspot `aria-pressed`, row sync)
  pass unchanged against the shared component.
- **Found and fixed three real bugs that only surfaced once the merge was
  actually exercised live** (documented in the architecture doc's "The
  merge" section): `VehicleModel.id`/`VehicleVariant.id`/`Category.id`
  were hashes when `ToyotaEpcProvider.browse()` needed them to be the
  literal slug/`"region/code"`/section-code strings it round-trips through
  `filters.model`/`filters.variant`/`filters.category` — silently breaking
  the merged vehicle picker for Toyota entries; `browse()` never populated
  `models` until a model was already chosen, leaving the Model dropdown
  empty right after picking "Toyota" as the make; and two real API rows
  sharing a `(part_number, suffix)` under a heavily-superseded PNC produced
  a React duplicate-key error. All three are now covered by regression
  tests, not just fixed ad hoc.
- Manually verified live (`TOYOTA_EPC_ENABLED=true`) end to end through the
  single merged page: Make "Toyota" (one deduplicated entry) → Model
  "COROLLA" (beside the local demo's own "Corolla" in the same dropdown) →
  a real variant → "CYLINDER HEAD" → a real 47-hotspot diagram → a callout
  with "22 variants available" → Copy OEM Number / Add to Enquiry / Add to
  My Products all present together → submitted enquiry. Then re-verified
  the disabled default degrades cleanly — **78/78** unit tests pass
  (49 pre-existing + 12 mapper + 8 provider/policy + 9 merge), **12/12**
  e2e, clean build/typecheck/format throughout.

## Fourth milestone: Toyota EPC provider (2026-09-13)

- Verified `https://toyota-epc.aftermarketcatalog.com/api` is a real,
  unauthenticated, CORS-open, well-documented JSON API (independent
  aggregator, not Toyota Motor Corporation) by making ~20 real requests and
  capturing the responses as fixtures (`tests/fixtures/toyota-epc/`) —
  nothing in the adapter was written from assumption.
- Read its `/legal` page and found it explicitly disclaims a redistribution
  licence for catalogue data/illustrations. Flagged this to the user before
  building a persistence layer against it (a genuine licensing decision,
  not a technical one) and, per their direction, built the complete
  provider **and** a governance/policy layer that keeps it disabled and
  read-through-only by default — see "Catalogue Data Licensing & Provider
  Governance" in the architecture doc.
- Added `src/catalogue/providerPolicy.ts`: `ProviderCapabilities` /
  `ProviderLicense` for every provider this application knows about
  (including the pre-existing first-party ones), with
  `assertBulkSyncAllowed`/`assertPersistentStorageAllowed`/
  `assertImageStorageAllowed` guards enforced server-side, independent of
  any `*_ENABLED` env flag or admin-UI toggle.
- Added the full Toyota adapter
  (`src/integrations/catalogues/toyota-epc/`: `config.ts`, `types.ts`,
  `transport.ts`, `mapper.ts`, `provider.ts`) implementing the shared
  `CatalogueProvider` contract plus a richer native surface (model/variant/
  section/figure/part-number/VIN/search), gated by `TOYOTA_EPC_ENABLED`
  (default `false`) and the policy guards above. `CatalogueProvider` itself
  gained a `capabilities` field and an optional `lookupVin` method.
- Extended the shared model additively:
  `DiagramCallout.rect`/`resolved`/`keyType`,
  `CataloguePart.specifications`, `ReferenceFitment.attributes`,
  `VinLookupResult`/`VinMatch` — nothing existing changed shape.
- Added a provider-agnostic `Enquiry`/`EnquiryItem` domain
  (`domain/models.ts`, `services.enquiries`) — a price-free "request a
  quote" cart, kept deliberately separate from the existing priced
  Sales-Order/Quotation flow (`Order.lines[].price` is mandatory and
  `partId` must reference an existing company `Part`, which is
  structurally wrong for an unpriced EPC reference lookup that hasn't been
  adopted into My Products).
- Added `src/components/ExplodedDiagramViewer.tsx` (zoom/pan/fullscreen/
  loading/error, percentage- or pixel-rect-positioned hotspots, and an
  image-withheld wireframe mode) and `src/components/ToyotaEpc.tsx` (the
  full vehicle-tree → diagram → part → enquiry UI, plus a disabled-state
  panel that is the production default), wired into `Workspace.tsx` as a
  new "Toyota EPC" nav item.
- Extended `src/components/CatalogueAdmin.tsx` with a "Catalogue Providers"
  tab showing the full capability/licence table for every registered
  provider.
- 17 new unit tests (`tests/toyota-epc-mapper.test.ts`,
  `tests/toyota-epc-provider.test.ts`) plus 4 opt-in live tests
  (`tests/live/toyota-epc.live.test.ts`, `npm run test:live`) and 1 new e2e
  test confirming the disabled-by-default production state end to end.
  Manually verified the enabled path in a real browser against the live
  API (Toyota → Corolla → a real catalogue → Cylinder Head section → real
  diagram/hotspots → real part detail with multi-model compatibility →
  Add to Enquiry → submitted enquiry) — see the architecture doc's
  "Testing" section for the full account.

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
  5 reference parts, 1 original diagram with 3 synced callouts.
- **Nengun catalogue-source analysis (2026-09-12 milestone):** robots.txt
  confirmed disallowing ClaudeBot site-wide and `/oem/parts/`,
  `/oem/variant/`, `/oem/group/`, `/catalogue/vehicle/` for all bots — no
  page was fetched; see `docs/catalogues/NENGUN_SOURCE_REVIEW.md`.
  `docs/catalogues/NENGUN_FIELD_MAP.md` documents the observable structure
  from what was already reviewed/described, marked by source.
- **Nengun provider architecture:** `src/integrations/catalogues/nengun/`
  implements the `CatalogueProvider` contract (`provider.ts`), a pure
  mapper from a Nengun-shaped page into the generic catalogue model
  (`mapper.ts`) that keeps diagram-callout numbers and OEM part numbers in
  separate fields end to end and never fabricates a missing OEM number,
  and an import-mode gate (`config.ts`, `NENGUN_IMPORT_MODE`) that is
  disabled by default and still refuses even when set, since no fetch
  transport exists. No network call to nengun.com exists anywhere in this
  package.
- Reference-catalogue staging (`ReferenceRepository.stage`/`.publish`) is
  now provider-parameterized instead of hardcoding `"company-csv"`, so a
  future authorized provider can reuse the same staging/duplicate-identity
  pipeline without a redesign — duplicate identity already includes source
  provider, record ID, manufacturer and vehicle context (existing CSV
  behavior; unchanged for CSV callers, which still default to
  `"company-csv"`).
- `DiagramCallout.quantity` and `VehicleVariant.grade` added — fields the
  field map identified as present in the described source structure but
  previously unmodeled (or misfiled into `bodyType`).
- Diagram UI rebuilt into an EPC-style two-column layout (diagram left,
  "Parts in this diagram" panel right, with quantity column, fullscreen
  toggle, and an inline selected-callout card showing description/OEM
  numbers/quantity/applicability/verification plus [View Part] and
  [Add to My Products]/[My Product] actions) — see
  `src/components/ReferenceCatalogue.tsx`.
- **EPC part-number-linked rebuild (2026-09-12, third milestone):**
  `DiagramCallout.display` (e.g. `"15601"`) and `ReferenceNumber.original`
  (e.g. `"DEMO-15601-0T001"`) are enforced as genuinely separate fields
  throughout the model, repository and UI — see "EPC data model" in
  `docs/catalogues/FOUNDATION.md`. A `CataloguePart` may now carry multiple
  `OEM_OE` numbers, each with its own `applicability` (production-window)
  text and linked by a `SUPERSEDES` cross-reference; the parts table shows
  "N variants available" with an expand toggle instead of collapsing them.
  Added `CataloguePart.position` and `ReferenceNumber.applicability` fields.
- The Toyota engine/filtration demo diagram was rebuilt from 2 to 8
  callouts (air cleaner housing, air filter element, intake hose, clamp,
  oil filter, bracket, mounting bolt, grommet) with realistic-looking but
  explicitly `DEMO-`-prefixed OEM numbers, all in one new original SVG
  (`public/diagrams/demo-filtration.svg`).
- **Exploded-view artwork redraw (2026-09-13):** the first version of that
  SVG laid all 8 parts out as a uniform icon grid — separated in data, but
  reading visually as a product spec sheet rather than a parts diagram.
  Redrawn (revision 2 of the diagram) as an actual exploded-view
  illustration: components are spatially staggered along two implied
  assembly axes (intake path: housing → filter element → hose → clamp;
  fastener stack: bracket → grommet → bolt, plus an adjacent oil filter),
  connected by short dashed "explosion gap" ticks and a fastener-stack
  axis line, with a dotted-hatch reference "engine mounting face" anchoring
  the lower cluster. Every callout now has its own leader line ending in a
  dot on the specific part feature it identifies, matching where the
  app's interactive callout badge is positioned. `DiagramCallout.x/y` in
  `src/catalogue/seed.ts` were recomputed against the new `1000×780`
  viewBox so the badges still land exactly on those leader-line targets.
  Verified by opening the diagram in a browser (not just reading the SVG
  source) after every layout change.
- Selecting a callout now auto-scrolls its row into view in the (now
  independently scrollable) parts panel; `ReferenceDetail.diagrams` was
  enriched to return the specific `{ diagram, callout }` pair a part
  appears in, so a part's "Diagrams" tab can say "Found in diagram: X ·
  Callout: Y" and clicking it opens that diagram with the callout
  pre-selected — closing the search-to-diagram loop end to end.
- Diagram callout numbers are confirmed excluded from the repository's
  exact-match number index (only `ReferenceNumber.normalized` is indexed),
  so a bare callout search is never treated as an authoritative
  globally-unique OEM lookup — tested explicitly.
- Fixed a real staleness bug found while verifying this work: the
  reference-catalogue file cache and the in-process singleton in
  `src/catalogue/server.ts` were both still serving pre-rebuild seed data
  after the schema version wasn't bumped for this change. Bumped
  `referenceSchemaVersion` to 3 and documented that a dev-server restart
  (not just deleting the cache file) is required after a `seed.ts` shape
  change, since the in-memory singleton survives Next.js HMR by design.

## Partial

- **IntraForge platform-requirements table** now uses the exact 5-column
  format requested and covers all 19 named concepts, but it documents
  _intent_, not a verified contract — no IntraForge Core code was read or
  consulted, per the isolation requirement.
- **Nengun catalogue integration** is architecture-complete but data-empty
  by design: no live transport exists, and none will until written
  authorization or a licensed feed is supplied (see
  `docs/catalogues/NENGUN_SOURCE_REVIEW.md`, "What would unblock authorized
  import"). This is the expected/intended state, not an oversight.

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
- `npm test` — **49/49** Node test-runner assertions pass (`tests/*.test.ts`):
  adapter/business-logic invariants (12, including order cancellation),
  catalogue/import invariants (21, including multi-make seed breadth and
  seven new EPC-model tests — callout/OEM distinction, the full
  Diagram→Callout→Part→Number[] chain, multi-number applicability, part→
  diagram/callout reverse lookup, normalized-number search, the bare-
  callout-is-not-an-identifier proof, and reference/company separation
  under the enriched detail shape), 2 component tests, 3
  historical-Nengun-migration-fixture tests, and 10
  `tests/nengun-provider.test.ts` tests covering vehicle hierarchy parsing,
  diagram metadata, callout parsing, the callout/OEM-number distinction, a
  row with no OEM number producing no fabricated one, supersession
  mapping, provenance on every record, idempotent identifiers, commercial-
  field absence (source/company separation), and both the disabled and
  the licensed-but-no-transport provider states.
- `npm run format:check` — Prettier clean.
- `npm run build` — production build succeeds.
- `npm run test:e2e` — **11/11** Playwright browser tests pass, including
  an EPC-panel test (`EPC diagram panel shows callout details, quick
adoption and fullscreen`, on the headlamp diagram) and a full
  part-number-linked-catalogue test (`EPC part-number linked catalogue:
diagram/list sync, zoom alignment and number search`, on the 8-callout
  filtration diagram) exercising: 8 callouts present, row highlight on
  callout selection with auto-scroll, callout vs. OEM number shown
  separately, selection changing when a different row is clicked, the
  multi-number "variants available" expansion with per-number
  applicability, zoom, callout alignment/clickability surviving zoom,
  searching by OEM number (not callout), and reaching the correct
  diagram/callout from the found part.
  Covers workflow letters A–H from the standalone-app milestone brief:
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
  - Also covered: `purchase cancellation requires confirmation and blocks
further receiving` (order-cancellation confirmation dialog).

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
- `src/integrations/catalogues/nengun/` is **not** temporary — it is
  designed to remain and gain a real transport once authorized. What is
  temporary is its current state: `reference_only` mode and the absence of
  any fetch implementation, both of which persist until the prerequisites
  in `docs/catalogues/NENGUN_SOURCE_REVIEW.md` are met.

## Known limitations

- All catalogue numbers, fitments, and the demo diagram are fictional/
  illustrative — not verified OEM data (unchanged from READINESS.md).
- Reference catalogue breadth is still small relative to a real parts
  catalogue (11 parts across 2 vehicles and 2 diagrams, one with 8
  callouts) — sufficient to exercise every UI path (multi-make filtering,
  diagram browsing, non-diagram categories, multi-number applicability
  variants) but not representative of production data volume; that
  arrives via the real import pipeline or licensed feeds post-integration.
- `CatalogueDiagram` "diagram group" and part "color" fields named in the
  EPC rebuild request have no confirmed observed example from any
  reviewed source and were intentionally left unmodeled rather than
  invented — see "Known limitations" in
  `docs/catalogues/NENGUN_FIELD_MAP.md`.
- This remains a single-user local browser demo; no concurrency, no
  multi-tenant isolation, no real authentication — all by design pending
  IntraForge integration.
- Callout numbers are intentionally excluded from the global cross-vehicle
  number search index (they are not globally unique OEM identifiers);
  callout lookup is scoped by navigating to a specific diagram instead.
  See "Search" in `docs/catalogues/NENGUN_FIELD_MAP.md`.
- "Diagram group" and "Color" fields described in the integration request
  have no observed example from any reviewed source and were not added —
  see "Known limitations" in `docs/catalogues/NENGUN_FIELD_MAP.md`.
