# Reference readiness

**SPARE PARTS REFERENCE APP READY FOR INTRAFORGE ADAPTER**

## Delivered

- Isolated Next.js 16.3.4 / React / strict TypeScript repository; no IntraForge Core changes.
- Complete navigation and operational screens for catalogue, inventory, purchasing, sales, reports, documents and management.
- 48 fictional parts, 385 typed sample references, many-to-many fitment records, four warehouses, three branches, suppliers, customers, orders and movement history.
- Search by normalized references; provenance, supersession, vehicle linking and image gallery controls.
- Coherent purchase receiving, sales reservation/fulfillment, invoice/payment, stock transfer, adjustment and customer-return workflows.
- Demo contact, location, user and permission-design management; documents and audit events.
- Typed asynchronous-compatible command boundary and centralized future IntraForge integration placeholder.
- Desktop/mobile layouts, keyboard-accessible dialogs, form validation, empty/error states, report CSV and invoice print layout.

## Validation (9 September 2026)

- Production build passed.
- Strict TypeScript check passed.
- 13 service/component tests passed.
- Four Playwright browser tests passed: full purchasing-to-invoice scenario with persisted stock verification; mobile dialog dismissal/layout; transfer review and paired movements; mobile purchasing navigation.
- Dashboard and catalogue visually inspected through local browser captures.

## Integration work intentionally deferred

Supply the actual IntraForge contract and implement its adapter: AppInstance scoping, model/field mappings, API queries and commands, identity, permission enforcement, storage URLs, server transactions, concurrency and idempotency. No speculative platform endpoints exist.

## Reference boundaries

This is a working local demo, not a production multi-user deployment. Browser storage, demo personas, current-cost margin estimates and simulated document storage are temporary. Currency is AED. Stock returns do not create financial credit notes or refunds. Bins are illustrative locators. Demo audit labels are not trusted identity evidence. Catalogue numbers, barcode examples and fitment associations are unverified and must be replaced with approved data before business use.
