# Adding another catalogue provider

This project's catalogue architecture is provider-independent by design —
see [SPARE_PARTS_CATALOG_ARCHITECTURE.md](SPARE_PARTS_CATALOG_ARCHITECTURE.md)
for the full picture. This document is the checklist for adding a new one
(another manufacturer's EPC, TecDoc, a supplier catalogue, a licensed feed,
or your own imported database), using the Toyota EPC provider
(`src/integrations/catalogues/toyota-epc/`) as the worked example.

## 1. Register its governance policy first

Before writing any adapter code, add an entry to
`providerPolicies` in `src/catalogue/providerPolicy.ts`:

```ts
"my-provider": {
  capabilities: {
    supportsVehicleLookup: true,   // set every flag to what you have actually verified,
    supportsVinLookup: false,      // not what you expect or hope the provider has
    supportsDiagrams: true,
    supportsHotspots: true,
    supportsOemNumbers: true,
    supportsFitment: true,
    supportsSupersessions: false,
    supportsSpecifications: false,
    supportsImages: true,
    supportsBulkSync: false,
    supportsPersistentStorage: false,
  },
  license: {
    providerKey: "my-provider",
    providerName: "…",
    providerType: "AGGREGATOR", // or MANUFACTURER / LICENSED_FEED / CSV / INTERNAL / OTHER
    enabled: false,              // start disabled; flip only once the checklist below is done
    redistributionAllowed: "UNKNOWN", // true only once you hold a written grant
    persistentStorageAllowed: false,
    imageStorageAllowed: false,
    bulkSyncAllowed: false,
    attributionRequired: true,
    licenseStatus: "PERMISSION_REQUIRED",
    licenseReference: "…", // a contract reference or the terms page — not a legal conclusion
    termsUrl: "https://…",
    notes: "…", // the actual finding, in your own words — see the Toyota entry for the level of detail expected
  },
},
```

An unregistered provider key is denied by every guard in this file by
default (`policyFor` falls back to a fully-denied policy) — so a provider
you haven't registered yet can never accidentally get access.

## 2. Confirm the licensing question before writing a transport

Read the provider's actual terms of use, not just its API documentation.
The question that matters is not "can I technically call this" but "does
its own terms grant _this application_ the right to reproduce/redistribute
its data" — see "Catalogue Data Licensing & Provider Governance" in the
architecture doc for the reasoning that produced Toyota's answer
(`redistributionAllowed: "UNKNOWN"`, everything else `false`, live-lookup
only). If the terms are silent or ambiguous, treat it the same as "no" —
`"UNKNOWN"` is not `true`.

If the provider disallows automated access entirely (robots.txt, terms
explicitly prohibiting scraping), follow the Nengun pattern instead: no
transport implementation at all — `src/integrations/catalogues/nengun/provider.ts`'s
`unavailable()` throws before any network attempt regardless of
configuration, because there is nothing it is currently permitted to try.

## 3. Verify the real API before modeling it

Do not write `types.ts` from documentation alone. Make a handful of real
requests (respecting the provider's own rate limits) and save the actual
responses as fixtures — see `tests/fixtures/toyota-epc/README.md` for the
pattern: one fixture file per representative endpoint, trimmed for size
without editing any field, with a table mapping each file back to the
exact request that produced it. Every field in your `types.ts` should trace
to one of these captures.

## 4. Build the adapter package

Mirror `src/integrations/catalogues/toyota-epc/`:

- `config.ts` — a `MY_PROVIDER_ENABLED` env flag (default `false`) plus any
  runtime config (base URL, timeouts, retry count).
- `types.ts` — raw response shapes, verified per step 3.
- `transport.ts` — guarded HTTP: build every URL via `new URL(path, BASE_URL)`
  and check the resulting origin against the fixed base URL before
  fetching (SSRF); explicit timeout; bounded retry with backoff, only for
  transient failures (network errors, 429, 5xx — never 4xx); structured
  logging that never prints response bodies or secrets.
- `mapper.ts` — pure functions, no network/filesystem access, translating
  raw shapes into the shared model (`src/catalogue/models.ts`). Never
  synthesize a field the source doesn't actually provide (a quantity, a
  price, an engine code) — leave it absent/blank and say so in a comment,
  the way `mapToyotaCatalogToVariant` does for engine/transmission.
