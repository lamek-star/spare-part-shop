# Toyota EPC API fixtures

Real response bodies captured from `https://toyota-epc.aftermarketcatalog.com/api/v1`
on 2026-09-13, used by `tests/toyota-epc-mapper.test.ts` so the mapper is
verified against genuine response shapes rather than invented ones (see
`docs/SPARE_PARTS_CATALOG_ARCHITECTURE.md`, "Toyota provider").

Large arrays (`hotspots`, `parts`, VIN matches, part-number applications)
are trimmed to a handful of entries for fixture size — the trimming keeps
whole, unmodified elements from the real response; no field was edited,
renamed or invented. Endpoints and the exact `curl` used:

| File                       | Endpoint                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.json`             | `GET /api/v1`                                                                                                                                  |
| `regions.json`             | `GET /api/v1/regions`                                                                                                                          |
| `model-corolla.json`       | `GET /api/v1/regions/EU/models/corolla`                                                                                                        |
| `catalog.json`             | `GET /api/v1/catalogs/EU/164230`                                                                                                               |
| `sections.json`            | `GET /api/v1/catalogs/EU/164230/sections` (trimmed to 10)                                                                                      |
| `section-1104.json`        | `GET /api/v1/catalogs/EU/164230/sections/1104`                                                                                                 |
| `figure.json`              | `GET /api/v1/catalogs/EU/164230/figures/11F308A` (trimmed to 8 hotspots + their 20 parts)                                                      |
| `group-11115.json`         | `GET /api/v1/catalogs/EU/164230/groups/11115` (trimmed to 6 parts)                                                                             |
| `part-number.json`         | `GET /api/v1/part-numbers/9091520004` (applications trimmed to 4/region)                                                                       |
| `part-number-history.json` | `GET /api/v1/part-numbers/1111515100/history` — chosen over 9091520004 because it has a real `superseded_by`/`chain` entry                     |
| `vin.json`                 | `GET /api/v1/vin/JTDKB20U903100000` (trimmed from 40 to 6 — the real response repeats the same match many times; the mapper must de-duplicate) |
| `search.json`              | `GET /api/v1/search?q=90915-20004`                                                                                                             |

Regenerate with `tests/live/toyota-epc.live.test.ts` (`npm run test:live`),
which hits the real API and can be diffed against these files by hand if
the upstream shape ever changes.
