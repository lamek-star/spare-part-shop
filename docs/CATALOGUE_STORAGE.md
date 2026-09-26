# Simplified OEM catalogue (IntraForge-backed)

The actual business workflow this project needs, per the explicit
"Simplify the Toyota/OEM integration" decision: **not** a full EPC
clone. Just:

```
OEM part number search → matching part → its diagram/callout → ADD
  → customer's enquiry (cart) → REQUEST QUOTE
  → staff sets price → QUOTATION → SALES ORDER → INVOICE
```

This is a _separate, additive_ integration from the live Toyota EPC
pass-through (`ReferenceCatalogue.tsx`, `src/integrations/catalogues/
toyota-epc/`) — that one stays exactly what it was: a live,
never-persisted, unlicensed-for-storage read-through to a third party.
This one is this app's own **private, permitted** catalogue, actually
stored (Postgres metadata + object storage images) in IntraForge, via
the new `catalogue_storage` Django app there.

## Data model

`docs/INTRAFORGE_OIDC_PROVIDER.md`'s sibling on the IntraForge side —
see `catalogue_storage/models.py` there for the authoritative source.
Summary:

- **OEMPart** — `manufacturer`, `part_number` (display format, e.g.
  `15690-65010`), `normalized_part_number` (search format,
  `1569065010`, unique+indexed), `description`. Answers "what part is
  this" only — no price, cost, or stock field exists here.
- **Diagram** — one row per provider diagram (`provider` +
  `provider_diagram_id` unique together), `source_image_url`,
  `license_status` (`EXTERNAL_REFERENCE_ONLY` or `LOCALLY_STORED`), and
  an optional FK to a real `storage.FileObject` once local storage is
  actually permitted. **Stored once, linked to every part drawn on
  it** — never duplicated per part.
- **DiagramPart** — the many-to-many join: `callout`, and real
  `x`/`y`/`width`/`height` only when the provider actually supplied
  them (never fabricated — see "First end-to-end proof" below).

## Why a new IntraForge app, not the generic App Platform