- `provider.ts` — a class implementing `CatalogueProvider`
  (`src/catalogue/providers.ts`): `capabilities` (from `capabilitiesFor(key)`),
  `searchParts`, `getPart`, `browse`, `getDiagram`, and optionally
  `lookupVin`. Every method must check the enable flag **before any network
  call** — `ToyotaEpcProvider`'s `guard()` is the pattern; it must be the
  very first thing every method does.
- `index.ts` — barrel export.

## 5. Never let the frontend depend on your provider's raw shapes

UI components consume the shared normalized model and
`ProviderCapabilities`, never a provider-specific type. If your new
provider doesn't support VIN lookup, the frontend should check
`provider.capabilities.supportsVinLookup` and hide that control — not grow
an `if (providerKey === "my-provider")` branch. `ToyotaEpc.tsx`'s disabled
panel renders its capability checklist from exactly the same `capabilities`
object the enabled path would use, which is what keeps the two paths
honest with each other.

## 6. Wire the internal API actions

Add `action=my-provider-*` cases to `src/app/api/catalogue/route.ts`,
following the `toyotaAction()` wrapper pattern: catch a "disabled" error
and return `{ disabled: true, reason, capabilities, license }` with a
normal 200, rather than letting it fall through to the generic error path.
This is what lets the frontend render a clean disabled state instead of an
error banner.

## 7. Respect the storage/sync guardrails — don't route around them

`src/catalogue/sync.ts` is the one legitimate entry point for a future
bulk/scheduled job. It calls `assertBulkSyncAllowed`/
`assertPersistentStorageAllowed` before doing anything, unconditionally —
do not add a second sync path that skips these calls. If your provider's
policy has `bulkSyncAllowed: false` (the correct default for anything not
yet under written permission), `syncCatalogueRecord` will refuse before any
work happens, regardless of what the admin UI or an env var says.

## 8. Tests

- Mapper unit tests against real captured fixtures (step 3) — see
  `tests/toyota-epc-mapper.test.ts` for the shape: one test per mapping
  function, plus explicit tests for edge cases the fixtures showed you
  (Toyota's unresolved hotspots, repeated VIN matches, supersession vs.
  substitute).
- Provider/policy tests proving no network call happens while disabled
  (stub `fetch` to throw, so a wrongly-attempted call fails loudly rather
  than silently), and that policy guards hold even if the enable flag is
  set — see `tests/toyota-epc-provider.test.ts`.
- If the provider has a genuinely live, low-risk read (like Toyota's
  public, unauthenticated API), add an opt-in live test under
  `tests/live/` (excluded from `npm test` automatically, since that glob
  isn't recursive) with its own `npm run test:live`-style script, guarded
  by `{ skip: !enabled }` on every test.
- Extend the e2e disabled-state test (`tests/e2e/workflow.spec.ts`) for
  your provider's own page/panel, and its entry in the admin "Catalogue
  Providers" tab.

## 9. Documentation

Add your provider to the "Catalogue Data Licensing & Provider Governance"
section of `SPARE_PARTS_CATALOG_ARCHITECTURE.md` with the same level of
detail as the Toyota entry: what was verified, what the terms actually
say, which capability/license flags are set and why, and the exact steps
that would flip it on for real users.

## What you should not need to change

- The shared model (`src/catalogue/models.ts`) — extend it additively if a
  genuinely new concept shows up (as this work did for `DiagramCallout.rect`,
  `resolved`, `CataloguePart.specifications`, `ReferenceFitment.attributes`),
  never by repurposing an existing field to mean something provider-specific.
- `ExplodedDiagramViewer.tsx` — already handles both percentage- and
  pixel-rect-positioned hotspots, and an image-withheld wireframe mode.
- The `Enquiry` domain (`domain/models.ts`, `services.enquiries`) — the
  price-free "request a quote" cart is provider-agnostic; every EPC-shaped
  provider's part panel can call `services.enquiries.addItem` the same way
  `ToyotaEpc.tsx` does.
