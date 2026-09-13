# Spare parts EPC/catalogue architecture

Snapshot as of 2026-09-13, branch `codex/spareparts-reference`. Covers the
Toyota EPC integration added on top of the existing reference-catalogue
feature (see [catalogues/FOUNDATION.md](catalogues/FOUNDATION.md) for the
callout/OEM-number data model that predates this work and is reused,
unmodified, throughout).

## Architecture

```
External provider (Toyota EPC aggregator, or a future licensed feed)
       ↓
Provider adapter (src/integrations/catalogues/toyota-epc/)
  transport.ts  — guarded HTTP (SSRF-safe URL build, timeout, retry, 429-aware, logs)
  types.ts      — raw response shapes, verified against real captures
  mapper.ts     — pure functions: raw shapes → normalized catalogue model
  provider.ts   — ToyotaEpcProvider, implements CatalogueProvider + a richer native surface
  config.ts     — TOYOTA_EPC_ENABLED feature flag (default false)
       ↓
Provider governance (src/catalogue/providerPolicy.ts)
  ProviderCapabilities — what the provider can technically do
  ProviderLicense       — what it is actually permitted to do (enforced server-side)
       ↓
Internal API (src/app/api/catalogue/route.ts, action=toyota-*)
  returns { disabled: true, reason, capabilities, license } instead of an
  error when the provider is off — the frontend renders a clean state,
  not a failure banner
       ↓
Frontend (src/components/ToyotaEpc.tsx, ExplodedDiagramViewer.tsx)
```

This sits **beside**, not inside, the existing reference-catalogue stack
(`src/catalogue/repository.ts`, `ReferenceRepository`, the JSON-file dev
store in `src/catalogue/server.ts`). The two are intentionally not merged:
the reference catalogue is this application's own persisted data (original
demo fixtures, CSV imports); the Toyota provider is a live, read-through
lookup against a third party that this application does not own and, as of
this snapshot, has no redistribution rights to persist. `docs/DATA_MODEL.md`
and `catalogues/FOUNDATION.md` describe the former; this document describes
the latter and how the two meet at the shared normalized model
(`src/catalogue/models.ts` — `VehicleMake`, `VehicleModel`, `VehicleVariant`,
`Catalogue`, `Category`, `CatalogueDiagram`, `DiagramCallout`,
`CataloguePart`, `ReferenceNumber`, `CrossReference`, `ReferenceFitment`,
plus the additions below).

### Model additions made for this work (all additive — nothing existing changed shape)

- `DiagramCallout.rect` — a pixel-space `{x1,y1,x2,y2}` box, alongside the
  existing percentage `x`/`y`/`width`/`height` used by hand-authored demo
  diagrams. `DiagramCallout.resolved` marks the ~18% of Toyota hotspots that
  point at a standard fastener with no parts-list entry behind them —
  producing a callout with an empty `partIds` rather than a fabricated part.
  `DiagramCallout.keyType` is an opaque passthrough of the provider's own
  classification.
- `CataloguePart.specifications?: Record<string,string>` — for a provider
  that supplies structured specs. Unused by Toyota today: its `parts`
  endpoint carries a `has_remarks` boolean but no remarks _text_ field is
  documented, so nothing is fabricated into this field — see
  `ProviderCapabilities.supportsSpecifications: false` for Toyota.
- `ReferenceFitment.attributes?: {code, meaning?, attribute?}[]` — a
  provider's raw fitment/option codes, kept alongside (not folded into) the
  normalized `engine`/`chassis`/etc. fields, since they are frequently
  opaque (see "What the data does not contain" below).
- `VinLookupResult` / `VinMatch` — a new top-level type, provider-scoped: a
  VIN match is only ever what that provider's own data recorded.

## Toyota provider

### What was verified, not assumed

