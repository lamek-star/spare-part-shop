export const m0004 = `
-- ===== Reference catalogue: OEM/reference data, separate from the shop's own products =====

CREATE TABLE catalogue_sources (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER',
  url TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  license_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  redistribution_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  image_usage_status TEXT NOT NULL DEFAULT 'LICENSE_UNKNOWN',
  feed_availability TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT
);

CREATE TABLE manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE vehicle_models (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (manufacturer_id, name)
);
CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  vehicle_key TEXT NOT NULL UNIQUE,
  model_id TEXT NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  generation TEXT NOT NULL DEFAULT '',
  chassis TEXT NOT NULL DEFAULT '',
  frame TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  engine_code TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  drivetrain TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  production_from TEXT,
  production_to TEXT,
  year_from INTEGER,
  year_to INTEGER,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX vehicles_model ON vehicles(model_id);
CREATE INDEX vehicles_chassis ON vehicles(chassis COLLATE NOCASE);

CREATE TABLE catalogues (
  id TEXT PRIMARY KEY,
  catalogue_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES catalogue_sources(id) ON DELETE RESTRICT,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  production_from TEXT,
  production_to TEXT
);
CREATE INDEX catalogues_vehicle ON catalogues(vehicle_id);
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  catalogue_id TEXT NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (catalogue_id, code)
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('CSV','PACKAGE','PROVIDER_LOOKUP')),
  provider_key TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PENDING','REVIEW_REQUIRED','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','CANCELLED')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  mapping TEXT,
  manifest TEXT,
  source_checksum TEXT,
  message TEXT NOT NULL DEFAULT '',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX import_jobs_created ON import_jobs(created_at);

CREATE TABLE import_job_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID','INVALID','DUPLICATE','CONFLICT','EXCLUDED','IMPORTED','UPDATED','UNCHANGED')),
  action TEXT NOT NULL DEFAULT 'NONE' CHECK (action IN ('CREATE','UPDATE','NONE')),
  identity TEXT NOT NULL DEFAULT '',
  errors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  record TEXT NOT NULL
);
CREATE INDEX import_job_rows_job ON import_job_rows(job_id, row_number);
CREATE INDEX import_job_rows_status ON import_job_rows(job_id, status);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DIAGRAM','REFERENCE_IMAGE')),
  provider_key TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  checksum TEXT NOT NULL DEFAULT '',
  rights TEXT NOT NULL DEFAULT 'EXTERNAL_REFERENCE',
  rights_evidence TEXT NOT NULL DEFAULT '',
  rights_reviewed_at TEXT,
  import_job_id TEXT REFERENCES import_jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assets_file ON assets(file_id);

CREATE TABLE drawings (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES catalogue_sources(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  revision TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  UNIQUE (source_id, code)
);
CREATE TABLE catalogue_drawings (
  catalogue_id TEXT NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  PRIMARY KEY (catalogue_id, drawing_id)
);
CREATE INDEX catalogue_drawings_drawing ON catalogue_drawings(drawing_id);

CREATE TABLE catalogue_parts (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
  oem_number TEXT NOT NULL,
  oem_normalized TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pnc TEXT NOT NULL DEFAULT '',
  part_group TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  status_class TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status_class IN ('ACTIVE','ENDED','SUPERSEDED','UNKNOWN')),
  notes TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'UNVERIFIED',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (manufacturer_id, oem_normalized)
);
CREATE INDEX catalogue_parts_normalized ON catalogue_parts(oem_normalized);
CREATE INDEX catalogue_parts_pnc ON catalogue_parts(pnc);

CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES catalogue_sources(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  catalogue_code TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  import_job_id TEXT REFERENCES import_jobs(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL,
  source_updated_at TEXT,
  payload TEXT,
  UNIQUE (source_id, entity_type, entity_id, external_id)
);
CREATE INDEX source_records_entity ON source_records(entity_type, entity_id);
CREATE INDEX source_records_job ON source_records(import_job_id);

CREATE TABLE part_facts (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalogue_sources(id) ON DELETE RESTRICT,
  source_record_id TEXT REFERENCES source_records(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  price_usd_minor INTEGER,
  price_jpy INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  UNIQUE (part_id, source_id, description)
);
CREATE INDEX part_facts_part ON part_facts(part_id);

CREATE TABLE fitments (
  id TEXT PRIMARY KEY,
  fitment_key TEXT NOT NULL UNIQUE,
  part_id TEXT NOT NULL REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  catalogue_id TEXT REFERENCES catalogues(id) ON DELETE SET NULL,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  production_from TEXT,
  production_to TEXT,
  market TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  attributes TEXT,
  source_record_id TEXT REFERENCES source_records(id) ON DELETE SET NULL
);
CREATE INDEX fitments_part ON fitments(part_id);
CREATE INDEX fitments_vehicle ON fitments(vehicle_id);
CREATE TABLE fitment_engines (
  fitment_id TEXT NOT NULL REFERENCES fitments(id) ON DELETE CASCADE,
  engine_code TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (fitment_id, engine_code)
);
CREATE INDEX fitment_engines_code ON fitment_engines(engine_code);

CREATE TABLE part_relations (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('SUPERSEDES','SUPERSEDED_BY','REPLACEMENT','INTERCHANGE','ALTERNATIVE','EQUIVALENT','CROSS_REFERENCE')),
  related_number TEXT NOT NULL,
  related_normalized TEXT NOT NULL,
  related_part_id TEXT REFERENCES catalogue_parts(id) ON DELETE SET NULL,
  effective_from TEXT,
  effective_to TEXT,
  notes TEXT NOT NULL DEFAULT '',
  source_record_id TEXT REFERENCES source_records(id) ON DELETE SET NULL,
  UNIQUE (part_id, relation, related_normalized)
);
CREATE INDEX part_relations_related ON part_relations(related_normalized);

CREATE TABLE drawing_callouts (
  id TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  x1 REAL, y1 REAL, x2 REAL, y2 REAL,
  space TEXT NOT NULL DEFAULT 'PIXEL' CHECK (space IN ('PIXEL','PERCENT')),
  resolved INTEGER NOT NULL DEFAULT 1,
  key_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (drawing_id, label, sequence)
);
CREATE INDEX drawing_callouts_drawing ON drawing_callouts(drawing_id);
CREATE TABLE callout_parts (
  callout_id TEXT NOT NULL REFERENCES drawing_callouts(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  quantity INTEGER,
  PRIMARY KEY (callout_id, part_id)
);
CREATE INDEX callout_parts_part ON callout_parts(part_id);

-- One searchable row per part: OEM number, description, and the text of
-- every vehicle/section it is known to belong to.
CREATE VIRTUAL TABLE catalogue_search USING fts5(
  part_id UNINDEXED,
  oem,
  description,
  vehicles,
  sections,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;
