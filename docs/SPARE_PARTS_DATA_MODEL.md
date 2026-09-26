# Spare Parts — data model

The complete, generated column-level reference is
[generated/SCHEMA.md](generated/SCHEMA.md) (rebuilt from the migrations by
`npm run docs:generate`; a test fails if it is stale). This page explains the
model and the rules behind it.

Migrations live in `src/server/db/migrations/` and are append-only:
`0001_core`, `0002_products_inventory`, `0003_sales_purchasing`,
`0004_reference_catalogue`. Each is applied once, in one transaction, and its
checksum is recorded in `schema_migrations`.

## Two worlds that never mix

```
REFERENCE CATALOGUE (what manufacturers say)      MY PRODUCTS (what the shop sells)
manufacturers → vehicle_models → vehicles         products ── product_numbers
catalogues → sections                              │  ├─ product_suppliers ── suppliers
drawings ── drawing_callouts ── callout_parts      │  ├─ product_images ── files
catalogue_parts ── fitments ── fitment_engines     │  └─ stock_balances / stock_movements
part_relations (supersessions)                     └─ product_reference_links ──┐
part_facts, source_records (provenance)                                          │
assets (images + rights)      ◄──────────────────────────────────────────────────┘
```

- Reference tables hold **no shop price, cost, supplier or stock**. Prices in
  `part_facts` (`price_usd`, `price_jpy`) are what a source reported and are
  labelled "reference price" in the UI.
- `product_reference_links` is the only bridge. It stores a snapshot of the
  reference part at link time; importing to My Products **copies** convenient
  fields and never modifies the reference record.
- A second product for the same reference part is refused (`ALREADY_IMPORTED`)
  unless the caller explicitly allows a duplicate.

## Reference catalogue