`docs/SPARE_PARTS_INTEGRATION_READINESS.md` (IntraForge repo) already
found the generic no-code App Platform "ready" for this. It was not
used here: App Platform schema authoring (creating models/fields) is
human-session-only by design — no automated, reproducible way to seed a
template/instance from a migration, which every other piece of this
project's IntraForge integration (the OAuth client, this catalogue) has
deliberately been. A small, purpose-built Django app (mirroring
`oauth_provider`'s own pattern) with plain Postgres models, migrated and
seeded like anything else in this codebase, was the simpler, equally
correct choice — matches the explicit "simplify" instruction this whole
feature is named for.

## Search

`normalize_part_number` (implemented identically in both
`catalogue_storage/models.py` and `src/domain/models.ts`'s existing
`normalizeNumber`): strip spaces/dashes, uppercase. `15690-65010`,
`1569065010`, and `15690 65010` all resolve to the one stored row.
Exact match only — no fuzzy search, matching the actual requirement.

## Image handling

`Diagram.license_status`:

- **`EXTERNAL_REFERENCE_ONLY`** (default, and the only status any
  ordinary import produces) — `source_image_url` + full provenance
  recorded; no bytes ever fetched or stored. The frontend shows a
  placeholder + attribution, never the image itself.
- **`LOCALLY_STORED`** — only reachable via
  `catalogue_storage/services.py:attach_local_image`, called only by an
  import run with `--license-confirmed` (see Importer below). Serves
  through `GET /api/v1/catalogue/diagrams/{id}/image/` on the IntraForge
  side, streamed through the backend (same reasoning as
  `storage.views.FileDownloadView`: the object storage endpoint is an
  internal Docker DNS name).

Nothing in this codebase can silently promote a diagram from the first
status to the second — see the importer's own refusal-by-default
behavior below.

## Importer

`python manage.py import_oem_catalogue --csv parts.csv --provider
toyota-epc --manufacturer Toyota` (IntraForge side,
`catalogue_storage/management/commands/import_oem_catalogue.py`).
CSV columns: `part_number,description,diagram_code,callout,
image_filename`. Idempotent (re-running updates in place, via each
model's own real unique constraint — never duplicates). `--dry-run`
validates and reports counts without writing. Image bytes are **never**
read unless `--license-confirmed` (plus `--images-dir` and
`--bucket-id`) is explicitly passed — see "Do not bulk-download Toyota
data" below.

## First end-to-end proof

Every value in `catalogue_storage/migrations/
0002_seed_spare_parts_catalogue.py` (IntraForge side) was read live from
the real Toyota EPC aggregator during this feature's own development —
not invented:

- Part: `15690-65010` — "VALVE ASSY, OIL COOLER RELIEF" (Toyota)
- Diagram: `MAB896` (catalog `EU/671450`, section 1503 "ENGINE OIL
  COOLER")
- Callout: `15690`
- Real hotspot rectangle: `{x1:536, y1:672} – {x2:602, y2:692}` (so
  `x=536, y=672, width=66, height=20`)
- `license_status`: `EXTERNAL_REFERENCE_ONLY` — toyota-epc's own
  redistribution permission remains unverified, unchanged from every
  other Toyota-related decision in this project

## Do not bulk-download Toyota data

Nothing in this feature fetches more than the one, explicitly-verified
sample from the live Toyota EPC API. `TOYOTA_EPC_ENABLED` was
temporarily set to inspect that one part/diagram live (read-only,
nothing persisted by that provider path — see
`docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md`'s existing licensing
governance, unchanged) and turned back off afterward. The importer
above is the only path that writes into `catalogue_storage`, and it
processes exactly the rows in whatever CSV it's given — there is no
"import everything" mode.

## Customer flow (this app's side)

`src/components/OEMPartSearch.tsx` — search, diagram/callout display,
ADD. Mounted at the top of the existing Reference Catalogue page
(`Workspace.tsx`), deliberately not a new nav item or a redesigned page —
"keep my existing spare-parts frontend."

**ADD requires a real sign-in** (`/api/auth/me`, the IntraForge SSO
integration from the previous phase) — an anonymous click redirects to
`/auth/login?returnTo=<current page>` and returns here afterward, per
`docs/SPARE_PARTS_AUTH_INTEGRATION.md`'s existing return-to support.
Once signed in, ADD calls the **existing** `services.enquiries.addItem`
— the pre-existing price-free "request a quote" cart
(`domain/models.ts` `Enquiry`/`EnquiryItem`), not a new, duplicate cart
concept. `oemNumber`/`partName` come from the real IntraForge-backed
result; no new commercial fields were added to `EnquiryItem`.

## Quotation → order → invoice

Reused as-is: `services.sales.create/confirm/fulfill/invoice/pay` (the
existing `Order` with `kind: "Sale"`, `status` progressing
Draft → Quotation → Confirmed → Fulfilled → Invoiced) and the existing
"Add to My Products" adoption path give a reference part a commercial
`Part`/SKU/price once staff decide to sell it — genuinely unmodified,
proven by this app's own pre-existing test suite before this feature
touched anything.

**What is not yet built**: a one-click "convert this submitted Enquiry
into a priced Quotation" action. There is no staff-facing Enquiries
list in the UI today (checked — `Management.tsx` has none), so a
submitted enquiry currently has to be turned into a Sale Order/Quotation
by staff manually re-entering its line(s) through the existing "New
sale" flow, using the OEM number as the reference. The search → diagram
→ ADD → enquiry → submit chain (steps 1–11 of this feature's own "first
end-to-end proof" list) is fully built, tested, and browser-verified;
the staff-side conversion action (closing the gap to steps 12–15) is the
one explicitly deferred piece — see the final report for why, and it is
a natural, contained next slice.

## Offline operation

Once imported, an OEMPart/Diagram/DiagramPart lives in IntraForge's own
Postgres — reachable with zero external internet access, exactly like
every other IntraForge-backed feature in this project (the same
Docker-Compose stack this app already depends on for its own storage
and, when signed in, identity). No external call is made for a search
that already exists in `catalogue_storage` — the toyota-epc API is
never touched by `OEMPartSearch.tsx`'s search path at all.