Before writing any adapter code, the live API at
`https://toyota-epc.aftermarketcatalog.com/api/v1` was queried directly
(`curl`, ~15 real GET requests, well under its own 120 req/min limit) and
the actual responses saved as fixtures in `tests/fixtures/toyota-epc/` (see
that directory's `README.md` for the exact endpoint → file mapping). Every
field in `types.ts` and every mapping in `mapper.ts` traces back to one of
those captures or the service's own `/api/v1` self-description — nothing
was inferred from the HTML documentation alone. `tests/live/toyota-epc.live.test.ts`
re-verifies four of these calls against the live service on demand
(`npm run test:live`, requires `TOYOTA_EPC_ENABLED=true` and network
access) so a future upstream schema change is caught deliberately rather
than silently.

### Endpoints used

| Native method                               | Endpoint                                             | Normalized into                                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRegions`                                | `GET /api/v1/regions`                                | (region picker)                                                                                                                                                                                               |
| `getModels`                                 | `GET /api/v1/regions/{region}/models`                | `VehicleModel[]` (list)                                                                                                                                                                                       |
| `getModel`                                  | `GET /api/v1/regions/{region}/models/{slug}`         | `VehicleMake` + `VehicleModel` + `VehicleVariant[]` (one per catalogue)                                                                                                                                       |
| `getSections`                               | `GET /api/v1/catalogs/{region}/{code}/sections`      | `Category[]` + a diagram stub per section's `primary_figure`                                                                                                                                                  |
| `getFigure`                                 | `GET /api/v1/catalogs/{region}/{code}/figures/{key}` | `CatalogueDiagram` + `DiagramCallout[]` + `CataloguePart[]` + `ReferenceNumber[]` + `ReferenceFitment[]` — one call returns the image metadata, every hotspot rect, **and** every part line on those hotspots |
| `getPartNumber`                             | `GET /api/v1/part-numbers/{n}`                       | `ReferenceDetail`-shaped part + applications                                                                                                                                                                  |
| `getPartNumberHistory` / `getSupersessions` | `GET /api/v1/part-numbers/{n}/history`               | supersession edges (`chain`/`superseded_by`, not `substitutes` — see mapper doc comment)                                                                                                                      |
| `lookupVin` / `lookupVIN`                   | `GET /api/v1/vin/{vin}`                              | `VinLookupResult`, deduplicated (the source repeats the same match row)                                                                                                                                       |
| `search`                                    | `GET /api/v1/search`                                 | unified OEM/model/part-name search results                                                                                                                                                                    |

### What the API does not contain (and the mapper never invents)

Per the API's own `/api/v1` self-description and confirmed in every
fixture: `quantity` is always `null` — the source catalogue records which
parts a vehicle takes, never how many, so no diagram callout in this
application shows a fabricated quantity for Toyota data (contrast with the
original demo diagrams, which do carry an authored quantity). `price` only
exists for the Japanese dataset; every other region's `prices` array is
empty and this application does not display Toyota prices anywhere
regardless (out of scope by design — see "No prices from EPC providers").
`resolved: false` hotspots are real — not a mapping gap. Fields under an
`unverified` key are read from the record layout but confirmed by no
published legend, and are not surfaced in the UI.

### No prices from EPC providers

The feature deliberately never renders a price for Toyota (or any future
EPC-shaped provider) data. Actions are **Copy OEM Number**, **Add to
Enquiry**, **Request Quote**, **View Compatibility** — never "Add to Cart"
or a price. See "Enquiry vs. Quotations" below for why this needed a new,
small domain object rather than reusing the existing priced order flow.

## Caching strategy

There is deliberately **no cache** beyond the browser's own HTTP cache and
whatever `fetch` does by default. Every `ToyotaEpcProvider` method is a
single live request, mapped straight into the response — there is no
in-memory or on-disk store for Toyota records anywhere in this codebase.
This is not an oversight: see "Catalogue Data Licensing" below for why a
persistent cache would already constitute the kind of reproduction the
source's own terms do not license, and `providerPolicy.ts`'s
`persistentStorageAllowed: false` for `toyota-epc` is the enforced version
of that decision. If a future licensed provider permits it, a cache layer
would sit between `transport.ts` and `mapper.ts`, keyed by request path,
respecting the source's own `Cache-Control: public, max-age=3600` header —
not built now because nothing may legitimately use it yet.

## Image handling

`imageStorageAllowed: false` for `toyota-epc` (`providerPolicy.ts`). The
mapper never puts a Toyota illustration URL into `CatalogueImage.url` — it
stays `""` (matching the existing `EXTERNAL_REFERENCE` / `canDisplayImage()`
pattern already used by the Nengun provider), with the real source URL
recorded only in `attribution` text, never rendered as an `<img src>`.
`ExplodedDiagramViewer` handles this explicitly: when `imageUrl` is empty
but hotspots carry real pixel `rect`s, it renders a wireframe of the actual
verified geometry (scaled to the hotspots' own bounding box) instead of the
underlying artwork — proving the coordinate pipeline is correct without
reproducing anyone's illustration.

## Part-number normalization

Reused unchanged from the existing reference catalogue:
`domain/models.ts`'s `normalizeNumber` (`value.toUpperCase().replace(/[\s-]/g, "")`)
already collapses `"90915-20004"`, `"9091520004"` and `"90915 20004"` to the
same key, which is exactly the format Toyota part numbers arrive in
(`part_number` vs. `part_number_display`). No Toyota-specific normalization
was needed or added — see `tests/toyota-epc-mapper.test.ts`,
"Toyota part-number formats normalize to the same key as OEM number search
elsewhere."

## Search

`GET /api/v1/search?q=` is a unified VIN/part-number/model/part-name search
on Toyota's side; `ToyotaEpcProvider.searchParts` maps its `part_numbers`
results into `ReferenceHit`-shaped stubs. It is a separate code path from
the local `ReferenceRepository.search()` (normalized-number index over
first-party data) — the two are not merged, since one is a live remote
call and the other an indexed local lookup with very different performance
and failure characteristics; the frontend calls whichever is appropriate
for the page it's on (Reference Catalogue vs. Toyota EPC).

## Vehicle selection

Make is fixed (Toyota); model is a searchable/filterable list fetched once
per region (`~100–400` entries, ~26KB — not "millions of rows in a
dropdown," and filtered client-side as the user types); picking a model
fetches its catalogues/variants (a handful per model); picking a variant
fetches its sections (dozens); picking a section fetches one diagram. Nothing
in this chain loads an unbounded dataset into the browser.

## Diagram viewer

`src/components/ExplodedDiagramViewer.tsx` — zoom in/out/reset, fullscreen,
drag-to-pan once zoomed (native touch-scroll covers mobile), loading/error
states, and hotspot rendering in either percentage space (the original demo
diagrams) or pixel-rect space (Toyota). It is a new, separate component
from the existing `ReferenceCatalogue.tsx` diagram viewer — deliberately
not refactored into it, to avoid risking regressions in that already-tested
flow (11 pre-existing e2e assertions) for a feature the two don't actually
need to share beyond visual style.

## Compatibility

Toyota's per-application data (`applications`/`fitment` in the raw
responses) maps to `ReferenceFitment`, one row per catalogue the part is
recorded against, each with its own production-date range — genuinely
verified against 2026-09-13 captures showing e.g. a single OEM number
applicable across Corolla, Auris and Avensis catalogues with different
year ranges each (see the "Vehicle compatibility" table in
`ToyotaEpc.tsx`'s part panel).

## VIN strategy

Toyota's aggregator genuinely supports VIN/frame-prefix lookup
(`GET /api/v1/vin/{vin}`) — verified live, not assumed; see
`tests/live/toyota-epc.live.test.ts`. `ProviderCapabilities.supportsVinLookup`
is `true` for `toyota-epc`. A provider that does not support it would
report `false` there and the frontend would hide the VIN box rather than
render a fake lookup — `ProviderCapabilities` exists specifically so this
is a capability check, not an `if (providerKey === "toyota-epc")` special
case. No VIN fragment is ever used to infer compatibility client-side; a
result is exactly the (deduplicated) set of catalogues the source itself
returned for that prefix.

## Catalogue Data Licensing & Provider Governance

**Why public API accessibility is not the same as redistribution
permission.** `aftermarketcatalog.com/api` is unauthenticated, CORS-open,
rate-limited (not gated) at 120 req/min, and explicitly invites
programmatic GET access ("Everything on this site is available as JSON. No
key, no sign-up, no write methods."). That is a statement about _access_.
Its `/legal` page is a separate statement about _rights_: "Catalogue
content remains the intellectual property of its owner. This site presents
it for identification and reference; it is not a licence to reproduce or
redistribute the underlying data or illustrations." The site itself is an
independent aggregator, not Toyota Motor Corporation, and its own
presentation of this data already rests on a reference/identification
theory it does not extend into a redistribution grant for anyone building
on top of it.

**API access vs. redistribution rights, concretely, in this codebase:**
a single live lookup rendered to one user in response to their own query
(what `ToyotaEpcProvider` does today) is materially different from
downloading the catalogue into this application's own permanent store and
serving it to every visitor indefinitely (what the original task
description's migrations/sync-jobs/cached-images design would have been).
The former is closer to what the source's own terms contemplate
("presents it for identification and reference"); the latter is exactly
what "reproduce or redistribute" describes. This codebase currently only
implements the former, and the guards in `providerPolicy.ts` exist to keep
it that way structurally, not just by convention.

**Temporary caching vs. permanent mirroring.** No caching layer exists for
Toyota data in this codebase at all (see "Caching strategy" above) — so
there is no live "temporary cache" to distinguish from a mirror today. If
one is added later under a confirmed licence, the distinction that would
matter is TTL and scope: caching a response for minutes-to-an-hour to
absorb repeat requests is not the same as an unattended job that walks the
whole catalogue into a database with no expiry — the latter is
`bulkSyncAllowed`/`persistentStorageAllowed` territory and is refused by
`sync.ts` regardless of TTL.

**Image rights.** Toyota's illustrations are the manufacturer's own
factory drawings; the aggregator itself says "converted on first view and
cached afterwards" — i.e. it re-hosts its own converted copies at
`/image/figure/...` on its own domain. This application never fetches,
stores, or renders those URLs (`imageStorageAllowed: false`,
`CatalogueImage.url` withheld) — see "Image handling" above.

**Attribution.** `attributionRequired: true` for `toyota-epc`. Every
mapped record's `Provenance.sourceProvider`/`sourceUrl` and the diagram
image's `attribution` text point back to the specific source URL; the
Toyota EPC page and the admin governance panel both link to
`https://toyota-epc.aftermarketcatalog.com/legal` directly.

**Provider-specific restrictions, as data, not prose.** See
`src/catalogue/providerPolicy.ts` — every provider this application knows
about (including the first-party ones) carries a `ProviderCapabilities` /
`ProviderLicense` pair. For `toyota-epc`: `enabled: false`,
`redistributionAllowed: "UNKNOWN"`, `persistentStorageAllowed: false`,
`imageStorageAllowed: false`, `bulkSyncAllowed: false`,
`attributionRequired: true`, `licenseStatus:
"UNVERIFIED_REDISTRIBUTION_PERMISSION_REQUIRED"`. These are enforced by
`assertBulkSyncAllowed`/`assertPersistentStorageAllowed`/
`assertImageStorageAllowed`, called from `sync.ts` (the one place a future
bulk job would start) independently of the `TOYOTA_EPC_ENABLED` flag —
flipping that env var alone does not satisfy these guards; see
`tests/toyota-epc-provider.test.ts`, "setting TOYOTA_EPC_ENABLED=true alone
does not bypass the registered policy guards."

**Exactly what would need to change to enable this provider for real
users**, once written permission or a licensed replacement feed exists:

1. Obtain and record the actual permission — a reply from
   `aftermarketcatalog.com/contact?subject=rights` granting redistribution,
   or a separate licensed feed contract.
2. Update `providerPolicies["toyota-epc"]` in `src/catalogue/providerPolicy.ts`:
   `license.enabled`, `redistributionAllowed`, and whichever of
   `persistentStorageAllowed`/`imageStorageAllowed`/`bulkSyncAllowed` the
   permission actually covers (a licence to display live lookups does not
   automatically also cover bulk mirroring or image caching — set each
   flag to what was actually granted, not to `true` across the board), plus
   `licenseStatus`/`licenseReference`/`notes` describing the real
   authorization.
3. Set `TOYOTA_EPC_ENABLED=true` in the deployment environment. Per point 2,
   this flag alone still does nothing for any capability whose policy flag
   remains `false` — both must agree.
4. If `bulkSyncAllowed` was granted, implement the actual fetch → map →
   `ReferenceRepository.commit` sequence in `src/catalogue/sync.ts` (today
   it only contains the guard and a placeholder "not implemented" message
   for the case where policy permits sync but no code exists yet) —
   deliberately not written speculatively ahead of that authorization.
5. No frontend or API-route changes are required — `ToyotaEpc.tsx` and the
   `toyota-*` API actions already render the real data path once the
   provider stops reporting `disabled`.

## Security

- **SSRF**: `transport.ts` builds every request URL via
  `new URL(path, TOYOTA_EPC_BASE_URL)` and re-checks the resulting origin
  against the fixed, hardcoded host before ever calling `fetch` — a
  hostile VIN/part-number/catalogue-code value (all ultimately
  user-supplied) cannot redirect a request off `toyota-epc.aftermarketcatalog.com`.
- **Timeouts/retries**: `AbortSignal.timeout` per request; retry (max 2,
  exponential backoff) only for network errors, `429`, and `5xx` — never
  for `4xx`.
- **Secrets**: none exist for this provider (no key/token) — nothing to
  leak. `transport.ts`'s structured log lines never print response bodies.
- **Input validation / output encoding**: all Toyota response data flows
  through React's normal JSX escaping; nothing is ever `dangerouslySetInnerHTML`'d.
  `safeSourceUrl` (existing, `src/catalogue/providers.ts`) still gates any
  URL that reaches a rendered `<a href>` elsewhere in the app.
- **Error sanitization**: a disabled/failed Toyota call returns
  `{ disabled: true, reason }` with a fixed, safe message — never a raw
  stack trace to the browser (`src/app/api/catalogue/route.ts`'s
  `toyotaAction` wrapper).
- **Credentials**: N/A — no API keys, backend credentials or database
  passwords are used by this provider.

## Testing

- **Unit — mapper** (`tests/toyota-epc-mapper.test.ts`, 10 tests): pure
  functions against the real captured fixtures in
  `tests/fixtures/toyota-epc/` — callout/OEM separation, unresolved-hotspot
  handling, supersession-vs-substitute distinction, VIN deduplication,
  normalization, and the full `CatalogueDiagram → DiagramCallout →
CataloguePart → PartNumber[]` chain.
- **Unit — provider/policy** (`tests/toyota-epc-provider.test.ts`, 7 tests):
  proves no network call happens while disabled (a throwing `fetch` stub
  makes this airtight, not just "no error was thrown"), that policy guards
  refuse even when `TOYOTA_EPC_ENABLED=true`, that an unregistered provider
  is denied by default, and that `sync.ts` refuses server-side.
- **Live** (`tests/live/toyota-epc.live.test.ts`, opt-in via
  `npm run test:live`, requires `TOYOTA_EPC_ENABLED=true` and network):
  real calls confirming the live API still matches the captured shapes.
  Not part of `npm test` (`tests/*.test.ts` is not recursive, so
  `tests/live/` is excluded automatically) and not run in CI.
- **E2E** (`tests/e2e/workflow.spec.ts`, "Toyota EPC is disabled by
  default..."): confirms the production-default disabled panel, its
  capability checklist, the admin governance panel's independent
  confirmation of the same state, and that no vehicle picker/search/VIN box
  renders while disabled.
- **Manual browser verification**: performed with `TOYOTA_EPC_ENABLED=true`
  against the live API — Toyota → Corolla → `164230` (COROLLA TUP) →
  Cylinder Head section → real diagram with real hotspots (16271, 16100,
  and two correctly-unresolved fastener callouts) → part detail for
  `16271-37010` (GASKET, WATER PUMP) with real multi-model compatibility →
  Add to Enquiry → submitted enquiry cart. Then re-verified the disabled
  default renders cleanly with the env var unset.

## Adding another manufacturer/provider

See [CATALOG_PROVIDER_INTEGRATION.md](CATALOG_PROVIDER_INTEGRATION.md).

## Known limitations

- `ExplodedDiagramViewer`'s wireframe mode (used whenever a provider's
  image is withheld) approximates a bounding box from the hotspots
  themselves; a diagram with one hotspot far from the others will render
  the rest small. It is a deliberate trade-off for never reproducing
  unlicensed artwork, not a bug — see "Image handling."
- `getDiagram(id)`'s `categoryId` is not always recoverable purely from the
  diagram id (`"region/catalog/figure"`) when called outside the `browse()`
  → `getSections` → `getFigure` navigation chain that already knows the
  section; it is left empty in that case. It doesn't affect the Toyota EPC
  UI (which always has the section in hand) but would matter for a future
  caller that only has a diagram id.
- No `getVehicle`/model-level engine or transmission fields are populated
  on `VehicleVariant` for Toyota — the source's catalogue-summary object
  doesn't carry them (only per-part `fitment` codes do); left blank rather
  than guessed, per `tests/toyota-epc-mapper.test.ts`, "a catalog maps to a
  vehicle variant without inventing an engine/transmission."
- `ToyotaEpcProvider.searchParts`/`getPart` produce a best-effort
  `ReferenceHit`/`ReferenceDetail` shape for interchangeability with the
  local `CatalogueProvider` contract; the richer native methods
  (`getModels`, `getFigure`, etc., used directly by `ToyotaEpc.tsx`) are the
  primary, fuller-fidelity surface.
- No ESLint gate — consistent with the pre-existing project decision
  documented in `catalogues/FOUNDATION.md`; `npm run format:check`
  (Prettier) remains the lint-equivalent.