| Entity                              | Notes                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manufacturers`                     | Vehicle and part makers, case-insensitively unique.                                                                                                                                                                                                                                                              |
| `vehicle_models`, `vehicles`        | A vehicle is model + generation + chassis + frame + body + transmission + market + production range. Engines are separate rows.                                                                                                                                                                                  |
| `catalogues`, `sections`            | A catalogue is keyed by source + code + market; sections group figures.                                                                                                                                                                                                                                          |
| `catalogue_parts`                   | One row per manufacturer part number. `oem_number` (as displayed), `normalized` (upper-case, no spaces/dashes, used for lookup), `pnc`, group, display description/status, `status_class` (ACTIVE / ENDED / SUPERSEDED / UNKNOWN), `verification` (UNVERIFIED / SOURCE_VERIFIED / MANUALLY_VERIFIED / DISPUTED). |
| `fitments`, `fitment_engines`       | Part ↔ vehicle (+ optional section, position, notes, production range).                                                                                                                                                                                                                                          |
| `part_relations`                    | SUPERSEDES, SUPERSEDED_BY, REPLACEMENT, INTERCHANGE, ALTERNATIVE, EQUIVALENT, CROSS_REFERENCE, with the related number kept even when that part is not (yet) in the catalogue.                                                                                                                                   |
| `drawings`, `catalogue_drawings`    | A figure (e.g. `MA4481A`) belongs to one or more catalogues.                                                                                                                                                                                                                                                     |
| `drawing_callouts`, `callout_parts` | Numbered hotspots with a rectangle in `PIXEL` or `PERCENT` space; a callout lists the part(s) it points at and quantity. Callouts without a resolved part are kept (`resolved = 0`).                                                                                                                             |
| `assets`                            | Image metadata: provider, source URL, MIME, size, SHA-256, **rights** and **rights evidence**, optional `file_id` when the bytes are stored locally.                                                                                                                                                             |
| `catalogue_search`                  | FTS5 index over number, description, vehicles and section text; exact and prefix matches are ranked first.                                                                                                                                                                                                       |

### Provenance without silent merging

Each imported fact is stored against its **source** (`catalogue_sources`) and
a **source record** (`source_records`: external id, URL, catalogue code,
market, import job, timestamps). Conflicting descriptions from different
sources are kept as separate `part_facts` rows; the displayed description and
status are chosen deterministically by source priority (`recomputeDisplay`),
so nothing is overwritten or merged away. Re-importing identical data creates
nothing new.

### Image rights

`assets.rights` ∈ EXTERNAL_REFERENCE, LICENSE_UNKNOWN, LICENSED_FOR_INTERNAL_USE,
LICENSED_FOR_DISPLAY, COMPANY_OWNED, MANUFACTURER_AUTHORIZED, DO_NOT_REPUBLISH.
Bytes are stored only when an operator confirms the rights at import, and a
stored image is **served only while its rights are one of the four display
rights**. Changing rights to `DO_NOT_REPUBLISH` (with written evidence) stops
display immediately. There is no automatic image downloading anywhere.

### Imports

`import_jobs` (kind CSV / PACKAGE / PROVIDER_LOOKUP; status PENDING,
REVIEW_REQUIRED, RUNNING, COMPLETED, COMPLETED_WITH_WARNINGS, FAILED,
CANCELLED; counts for discovered, valid, invalid, duplicates, processed,
created, updated, unchanged, skipped, warnings, errors; cancel flag; mapping
and manifest JSON; source checksum) and `import_job_rows` (staged, validated
rows with status, action and messages) make every import observable,
resumable and auditable. See [CATALOGUE_IMPORT.md](CATALOGUE_IMPORT.md).

## My Products, inventory, master data

| Entity                               | Notes                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`                           | SKU (unique, case-insensitive), name, brand, manufacturer, category, condition, unit, weight, origin, `status`, `cost_minor`, `price_minor`, currency, reorder/minimum level, default supplier/location.                                                                              |
| `product_numbers`                    | Every number the shop knows the product by, with `display` and `normalized` values and a type (INTERNAL_SKU, OEM_OE, AFTERMARKET, SUPPLIER, CROSS_REFERENCE, REPLACEMENT, PREVIOUS, INTERCHANGE, OTHER). The SKU is one of them, so a scan or search of any number finds the product. |
| `product_suppliers`                  | Supplier part number, cost, preferred flag.                                                                                                                                                                                                                                           |
| `product_images`                     | Ordered photos, one primary, each backed by a `files` row.                                                                                                                                                                                                                            |
| `warehouses`, `locations`            | Warehouse → location with rack / shelf / bin. Every warehouse has a default `MAIN` location.                                                                                                                                                                                          |
| `stock_movements`                    | Immutable ledger (OPENING_BALANCE, RECEIPT, SALE, RETURN_IN, RETURN_OUT, TRANSFER_IN/OUT, ADJUSTMENT_IN/OUT). Update and delete are blocked by triggers.                                                                                                                              |
| `stock_balances`                     | `(product, location) → on_hand, reserved`, CHECK `0 ≤ reserved ≤ on_hand`.                                                                                                                                                                                                            |
| `reservations`                       | ACTIVE / RELEASED / FULFILLED per order line; split when partly fulfilled so ACTIVE quantities always equal the reserved balance.                                                                                                                                                     |
| `customers`, `suppliers`, `branches` | Contact records with permanent codes.                                                                                                                                                                                                                                                 |

## Sales and purchasing

`enquiries` / `enquiry_items` (per-user draft cart, then SUBMITTED, QUOTED,
CLOSED, CANCELLED) → `quotations` / `quotation_items` (DRAFT, ISSUED,
ACCEPTED, REJECTED, EXPIRED, CANCELLED) → `sales_orders` / `sales_order_items`
(CONFIRMED, PARTIALLY_FULFILLED, FULFILLED, INVOICED, CANCELLED; per-line
fulfilled/returned/invoiced quantities) → `invoices` / `invoice_items`
(ISSUED, PARTIALLY_PAID, PAID, VOID) → `payments` (immutable; CASH,
BANK_TRANSFER, CARD, OTHER). `sales_returns` re-stock returned goods.
`purchase_orders` / `purchase_order_items` and `goods_receipts` cover
purchasing. Document lines snapshot SKU, OEM number, description and price at
the time, so later product edits never rewrite history.

## Platform tables

`users` (role, status, `password_hash`, must-change flag), `sessions` (token
hash, CSRF token, expiry), `login_attempts`, `audit_events` (actor, action,
entity, summary, metadata — never secrets), `files` (managed file metadata:
kind, entity, SHA-256, size, MIME), `app_config` (shop settings), `sequences`
(document numbering).

## Deletion policy

Business records are never hard-deleted through the application: documents
are cancelled or voided, products are made INACTIVE, customers and suppliers
INACTIVE. Only attachments and links can be removed: product photos (row and
stored file), extra part numbers, supplier links and reference links. Each
removal is audited.
