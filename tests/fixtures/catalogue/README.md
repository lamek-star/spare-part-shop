# Catalogue fixtures

`intraforge_reference_catalogue_batch_001.csv` — "Batch 001", supplied by the
owner as a development/test/import fixture. It is **not** the complete
catalogue: 23 rows (22 Nissan 180SX/RS13 lines with source-page price
snapshots, 1 Toyota Corona/Carina 2 line). Tests use it to prove that the
importer maps columns, preserves provenance, and never invents data; they
must keep working if a later batch adds more columns.
