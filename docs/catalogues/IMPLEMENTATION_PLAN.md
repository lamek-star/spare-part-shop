# Catalogue implementation plan

## Existing system and baseline
The Part model is the existing CompanyProduct: SKU, cost/price, images, inventory, sales and purchasing all refer to its immutable ID. Keep that model and its working service methods. Do not rename existing storage records or destroy user edits. The legacy Nengun auto-merge currently creates company entries implicitly; stop it for new sessions. Existing company entries remain business-owned, with unknown-rights images suppressed.

## Separate reference domain
Add CatalogueSource, VehicleMake/Model/Variant, Catalogue, hierarchical Category, CatalogueDiagram, DiagramCallout, CataloguePart, reference numbers, cross-reference edges and fitments. CataloguePart has no commercial fields. Company Part gains a preferredCataloguePartId, supplier/default warehouse and provenance link. Explicit adoption creates only one CompanyProduct with its SKU and chosen business values; it does not move the reference record.

## Access and storage
Reference reads use a typed asynchronous client and a local Next.js route. The temporary server repository stores JSON outside public/, supports bounded pages and indexed normalized-number lookups, and never sends the whole catalogue to the browser. Server memory/file storage is a development adapter; future platform/database adapter must implement the same paged contract and indexed queries. Existing small company state stays in local storage.

## Import pipeline
CSV read → column mapping → typed parsing/validation → conservative provider/context deduplication → persisted staging → administrator review → atomic publish. Reject formula-like fields, oversized files, malformed CSV, unsafe URLs and invalid year/type values. Imported data never writes company state. Use stable source identities, batch audit counters and idempotent publication. JSON/XML/API/feed/web provider extension contracts remain disabled until supplied contracts/rights exist.

## UI
Reference Catalogue offers number-first and vehicle-first navigation, diagrams and linked parts. Catalogue Administration separately offers Sources, Batches, Staged Records, Errors, Duplicates, Verification, Image Rights and Statistics. Existing Parts remains My Products. Demo administrator roles gate import commands at the server boundary; this is a local persona simulation, not production authentication.

## Rights and migration
Use an original conceptual headlamp exploded SVG with manually supplied percentage callouts. Source records with unknown image rights render a placeholder. Remove the supplied Nengun image and legacy public exports from current served assets; keep existing company records and source links. No historical Git rewrite. Nengun automated collection remains disabled pending explicit source permission.

## Quality gates
Run TypeScript, existing formatting check (no lint tool configured), unit/integration tests, production build and Playwright. Add import/rights/separation/permission/idempotency tests and end-to-end vehicle → diagram → product adoption → OEM search, plus CSV mapping/review/publish.
