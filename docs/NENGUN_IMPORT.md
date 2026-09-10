# Nengun headlamp import — 10 September 2026

Source product: https://www.nengun.com/oem/mitsubishi/8301a619

Scope: the linked Lancer Evolution IX / CT9A / 2003 / SJGFZ / 4G63 **Headlamp 1** parts table. The import contains all 38 table rows, plus nine replacement-only references from its detail rows (47 distinct OEM/replacement numbers). It is not a crawl of the entire Nengun catalogue or every vehicle variant.

The attached user diagram is copied unchanged to public/catalogue/mitsubishi-headlamp.png and used for all 38 items as a shared assembly illustration. Diagram codes remain CATALOGUE references, separate from orderable OEM identifiers. The screenshot and selected table have different grade captions; sharing the picture does not assert every component's exact appearance or fitment.

Captured fields: OEM number, supplier description, diagram code, applicability text, specification, required quantity, listed JPY price, quote/discontinued/replaced status, source replacement references and capture date. The original 8301A619 product page states 166,452 JPY and usually ships 14 days after payment. Prices are snapshots, not landed costs or AED selling prices. For discontinued entries, unquoted table prices take precedence over hidden historical detail prices.

The original product page exposes 20 vehicle rows across IX, VII, VIII and Wagon. Those are retained as supplier associations, including the source's unusual year/model combinations; no independent fitment verification is claimed. It also mentions 30 further associations (12+8+5+5) without listing their details. Those cannot be reconstructed and were not invented. Other items retain only the linked table's vehicle context and their exact applicability text.

Migration is additive and idempotent: existing parts, notes, orders and movements are preserved. New entries start with no stock movements, no assigned AED business prices, and unknown origin/weight. Source provenance survives part edits. Supplier-listed is a distinct verification state, not manufacturer-verified.

Validation: import counts, idempotence, preservation of existing data, normalized OEM search, reference types, currency separation, shared image path, replacement integrity and discontinuation state are covered by tests/nengun.test.ts.

## Image editing update — 10 September 2026

The image tab now uses a large white assembly-diagram canvas, dark contextual caption, selectable thumbnails and 100–300% zoom. Operators can add, replace, remove and choose the primary image. The part edit/create form also accepts a primary image, saving it with item information. Source metadata is preserved when local item information or images change. These controls are enabled for the local demo operator; definitive authorization remains a platform responsibility.

The current imported catalogue is still only the 38-row headlamp assembly, not all Nengun manufacturers or models. The user confirmed that no export/API/feed is available. Broader collection scope remains to be specified; no claim of full-catalogue coverage is made.
The user requested all manufacturers rather than a narrower vehicle range. Full catalogue ingestion remains outstanding; the application now displays its limited coverage explicitly.
