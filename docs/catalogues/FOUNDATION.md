# Catalogue foundation

## Architecture

The reference catalogue is server-side and separate from browser company state. Existing `Part` means CompanyProduct. A reference component carries no cost, selling price, warehouse or quantity. Only Add to My Products creates a company SKU, price/cost, supplier and default warehouse. It creates zero stock; normal inventory workflows add movements.

`src/catalogue/models.ts`: source, vehicle hierarchy, catalogue/category, diagrams/callouts, reference parts/numbers, fitments, cross references and batches.
`src/catalogue/repository.ts`: indexed number search, bounded part/staging pages, lifecycle validation, idempotent publication and stale-update protection.
`src/catalogue/client.ts`: centralized HTTP adapter; components do not embed endpoints.
`src/catalogue/providers.ts`: CSV parser and extension contracts. JSON, XML, supplier feed, licensed API, manual feed and web reference adapters are disabled until real contracts/data are supplied. The original manual fixture is built in.
`src/catalogue/assets.ts`: object-storage contract and size/MIME/dimension validation for permitted uploads.

## Business workflows

Catalogue navigation supports make → model → variant → year/engine → category → diagram. Manually defined callouts synchronize selection with table rows. Number-first search returns reference parts separately from My Products. Reference details show numbers, cross references, fitments, diagrams and source information. An adopted product links back to its reference and exposes the existing inventory, sales, purchases and document tabs.

The original conceptual headlamp drawing has three callouts and three components with multiple identifiers; a second original drawing (engine filtration/intake assembly) has eight. Neither is a real manufacturer drawing or a verified fitment. No OCR-derived geometry is used.

## EPC data model: callout number vs. OEM part number

This is the single most important modeling rule in the catalogue: a diagram callout/reference number (`DiagramCallout.display`, e.g. `"15601"`) is never the same field as an OEM/OE part number (`ReferenceNumber.original`, e.g. `"DEMO-15601-0T001"`), even when the demo data deliberately embeds the callout digits inside the OEM string for realism. The chain is:

```
CatalogueDiagram
  -> DiagramCallout (display, normalized, x/y/width/height, quantity)
      -> CataloguePart (description, position, provenance)
          -> ReferenceNumber[] (original, normalized, type, applicability, primary)
```

A callout's `partIds` points to exactly one `CataloguePart`, but that part may carry more than one `ReferenceNumber` of type `OEM_OE` — e.g. two numbers with different `applicability` text for different production windows, linked by a `SUPERSEDES` `CrossReference`. The UI never collapses these into one value; `ReferenceCatalogue.tsx`'s parts table shows "N variants available" with an expand toggle, and the inline selected-callout panel always lists every OEM number with its applicability.

`DiagramCallout.normalized` is deliberately **not** added to `ReferenceRepository`'s exact-match `numberIndex` (built only from `ReferenceNumber.normalized`), so a bare callout search never carries the false implication of being a globally unique OEM identifier — callout numbers can and do repeat across unrelated diagrams. A callout is reachable reliably only in its actual context (open its diagram, or reach it from a part's "Diagrams" tab, which now returns the specific `{ diagram, callout }` pair via `ReferenceDetail.diagrams`), never by treating the bare number as a lookup key.

## CSV workflow

Download `/catalogue-example.csv` or supply a permitted CSV. Owner/Administrator opens Catalogue Administration → Import Batches, uploads, maps columns and confirms internal usage permission. Validate and stage creates a tracked batch. Inspect source/fitment values, validation issues, duplicates and existing-source warnings. Exclude conflicts or reject the batch. Approve import publishes valid rows only. Failed or uncommitted batches can retry validation; completed batch publication is idempotent.

CSV maximum: 2 MB, 1,000 rows, 50 columns and 4,096 characters per field. Handles escaped quotes, BOM and quoted newlines. Rejects formulas, control characters, unsafe URLs, invalid year ranges, invalid types, inconsistent column counts and conflicting identities. External URLs are stored as metadata only; no server-side retrieval occurs. Imported descriptions render as text, never HTML.

Dedupe identity includes provider, source record ID (or normalized identifier), manufacturer, catalogue and vehicle context. Exact repeated identifiers are skipped. Multiple identifiers may share a component. Conflicting source identities are reviewed rather than merged. Publish uses revision checks and never accesses company data.

## Rights and historical data

Only COMPANY_OWNED, LICENSED_FOR_DISPLAY and MANUFACTURER_AUTHORIZED reference images render. Unknown, external-only, internal-only and do-not-republish images show a placeholder. Rights evidence/review time is separate from original attribution. Nengun is registered but disabled; its terms and access review are in NENGUN_SOURCE_REVIEW.md. Copied legacy diagram/public exports were removed, and the exporter fails closed. Legacy source transcription remains only for migration tests; it is no longer automatically added to company state. Already saved business records, user images and movements are preserved; the known unlicensed image URL is suppressed.

## Deployment boundaries

Reference persistence: `.catalogue-data/reference-v1.json`, atomic file replacement within one local process. Company state: existing browser storage. This is a replaceable development backend, not distributed infrastructure or a production database. The browser receives bounded reference results rather than the full catalogue. Real high-volume data requires the platform's indexed storage, authenticated permission context and concurrency controls.

`src/catalogue/server.ts` caches the repository instance on `globalThis` so it survives Next.js dev-mode hot-module-reload; this also means a **running dev server keeps serving whatever seed shape was loaded at process start**, independent of later edits to `seed.ts`, until the process restarts. `ReferenceState.schema` (`referenceSchemaVersion` in `models.ts`) guards the _file_ against staleness — a persisted snapshot whose `schema` doesn't match the current version is discarded and reseeded — but it cannot invalidate the in-memory singleton. Bump `referenceSchemaVersion` whenever `seed.ts`'s shape changes, and restart the dev server (not just delete `.catalogue-data/reference-v1.json`) to see the change locally.

The demo persona is retained across reloads. Administrative UI and commands reject Sales/Storekeeper roles, but the local role header is intentionally only a simulation. Do not expose this demo as a public authenticated service.

## Tests

`npm run typecheck`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e`.
No separate ESLint or dependency audit gate existed in the project; formatting is its established lint-style check. Playwright uses port 3100, `.next-e2e` and `.catalogue-test-data`, isolated from the normal local app.
