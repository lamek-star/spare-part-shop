# Admin catalogue warm-up / import

A controlled way to pre-resolve a specific, operator-supplied list of
Toyota OEM part numbers into the private IntraForge catalogue (see
`docs/CATALOGUE_STORAGE.md`) while online, so the site keeps working for
exactly those parts once offline. This is **not** a bulk-scrape
mechanism — see "Do not" below.

## Workflow

```
Owner/Administrator persona
  → Catalogue → Import / Warm Up
  → single part number, pasted list, or CSV upload
  → Start import
  → job runs in the background, one part at a time, rate limited
  → per-item result: IMPORTED / ALREADY AVAILABLE / NOT FOUND /
    PROVIDER ERROR / RESTRICTED / INVALID INPUT
  → job saved to Import History; Offline Readiness shows real counts
```

## Files

| File                                        | Role                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/catalogue/importParsing.ts`             | Pure, browser-safe: `ImportLine`, `parseImportLines`, `importLinesFromCsv`. No `node:fs` — importable from client components. |
| `src/catalogue/importStore.ts`               | File-backed job history + the "offline readiness" observation index (`.catalogue-import-data/`, dev-only, same pattern as `src/catalogue/server.ts`). |
| `src/catalogue/importRunner.ts`              | Orchestration: `startImportJob`, `retryFailedItems`, batching/rate limiting. Re-exports importParsing.ts's helpers for server-side callers. |
| `src/app/api/catalogue/route.ts`             | `import-start` / `import-cancel` / `import-retry` (POST), `import-jobs` / `import-job` / `import-overview` (GET) — all gated by `isCatalogueAdmin(role)`. |
| `src/components/CatalogueImportAdmin.tsx`    | The admin page — mounted at Catalogue → "Import / Warm Up" in `Workspace.tsx`.                          |

## Why this is not "bulk scraping"

`importRunner.ts` resolves each part through the **exact same** functions
the ordinary search cache-miss path already uses one at a time —
`searchOemPart` → `resolveToyotaOemPart` → `importOemPart` (see
`src/app/api/catalogue/route.ts`'s `oem-search` action and
`docs/CATALOGUE_STORAGE.md`). The only thing this feature adds is
orchestration over an **explicit, operator-supplied, bounded list**
(hard cap: 500 items per job — `MAX_IMPORT_ITEMS`), processed strictly
sequentially (never in parallel) with a delay between requests and a
longer cooldown every `batchSize` items. Nothing here calls
`providerPolicy.ts`'s `assertBulkSyncAllowed` / `catalogue/sync.ts`'s
whole-catalogue sync path — that governs a different store (this app's
own `ReferenceCatalogue`) and stays exactly as unreachable as it was.

There is no "discover more parts" or "crawl this vehicle/diagram" mode —
only parts the operator explicitly typed, pasted, or uploaded are ever
touched.

## Batch control

- **Batch size** (default 5, max 25): after every N items, a cooldown of
  `2 × delayMs` is inserted (on top of the per-item delay).
- **Delay between requests** (default 750ms, min 200ms, max 10s):
  inserted between items that actually made a network call (a pure
  cache hit doesn't wait).
- **Retry policy**: handled at the HTTP transport layer already —
  `src/integrations/catalogues/toyota-epc/transport.ts`'s existing
  bounded retry-with-backoff for 429/5xx (2 retries, 250ms/500ms
  backoff). The import runner does not add its own retry loop; a failed
  item is recorded as `PROVIDER_ERROR` and can be re-run via "Retry
  failed items", which starts a **new** job containing only the
  `PROVIDER_ERROR` / `NOT_FOUND` / `RESTRICTED` items from the prior job.
- **Timeout**: inherited from the same transport (8s) and from
  `intraforge-storage/client.ts`'s own 8s `AbortSignal.timeout`.
- **Progress**: the job document accumulates `items[]` as it goes;
  `GET ?action=import-job&id=...` is safe to poll (the admin UI polls it
  every 1s while the job is `PENDING`/`RUNNING`).
- **Cancel**: `POST {action:"import-cancel", id}` sets a flag the runner
  checks before starting each next item — in-flight items still finish,
  no partial item is left inconsistent. True pause/resume across a
  server restart was not built (the job runner is an in-process
  background task, matching this app's existing "development-only
  single-process store" pattern elsewhere) — see Known limitations.

## Result statuses

| Status | Meaning |
| --- | --- |
| `IMPORTED` | Not cached; resolved via Toyota EPC and persisted to IntraForge. |
| `ALREADY_AVAILABLE` | Already present in IntraForge — no write made, existing record left untouched. |
| `NOT_FOUND` | Toyota EPC was queried but had no match. |
| `PROVIDER_ERROR` | A lookup or persist call threw (network/HTTP failure). |
| `RESTRICTED` | Not cached, and could not be resolved — the provider is disabled (`TOYOTA_EPC_ENABLED` unset) or this job's "resolve via provider" checkbox was off (cache-only check). |
| `INVALID_INPUT` | The line didn't normalize to a plausible OEM number (e.g. empty, or non-alphanumeric after normalization). |

Job-level counters (`imported_count`, `already_available_count`,
`not_found_count`, `error_count`) roll `PROVIDER_ERROR`/`RESTRICTED`/
`INVALID_INPUT` into `error_count`; the full per-item detail (with the
precise one of the six statuses) is always in `items[]`.

## CSV format

Minimum: a `part_number` column. Optional: `manufacturer`, `notes`,
`internal_sku` — carried through per row for display only; there is no
field on the IntraForge `OEMPart`/`Diagram`/`DiagramPart` models yet to
persist them (see `docs/CATALOGUE_STORAGE.md`'s data model) — a natural
follow-up once a real need for them appears.

## Offline readiness

`GET ?action=import-overview` returns real counts derived from this
app's own **observation index** (`importStore.ts`'s `offlineIndex`,
updated whenever a search or import actually sees a part from
IntraForge) — not a live count against IntraForge's full table, because
`catalogue_storage` exposes search/import endpoints only, no
listing/count endpoint. Every number shown (cached parts, diagrams,
callouts, parts with hotspot data) is something this app has actually
observed, never estimated or extrapolated.

## Image rule (unchanged)

Exactly the same licensing posture as the rest of this integration:
metadata (diagram code, source image URL, callout, hotspot rect,
provenance) is always recorded; the actual image bytes are never
fetched or stored by this path. `Diagram.license_status` stays
`EXTERNAL_REFERENCE_ONLY` for every ordinary import — nothing in this
feature can promote it to `LOCALLY_STORED` (that still requires a
separately-licensed import on the IntraForge side, per
`docs/CATALOGUE_STORAGE.md`). If a licensed image package is added
later, the existing records attach to it the same way any other
`Diagram` row would.

## Authorization

Every `import-*` action requires `isCatalogueAdmin(role)` — the
`x-demo-role` header's role must be `Owner` or `Administrator` (same
gate as the existing `providers` admin action), enforced server-side in
the route handler, not just hidden in the UI.

## Known limitations / deferred

- **Pause/resume across a server restart** — not built; only cancel
  (which is safe and immediate-ish). The job runner is in-process, same
  constraint as `src/catalogue/server.ts`'s existing dev store.
- **CSV's `manufacturer`/`notes`/`internal_sku` are not persisted** —
  no IntraForge field exists yet for them.
- **Offline-readiness counts are an observation log, not a live
  IntraForge query** — see "Offline readiness" above.

## Whole-figure import (added after the first release)

A single part number used to cache only that one number, so searching it
showed one line instead of the drawing's parts list. Now the resolver
(`intraforge-storage/toyotaResolver.ts`) keeps the **entire figure** it
just fetched — it was already downloading it — and `importFigure`
(`POST /api/v1/catalogue/diagrams/import/` on IntraForge) stores:

- a display snapshot on the `Diagram` (`figure_data`: hotspots, one group
  per callout, every production/fitment line with dates, ended flag,
  fitment codes and the "note" marker), and
- every distinct number on it as a searchable `OEMPart` + `DiagramPart`
  (callout and hotspot rect), so any number on the drawing can be
  searched offline, not just the one asked for.

Still bounded: one search, one sections lookup, one figure fetch (plus at
most two more figures via the part's own group when the number is not on
the section's primary drawing). No crawling. A part cached before this
change is upgraded by re-running it through a job with provider lookup on
(result `IMPORTED`, "its full figure … was added"); with the provider off
it stays `ALREADY_AVAILABLE`.

The search page (`OEMPartSearch.tsx` → `OEMFigureViewer.tsx`) renders that
snapshot as a parts-catalogue page: drawing with clickable callout boxes,
a filter, "N parts on this figure", groups by callout, part number /
description / dates / ended / fitment chips / stock-or-price / Add. Add
requires sign-in and puts the number in the enquiry, like before.

### The drawing image

Nothing is downloaded or stored. When the diagram is not locally stored,
the drawing is shown only if `CATALOGUE_SHOW_EXTERNAL_DIAGRAMS=true`
(server env, default off): the visitor's browser then loads the image
straight from the source's URL with the source credited on screen. The
source's own legal notice disclaims a redistribution licence, so turning
this on is a deliberate decision — it is on in `.env.local` for local
development only. With it off the viewer shows the full parts list and a
link to open the drawing at its source. A locally stored, permission-
confirmed image always wins and is unaffected by the flag.

## Drawings from local files, and choosing the vehicle

**Local drawings.** A folder of saved catalogue pages (`<figure key>.png`
files, e.g. `MA4481A.png`) can be attached to catalogue diagrams so they
are shown from IntraForge's own storage — no dependence on the source
website. On the IntraForge side:

```
python manage.py import_diagram_images --dir <folder> --license-confirmed [--dry-run]
```

It refuses to run without `--license-confirmed` (storing the bytes is an
explicit decision by someone who may use the files), matches files to
diagrams by figure key, creates the diagram if no part is on it yet (so
the picture is already there when a part is imported later), skips
anything that is not really a PNG/JPEG, and is idempotent. The app shows
such a drawing through `GET /api/catalogue/diagram-image?id=…`, a proxy
that keeps the IntraForge credential on the server and only ever serves
diagrams IntraForge itself marks as locally stored. A stored drawing is
preferred over the external-display flag.

**Choosing the vehicle.** The same part is drawn on many vehicles' figures.
A line in a pasted list may name the catalogue code —
`15600-25010, 221230` — and a CSV may carry a `catalogue` column; the
resolver then takes that vehicle's drawing (and a wrong code is
`NOT_FOUND`, not a guess). A cached part with a catalogue named gets that
drawing added. A part drawn on several figures shows a switcher above the
viewer, opening on one whose picture is stored.
