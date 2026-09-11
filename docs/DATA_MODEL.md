# Data model

- Part: name, SKU, brand, manufacturer, category, description, cost, selling price, currency, unit, weight, origin, reorder/minimum, status, image URLs and notes.
- PartNumber: independent ID, part ID, displayed/normalized values, type, brand, optional supplier, provenance, market, flags and optional replacement number ID.
- Vehicle and Compatibility: independent vehicle definitions with make/model/variant/year interval/engine/code/transmission; link records connect multiple parts to multiple vehicles.
- Warehouse and Branch: locations are linked to demo branch names. Renaming a branch updates those references atomically. A real adapter should map them to platform relationship IDs.
- Movement: signed quantity, type, part, warehouse, reference, timestamp and notes. Opening balances are movements too.
- Stock: derived on-hand, reserved, available and demonstrative bin locator. Bins are sample locators rather than a configurable bin-management subsystem.
- Contact: customer/supplier classification, fictional identity, contact fields, tax identifier, currency, terms, credit limit, status and notes.
- Order and Line: kind, contact, warehouse, date, lifecycle, separate payment state, optional invoice reference, tax rate and item quantity/price/discount/processed/returned values.
- Attachment: generic owner type/ID, MIME, size, display name, URL and timestamp. Demo files use bounded data URLs; IntraForge supplies storage URLs later.
- DemoUser and Role: display-only identity and permission design. Not an authentication or authorization implementation.
- Audit: action, actor label, timestamp and detail; the platform must supply trustworthy audit records later.

All IDs are opaque. Referential checks and business invariants live in the adapter. Monetary values are rounded to two decimals, in AED. Current demo costs are used for estimated margin reports; this is not historical cost accounting.

## Reference catalogue extension

The reference entities and relationships are defined in src/catalogue/models.ts and documented in [Catalogue foundation](catalogues/FOUNDATION.md). Existing Part is the company product; preferredCataloguePartId links an adopted product to its reference without sharing commercial values.
