// src/server/db/migrate.ts
import { createHash } from "node:crypto";

// src/server/db/migrations/0001_core.ts
var m0001 = `
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','SALES','INVENTORY','VIEWER')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  ip TEXT,
  at TEXT NOT NULL,
  success INTEGER NOT NULL
);
CREATE INDEX login_attempts_lookup ON login_attempts(identifier, at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX audit_at ON audit_events(at);
CREATE INDEX audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX audit_actor ON audit_events(actor_id);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX files_entity ON files(entity_type, entity_id);
CREATE INDEX files_kind ON files(kind);
`;

// src/server/db/migrations/0002_products_inventory.ts
var m0002 = `
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AED',
  payment_terms TEXT NOT NULL DEFAULT '',
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customers_name ON customers(name COLLATE NOCASE);
CREATE INDEX customers_email ON customers(email COLLATE NOCASE);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AED',
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX suppliers_name ON suppliers(name COLLATE NOCASE);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  rack TEXT NOT NULL DEFAULT '',
  shelf TEXT NOT NULL DEFAULT '',
  bin TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (warehouse_id, code)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'NEW' CHECK (condition IN ('NEW','USED','REMANUFACTURED','OTHER')),
  unit TEXT NOT NULL DEFAULT 'Each',
  weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
  origin TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  tax_category TEXT NOT NULL DEFAULT 'Standard',
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  minimum_level INTEGER NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  default_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  default_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_name ON products(name COLLATE NOCASE);
CREATE INDEX products_brand ON products(brand COLLATE NOCASE);
CREATE INDEX products_category ON products(category COLLATE NOCASE);
CREATE INDEX products_status ON products(status);

CREATE TABLE product_numbers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  display TEXT NOT NULL,
  normalized TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER',
  brand TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  primary_flag INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  superseded_by_number TEXT
);
CREATE INDEX product_numbers_normalized ON product_numbers(normalized);
CREATE INDEX product_numbers_product ON product_numbers(product_id);
CREATE UNIQUE INDEX product_numbers_unique ON product_numbers(product_id, type, normalized);

CREATE TABLE product_suppliers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_part_number TEXT NOT NULL DEFAULT '',
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  is_default INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX product_images_product ON product_images(product_id, position);
CREATE UNIQUE INDEX product_images_one_primary ON product_images(product_id) WHERE is_primary = 1;

CREATE TABLE product_reference_links (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reference_part_id TEXT NOT NULL,
  oem_number TEXT NOT NULL DEFAULT '',
  snapshot TEXT,
  linked_at TEXT NOT NULL,
  linked_by TEXT,
  UNIQUE (product_id, reference_part_id)
);
CREATE INDEX product_reference_links_ref ON product_reference_links(reference_part_id);

CREATE TABLE shop_vehicles (
  id TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  year_from INTEGER NOT NULL DEFAULT 0,
  year_to INTEGER NOT NULL DEFAULT 0,
  engine TEXT NOT NULL DEFAULT '',
  engine_code TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT ''
);
CREATE TABLE product_compatibility (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES shop_vehicles(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  UNIQUE (product_id, vehicle_id)
);

CREATE TABLE stock_balances (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id),
  CHECK (reserved <= on_hand)
);
CREATE INDEX stock_balances_location ON stock_balances(location_id);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('OPENING_BALANCE','RECEIPT','SALE','RETURN_IN','RETURN_OUT','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  transfer_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX stock_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX stock_movements_created ON stock_movements(created_at);
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movements are immutable'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock movements are immutable'); END;

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','FULFILLED')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX reservations_reference ON reservations(reference_type, reference_id);
CREATE INDEX reservations_stock ON reservations(product_id, location_id, status);
`;

// src/server/db/migrations/0003_sales_purchasing.ts
var m0003 = `
CREATE TABLE enquiries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','QUOTED','CLOSED','CANCELLED')),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX enquiries_status ON enquiries(status, created_at);
CREATE INDEX enquiries_creator ON enquiries(created_by, status);
CREATE INDEX enquiries_customer ON enquiries(customer_id);

CREATE TABLE enquiry_items (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  oem_number TEXT NOT NULL,
  part_name TEXT NOT NULL DEFAULT '',
  vehicle_description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reference_part_id TEXT,
  provider_key TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL
);
CREATE INDEX enquiry_items_enquiry ON enquiry_items(enquiry_id, position);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  enquiry_id TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ISSUED','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp INTEGER NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  valid_until TEXT,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT,
  accepted_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX quotations_status ON quotations(status, created_at);
CREATE INDEX quotations_customer ON quotations(customer_id);
CREATE INDEX quotations_enquiry ON quotations(enquiry_id);

CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor INTEGER NOT NULL
);
CREATE INDEX quotation_items_quotation ON quotation_items(quotation_id, position);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  quotation_id TEXT UNIQUE REFERENCES quotations(id) ON DELETE SET NULL,
  enquiry_id TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','INVOICED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp INTEGER NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  notes TEXT NOT NULL DEFAULT '',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sales_orders_status ON sales_orders(status, created_at);
CREATE INDEX sales_orders_customer ON sales_orders(customer_id);

CREATE TABLE sales_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_fulfilled INTEGER NOT NULL DEFAULT 0,
  quantity_returned INTEGER NOT NULL DEFAULT 0,
  quantity_invoiced INTEGER NOT NULL DEFAULT 0,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor INTEGER NOT NULL,
  CHECK (quantity_fulfilled >= 0 AND quantity_fulfilled <= quantity),
  CHECK (quantity_returned >= 0 AND quantity_returned <= quantity_fulfilled),
  CHECK (quantity_invoiced >= 0 AND quantity_invoiced <= quantity_fulfilled)
);
CREATE INDEX sales_order_items_order ON sales_order_items(order_id, position);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sales_order_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  quotation_id TEXT REFERENCES quotations(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ISSUED','PARTIALLY_PAID','PAID','VOID')),
  currency TEXT NOT NULL,
  tax_bp INTEGER NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  amount_paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (amount_paid_minor <= total_minor)
);
CREATE INDEX invoices_status ON invoices(status, issue_date);
CREATE INDEX invoices_customer ON invoices(customer_id);
CREATE INDEX invoices_order ON invoices(sales_order_id);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  order_item_id TEXT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor INTEGER NOT NULL
);
CREATE INDEX invoice_items_invoice ON invoice_items(invoice_id, position);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','CARD','OTHER')),
  reference TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX payments_paid ON payments(paid_at);
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;

CREATE TABLE sales_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE sales_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp INTEGER NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  expected_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX purchase_orders_status ON purchase_orders(status, created_at);
CREATE INDEX purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor INTEGER NOT NULL,
  CHECK (quantity_received >= 0 AND quantity_received <= quantity)
);
CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  received_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  received_by TEXT
);
CREATE TABLE goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
`;

// src/server/db/migrations/0004_reference_catalogue.ts
var m0004 = `
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

// src/server/db/migrations/0005_audit_outbox.ts
var m0005 = `
CREATE TABLE audit_outbox (
  event_id TEXT PRIMARY KEY REFERENCES audit_events(id),
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_outbox_queued ON audit_outbox(queued_at);
`;

// src/server/db/migrations/0006_pay_requests.ts
var m0006 = `
CREATE TABLE pay_requests (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
  receipt_number TEXT NOT NULL DEFAULT '',
  payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'PAID') = (payment_id IS NOT NULL))
);
CREATE INDEX pay_requests_invoice ON pay_requests(invoice_id, created_at);
`;

// src/server/db/migrations/0007_package_source_names.ts
var m0007 = `
UPDATE catalogue_sources
   SET name = upper(substr(provider_key, 1, 1)) || substr(provider_key, 2)
 WHERE type = 'PACKAGE' AND url = '' AND name <> provider_key;
`;

// src/server/db/migrations/0008_pharmacy.ts
var m0008 = `
ALTER TABLE products ADD COLUMN generic_name TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN strength TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN dosage_form TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN prescription_only INTEGER NOT NULL DEFAULT 0 CHECK (prescription_only IN (0,1));
ALTER TABLE products ADD COLUMN track_batches INTEGER NOT NULL DEFAULT 0 CHECK (track_batches IN (0,1));
CREATE INDEX products_generic_name ON products(generic_name COLLATE NOCASE);

CREATE TABLE stock_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, location_id, batch_no, expiry_date)
);
CREATE INDEX stock_batches_expiry ON stock_batches(expiry_date);
CREATE INDEX stock_batches_stock ON stock_batches(product_id, location_id);

ALTER TABLE stock_movements ADD COLUMN batch_id TEXT REFERENCES stock_batches(id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_batch ON stock_movements(batch_id);

ALTER TABLE sales_orders ADD COLUMN prescription_ref TEXT NOT NULL DEFAULT '';
`;

// src/server/db/migrations/index.ts
var migrations = [
  { version: "0001", name: "core", sql: m0001 },
  { version: "0002", name: "products_inventory", sql: m0002 },
  { version: "0003", name: "sales_purchasing", sql: m0003 },
  { version: "0004", name: "reference_catalogue", sql: m0004 },
  { version: "0005", name: "audit_outbox", sql: m0005 },
  { version: "0006", name: "pay_requests", sql: m0006 },
  { version: "0007", name: "package_source_names", sql: m0007 },
  { version: "0008", name: "pharmacy", sql: m0008 }
];

// src/server/db/pg-migrations/0001_core.ts
var p0001 = `
-- PostgreSQL-only prelude: SQLite's NOCASE is a case-insensitive
-- collation; this ICU collation gives the same comparisons, uniqueness and
-- ordering (and LIKE, which the store routes through it).
CREATE COLLATION nocase (provider = icu, locale = 'und-u-ks-level2', deterministic = false);

-- Immutable tables (audit events, stock movements, payments) refuse
-- UPDATE/DELETE exactly as the SQLite triggers do.
CREATE FUNCTION sp_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0] USING ERRCODE = 'restrict_violation';
END
$fn$;

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value BIGINT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT COLLATE nocase NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','SALES','INVENTORY','VIEWER')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  must_change_password BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_attempts (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  identifier TEXT NOT NULL,
  ip TEXT,
  at TEXT NOT NULL,
  success BIGINT NOT NULL
);
CREATE INDEX login_attempts_lookup ON login_attempts(identifier, at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX audit_at ON audit_events(at);
CREATE INDEX audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX audit_actor ON audit_events(actor_id);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('audit events are immutable');
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('audit events are immutable');

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL CHECK (size >= 0),
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX files_entity ON files(entity_type, entity_id);
CREATE INDEX files_kind ON files(kind);
`;

// src/server/db/pg-migrations/0002_products_inventory.ts
var p0002 = `
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  name TEXT COLLATE nocase NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AED',
  payment_terms TEXT NOT NULL DEFAULT '',
  credit_limit_minor BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customers_name ON customers(name COLLATE nocase);
CREATE INDEX customers_email ON customers(email COLLATE nocase);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'AED',
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX suppliers_name ON suppliers(name COLLATE nocase);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  rack TEXT NOT NULL DEFAULT '',
  shelf TEXT NOT NULL DEFAULT '',
  bin TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (warehouse_id, code)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT COLLATE nocase NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'NEW' CHECK (condition IN ('NEW','USED','REMANUFACTURED','OTHER')),
  unit TEXT NOT NULL DEFAULT 'Each',
  weight_grams BIGINT NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
  origin TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  cost_minor BIGINT NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  price_minor BIGINT NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  tax_category TEXT NOT NULL DEFAULT 'Standard',
  reorder_level BIGINT NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  minimum_level BIGINT NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  default_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  default_location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_name ON products(name COLLATE nocase);
CREATE INDEX products_brand ON products(brand COLLATE nocase);
CREATE INDEX products_category ON products(category COLLATE nocase);
CREATE INDEX products_status ON products(status);

CREATE TABLE product_numbers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  display TEXT NOT NULL,
  normalized TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER',
  brand TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  active BIGINT NOT NULL DEFAULT 1,
  primary_flag BIGINT NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  superseded_by_number TEXT
);
CREATE INDEX product_numbers_normalized ON product_numbers(normalized);
CREATE INDEX product_numbers_product ON product_numbers(product_id);
CREATE UNIQUE INDEX product_numbers_unique ON product_numbers(product_id, type, normalized);

CREATE TABLE product_suppliers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_part_number TEXT NOT NULL DEFAULT '',
  cost_minor BIGINT NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  is_default BIGINT NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE RESTRICT,
  position BIGINT NOT NULL DEFAULT 0,
  is_primary BIGINT NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX product_images_product ON product_images(product_id, position);
CREATE UNIQUE INDEX product_images_one_primary ON product_images(product_id) WHERE is_primary = 1;

CREATE TABLE product_reference_links (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reference_part_id TEXT NOT NULL,
  oem_number TEXT NOT NULL DEFAULT '',
  snapshot TEXT,
  linked_at TEXT NOT NULL,
  linked_by TEXT,
  UNIQUE (product_id, reference_part_id)
);
CREATE INDEX product_reference_links_ref ON product_reference_links(reference_part_id);

CREATE TABLE shop_vehicles (
  id TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  year_from BIGINT NOT NULL DEFAULT 0,
  year_to BIGINT NOT NULL DEFAULT 0,
  engine TEXT NOT NULL DEFAULT '',
  engine_code TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT ''
);
CREATE TABLE product_compatibility (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES shop_vehicles(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  UNIQUE (product_id, vehicle_id)
);

CREATE TABLE stock_balances (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  on_hand BIGINT NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id),
  CHECK (reserved <= on_hand)
);
CREATE INDEX stock_balances_location ON stock_balances(location_id);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('OPENING_BALANCE','RECEIPT','SALE','RETURN_IN','RETURN_OUT','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  quantity BIGINT NOT NULL CHECK (quantity <> 0),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  transfer_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX stock_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX stock_movements_created ON stock_movements(created_at);
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('stock movements are immutable');
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('stock movements are immutable');

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','FULFILLED')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX reservations_reference ON reservations(reference_type, reference_id);
CREATE INDEX reservations_stock ON reservations(product_id, location_id, status);
`;

// src/server/db/pg-migrations/0003_sales_purchasing.ts
var p0003 = `
CREATE TABLE enquiries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','QUOTED','CLOSED','CANCELLED')),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX enquiries_status ON enquiries(status, created_at);
CREATE INDEX enquiries_creator ON enquiries(created_by, status);
CREATE INDEX enquiries_customer ON enquiries(customer_id);

CREATE TABLE enquiry_items (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  oem_number TEXT NOT NULL,
  part_name TEXT NOT NULL DEFAULT '',
  vehicle_description TEXT NOT NULL DEFAULT '',
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  reference_part_id TEXT,
  provider_key TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL
);
CREATE INDEX enquiry_items_enquiry ON enquiry_items(enquiry_id, position);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  enquiry_id TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ISSUED','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp BIGINT NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  valid_until TEXT,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  issued_at TEXT,
  accepted_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX quotations_status ON quotations(status, created_at);
CREATE INDEX quotations_customer ON quotations(customer_id);
CREATE INDEX quotations_enquiry ON quotations(enquiry_id);

CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp BIGINT NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor BIGINT NOT NULL
);
CREATE INDEX quotation_items_quotation ON quotation_items(quotation_id, position);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  quotation_id TEXT UNIQUE REFERENCES quotations(id) ON DELETE SET NULL,
  enquiry_id TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','INVOICED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp BIGINT NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  notes TEXT NOT NULL DEFAULT '',
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sales_orders_status ON sales_orders(status, created_at);
CREATE INDEX sales_orders_customer ON sales_orders(customer_id);

CREATE TABLE sales_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  quantity_fulfilled BIGINT NOT NULL DEFAULT 0,
  quantity_returned BIGINT NOT NULL DEFAULT 0,
  quantity_invoiced BIGINT NOT NULL DEFAULT 0,
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp BIGINT NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor BIGINT NOT NULL,
  CHECK (quantity_fulfilled >= 0 AND quantity_fulfilled <= quantity),
  CHECK (quantity_returned >= 0 AND quantity_returned <= quantity_fulfilled),
  CHECK (quantity_invoiced >= 0 AND quantity_invoiced <= quantity_fulfilled)
);
CREATE INDEX sales_order_items_order ON sales_order_items(order_id, position);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sales_order_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  quotation_id TEXT REFERENCES quotations(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ISSUED','PARTIALLY_PAID','PAID','VOID')),
  currency TEXT NOT NULL,
  tax_bp BIGINT NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal_minor BIGINT NOT NULL,
  tax_minor BIGINT NOT NULL,
  total_minor BIGINT NOT NULL,
  amount_paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (amount_paid_minor <= total_minor)
);
CREATE INDEX invoices_status ON invoices(status, issue_date);
CREATE INDEX invoices_customer ON invoices(customer_id);
CREATE INDEX invoices_order ON invoices(sales_order_id);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  order_item_id TEXT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL DEFAULT '',
  oem_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp BIGINT NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor BIGINT NOT NULL
);
CREATE INDEX invoice_items_invoice ON invoice_items(invoice_id, position);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','CARD','OTHER')),
  reference TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX payments_paid ON payments(paid_at);
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('payments are immutable');
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION sp_forbid_change('payments are immutable');

CREATE TABLE sales_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE sales_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0)
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  currency TEXT NOT NULL,
  tax_bp BIGINT NOT NULL CHECK (tax_bp BETWEEN 0 AND 100000),
  expected_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX purchase_orders_status ON purchase_orders(status, created_at);
CREATE INDEX purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  quantity_received BIGINT NOT NULL DEFAULT 0,
  unit_cost_minor BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
  discount_bp BIGINT NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  line_total_minor BIGINT NOT NULL,
  CHECK (quantity_received >= 0 AND quantity_received <= quantity)
);
CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  received_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  received_by TEXT
);
CREATE TABLE goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0)
);
`;

// src/server/db/pg-migrations/0004_reference_catalogue.ts
var p0004 = `
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
  priority BIGINT NOT NULL DEFAULT 100,
  active BIGINT NOT NULL DEFAULT 1,
  last_checked TEXT
);

CREATE TABLE manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT COLLATE nocase NOT NULL UNIQUE
);
CREATE TABLE vehicle_models (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  name TEXT COLLATE nocase NOT NULL,
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
  year_from BIGINT,
  year_to BIGINT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX vehicles_model ON vehicles(model_id);
CREATE INDEX vehicles_chassis ON vehicles(chassis COLLATE nocase);

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
  position BIGINT NOT NULL DEFAULT 0,
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
  discovered BIGINT NOT NULL DEFAULT 0,
  valid_count BIGINT NOT NULL DEFAULT 0,
  invalid_count BIGINT NOT NULL DEFAULT 0,
  duplicate_count BIGINT NOT NULL DEFAULT 0,
  processed BIGINT NOT NULL DEFAULT 0,
  created_count BIGINT NOT NULL DEFAULT 0,
  updated_count BIGINT NOT NULL DEFAULT 0,
  unchanged_count BIGINT NOT NULL DEFAULT 0,
  skipped_count BIGINT NOT NULL DEFAULT 0,
  warning_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  mapping TEXT,
  manifest TEXT,
  source_checksum TEXT,
  message TEXT NOT NULL DEFAULT '',
  cancel_requested BIGINT NOT NULL DEFAULT 0,
  attempts BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX import_jobs_created ON import_jobs(created_at);

CREATE TABLE import_job_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number BIGINT NOT NULL,
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
  width BIGINT,
  height BIGINT,
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
  version BIGINT NOT NULL DEFAULT 1,
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
  price_usd_minor BIGINT,
  price_jpy BIGINT,
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
  engine_code TEXT COLLATE nocase NOT NULL,
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
  sequence BIGINT NOT NULL DEFAULT 0,
  x1 DOUBLE PRECISION, y1 DOUBLE PRECISION, x2 DOUBLE PRECISION, y2 DOUBLE PRECISION,
  space TEXT NOT NULL DEFAULT 'PIXEL' CHECK (space IN ('PIXEL','PERCENT')),
  resolved BIGINT NOT NULL DEFAULT 1,
  key_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (drawing_id, label, sequence)
);
CREATE INDEX drawing_callouts_drawing ON drawing_callouts(drawing_id);
CREATE TABLE callout_parts (
  callout_id TEXT NOT NULL REFERENCES drawing_callouts(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  quantity BIGINT,
  PRIMARY KEY (callout_id, part_id)
);
CREATE INDEX callout_parts_part ON callout_parts(part_id);

-- One searchable row per part: OEM number, description, and the text of
-- every vehicle/section it is known to belong to.
CREATE TABLE catalogue_search (
  part_id TEXT PRIMARY KEY REFERENCES catalogue_parts(id) ON DELETE CASCADE,
  oem TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  vehicles TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL DEFAULT '',
  document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', oem || ' ' || description || ' ' || vehicles || ' ' || sections)
  ) STORED,
  sections_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', sections)) STORED
);
CREATE INDEX catalogue_search_document ON catalogue_search USING gin (document);
CREATE INDEX catalogue_search_sections ON catalogue_search USING gin (sections_document);
`;

// src/server/db/pg-migrations/0005_audit_outbox.ts
var p0005 = `
CREATE TABLE audit_outbox (
  event_id TEXT PRIMARY KEY REFERENCES audit_events(id),
  queued_at TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_outbox_queued ON audit_outbox(queued_at);
`;

// src/server/db/pg-migrations/0006_pay_requests.ts
var p0006 = `
CREATE TABLE pay_requests (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
  receipt_number TEXT NOT NULL DEFAULT '',
  payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'PAID') = (payment_id IS NOT NULL))
);
CREATE INDEX pay_requests_invoice ON pay_requests(invoice_id, created_at);
`;

// src/server/db/pg-migrations/0007_package_source_names.ts
var p0007 = `
UPDATE catalogue_sources
   SET name = upper(substr(provider_key, 1, 1)) || substr(provider_key, 2)
 WHERE type = 'PACKAGE' AND url = '' AND name <> provider_key;
`;

// src/server/db/pg-migrations/0008_pharmacy.ts
var p0008 = `
ALTER TABLE products ADD COLUMN generic_name TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN strength TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN dosage_form TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN prescription_only BIGINT NOT NULL DEFAULT 0 CHECK (prescription_only IN (0,1));
ALTER TABLE products ADD COLUMN track_batches BIGINT NOT NULL DEFAULT 0 CHECK (track_batches IN (0,1));
CREATE INDEX products_generic_name ON products(generic_name COLLATE nocase);

CREATE TABLE stock_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  on_hand BIGINT NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, location_id, batch_no, expiry_date)
);
CREATE INDEX stock_batches_expiry ON stock_batches(expiry_date);
CREATE INDEX stock_batches_stock ON stock_batches(product_id, location_id);

ALTER TABLE stock_movements ADD COLUMN batch_id TEXT REFERENCES stock_batches(id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_batch ON stock_movements(batch_id);

ALTER TABLE sales_orders ADD COLUMN prescription_ref TEXT NOT NULL DEFAULT '';
`;

// src/server/db/pg-migrations/index.ts
var pgMigrations = [
  { version: "0001", name: "core", sql: p0001 },
  { version: "0002", name: "products_inventory", sql: p0002 },
  { version: "0003", name: "sales_purchasing", sql: p0003 },
  { version: "0004", name: "reference_catalogue", sql: p0004 },
  { version: "0005", name: "audit_outbox", sql: p0005 },
  { version: "0006", name: "pay_requests", sql: p0006 },
  { version: "0007", name: "package_source_names", sql: p0007 },
  { version: "0008", name: "pharmacy", sql: p0008 }
];

// src/server/db/migrate.ts
var sha256 = (text) => createHash("sha256").update(text).digest("hex");
var checksum = (sql) => sha256(sql.replace(/\r\n/g, "\n"));
var acceptedChecksums = (sql) => {
  const lf = sql.replace(/\r\n/g, "\n");
  return /* @__PURE__ */ new Set([sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))]);
};
var migrationsFor = (db) => db.dialect === "postgres" ? pgMigrations : migrations;
async function migrate(db, migrations2 = migrationsFor(db)) {
  return db.write(async (h) => {
    await h.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         checksum TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`
    );
    const done = new Map(
      (await h.all("SELECT version, checksum FROM schema_migrations")).map((r) => [r.version, r.checksum])
    );
    const report = { applied: [], alreadyApplied: [] };
    for (const m of migrations2) {
      const sum = checksum(m.sql);
      if (done.has(m.version)) {
        if (!acceptedChecksums(m.sql).has(done.get(m.version)))
          throw new Error(
            `Migration ${m.version} (${m.name}) was modified after it was applied.`
          );
        report.alreadyApplied.push(m.version);
        continue;
      }
      await h.exec(m.sql);
      await h.run(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?,?,?,?)",
        [m.version, m.name, sum, (/* @__PURE__ */ new Date()).toISOString()]
      );
      report.applied.push(m.version);
    }
    return report;
  });
}

// src/server/db/postgres.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
import { createHash as createHash2 } from "node:crypto";
import pg from "pg";

// src/server/db/connection.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
var bind = (params) => params.map(
  (p) => p === void 0 ? null : typeof p === "boolean" ? p ? 1 : 0 : p
);
var Handle = class {
  constructor(raw) {
    this.raw = raw;
  }
  raw;
  cache = /* @__PURE__ */ new Map();
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql) {
    this.raw.exec(sql);
  }
  run(sql, params = []) {
    const r = this.stmt(sql).run(...bind(params));
    return { changes: Number(r.changes) };
  }
  get(sql, params = []) {
    return this.stmt(sql).get(...bind(params));
  }
  all(sql, params = []) {
    return this.stmt(sql).all(...bind(params));
  }
};
var SqliteHandle = class {
  constructor(h) {
    this.h = h;
  }
  h;
  dialect = "sqlite";
  async exec(sql) {
    this.h.exec(sql);
  }
  async run(sql, params = []) {
    return this.h.run(sql, params);
  }
  async get(sql, params = []) {
    return this.h.get(sql, params);
  }
  async all(sql, params = []) {
    return this.h.all(sql, params);
  }
  async count(sql, params = []) {
    const row = this.h.get(sql, params);
    return Number(row?.n ?? 0);
  }
};
function runAfterCommit(callbacks) {
  for (const fn of callbacks)
    Promise.resolve().then(fn).catch(
      (e) => console.error(
        `after-commit task failed: ${e?.message ?? e}`
      )
    );
}
var Database = class _Database {
  constructor(file, raw) {
    this.file = file;
    this.handle = new Handle(raw);
    this.asyncHandle = new SqliteHandle(this.handle);
  }
  file;
  dialect = "sqlite";
  tail = Promise.resolve();
  context = new AsyncLocalStorage();
  closed = false;
  handle;
  asyncHandle;
  static open(file) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") {
      raw.exec("PRAGMA journal_mode = WAL");
      raw.exec("PRAGMA synchronous = FULL");
    }
    return new _Database(file, raw);
  }
  async run(mode, fn) {
    const outer = this.context.getStore();
    if (outer) {
      if (mode === "write" && outer.mode === "read")
        throw new Error(
          "Cannot start a write operation inside a read-only one."
        );
      return fn(outer.handle);
    }
    if (this.closed) throw new Error("Database is closed.");
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => release = resolve);
    await previous;
    const committed = [];
    let result;
    try {
      result = await this.context.run(
        { handle: this.asyncHandle, mode, committed },
        async () => {
          if (mode === "write") this.handle.exec("BEGIN IMMEDIATE");
          try {
            const value = await fn(this.asyncHandle);
            if (mode === "write") this.handle.exec("COMMIT");
            return value;
          } catch (error) {
            if (mode === "write") {
              try {
                this.handle.exec("ROLLBACK");
              } catch {
              }
            }
            throw error;
          }
        }
      );
    } finally {
      release();
    }
    runAfterCommit(committed);
    return result;
  }
  read(fn) {
    return this.run("read", fn);
  }
  write(fn) {
    return this.run("write", fn);
  }
  afterCommit(fn) {
    const outer = this.context.getStore();
    if (outer) outer.committed.push(fn);
    else runAfterCommit([fn]);
  }
  async close() {
    if (this.closed) return;
    await this.tail;
    this.closed = true;
    this.handle.raw.close();
  }
};

// src/server/db/postgres.ts
var SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
function toPostgres(sql) {
  let out = "";
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = closing(sql, i, c);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "?") {
      n += 1;
      const rest = sql.slice(i + 1);
      out += /^\s+IS\s+(NOT\s+)?NULL\b/i.test(rest) ? `$${n}::text` : `$${n}`;
      i += 1;
      continue;
    }
    if (c === "L" && sql.startsWith("LIKE", i) && /\s/.test(sql[i - 1] ?? "")) {
      const m = /^LIKE\s+\?/.exec(sql.slice(i));
      if (m) {
        n += 1;
        out += `LIKE ($${n} COLLATE nocase)`;
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}
function closing(sql, start, quote) {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}
var translated = /* @__PURE__ */ new Map();
function translate(sql) {
  let t = translated.get(sql);
  if (t === void 0) {
    t = toPostgres(sql);
    if (translated.size < 5e3) translated.set(sql, t);
  }
  return t;
}
var noNul = (s) => s.includes("\0") ? s.replace(/\u0000/g, "") : s;
var bind2 = (params) => params.map(
  (p) => p === void 0 ? null : typeof p === "boolean" ? p ? 1 : 0 : typeof p === "bigint" ? p.toString() : typeof p === "string" ? noNul(p) : p instanceof Uint8Array ? Buffer.from(p) : p
);
var types = {
  getTypeParser(oid, format) {
    if (oid === 20 || oid === 1700)
      return (value) => value === null ? null : Number(value);
    return pg.types.getTypeParser(oid, format);
  }
};
var names = /* @__PURE__ */ new Map();
function statementName(text) {
  let name = names.get(text);
  if (!name) {
    name = "sp_" + createHash2("sha1").update(text).digest("hex").slice(0, 20);
    if (names.size < 5e3) names.set(text, name);
  }
  return name;
}
var PgHandle = class {
  constructor(client2) {
    this.client = client2;
  }
  client;
  dialect = "postgres";
  /** One connection runs one statement at a time; callers that issue
   * several at once (Promise.all in a service) are queued in order. */
  tail = Promise.resolve();
  /** Runs after every statement queued before it; also used for the
   * transaction's own COMMIT/ROLLBACK. */
  query(text, values) {
    const config = values?.length ? { name: statementName(text), text, values } : { text, values };
    const next = this.tail.then(() => this.client.query(config));
    this.tail = next.catch(() => void 0);
    return next;
  }
  async exec(sql) {
    await this.query(sql);
  }
  async run(sql, params = []) {
    const r = await this.query(translate(sql), bind2(params));
    return { changes: r.rowCount ?? 0 };
  }
  async get(sql, params = []) {
    const r = await this.query(translate(sql), bind2(params));
    return r.rows[0];
  }
  async all(sql, params = []) {
    const r = await this.query(translate(sql), bind2(params));
    return r.rows;
  }
  async count(sql, params = []) {
    const row = await this.get(sql, params);
    return Number(row?.n ?? 0);
  }
};
var PostgresDatabase = class {
  dialect = "postgres";
  schema;
  pool;
  context = new AsyncLocalStorage2();
  closed = false;
  constructor(options) {
    if (!SCHEMA.test(options.schema))
      throw new Error(`Invalid schema name: ${options.schema}`);
    this.schema = options.schema;
    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      max: options.max ?? 8,
      options: `-c search_path=${options.schema}`,
      types,
      application_name: "spareparts"
    });
    this.pool.on("error", () => {
    });
  }
  async run(mode, fn) {
    const outer = this.context.getStore();
    if (outer) {
      if (mode === "write" && outer.mode === "read")
        throw new Error(
          "Cannot start a write operation inside a read-only one."
        );
      return fn(outer.handle);
    }
    if (this.closed) throw new Error("Database is closed.");
    const client2 = await this.pool.connect();
    const handle = new PgHandle(client2);
    let broken = false;
    try {
      if (mode === "write") {
        await handle.query("BEGIN");
        await handle.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `spareparts:${this.schema}`
        ]);
      } else {
        await handle.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      }
      const committed = [];
      try {
        const result = await this.context.run(
          { handle, mode, committed },
          () => fn(handle)
        );
        await handle.query("COMMIT");
        runAfterCommit(committed);
        return result;
      } catch (error) {
        try {
          await handle.query("ROLLBACK");
        } catch {
          broken = true;
        }
        throw error;
      }
    } finally {
      client2.release(broken);
    }
  }
  read(fn) {
    return this.run("read", fn);
  }
  write(fn) {
    return this.run("write", fn);
  }
  afterCommit(fn) {
    const outer = this.context.getStore();
    if (outer) outer.committed.push(fn);
    else runAfterCommit([fn]);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
};

// src/server/kernel/errors.ts
var AppError = class extends Error {
  constructor(code2, message, status = 400, details) {
    super(message);
    this.code = code2;
    this.status = status;
    this.details = details;
    this.name = "AppError";
  }
  code;
  status;
  details;
};

// src/server/kernel/ids.ts
import { randomUUID } from "node:crypto";
var newId = () => randomUUID();
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();

// src/server/standalone/audit.ts
var SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key/i;
function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object")
    return typeof value === "string" && value.length > 500 ? value.slice(0, 500) + "\u2026" : value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1)
    ])
  );
}
async function insertAuditEvent(h, actor, event) {
  const id = newId();
  await h.run(
    `INSERT INTO audit_events(id, at, actor_id, actor_label, action, entity_type, entity_id, summary, metadata)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      nowIso(),
      actor?.id ?? null,
      actor?.displayName ?? "System",
      event.action,
      event.entityType,
      event.entityId ?? null,
      event.summary.slice(0, 500),
      event.metadata ? JSON.stringify(scrub(event.metadata)) : null
    ]
  );
  return id;
}

// src/server/platform/intraforge.ts
function platformEnv(env = process.env) {
  const internalUrl = (env.INTRAFORGE_INTERNAL_URL ?? "").replace(/\/+$/, "");
  const serviceToken = env.INTRAFORGE_SERVICE_TOKEN ?? "";
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(internalUrl))
    throw new Error("INTRAFORGE_INTERNAL_URL must be http(s)://host[:port].");
  if (serviceToken.length < 32)
    throw new Error("INTRAFORGE_SERVICE_TOKEN is missing or too short.");
  return {
    internalUrl,
    serviceToken,
    timeoutMs: Number(env.INTRAFORGE_TIMEOUT_MS ?? 8e3)
  };
}
var PREFIX = "/api/v1/internal/service-apps";
var IntraForgeClient = class {
  constructor(env) {
    this.env = env;
  }
  env;
  async request(method, path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      init.timeoutMs ?? this.env.timeoutMs
    );
    try {
      return await fetch(`${this.env.internalUrl}${PREFIX}${path}`, {
        method,
        headers: {
          "X-IntraForge-Service-Token": this.env.serviceToken,
          ...init.json !== void 0 ? { "Content-Type": "application/json" } : {},
          Accept: "application/json"
        },
        body: init.json !== void 0 ? JSON.stringify(init.json) : init.body,
        signal: controller.signal,
        redirect: "error"
      });
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
  async json(method, path, json, accept = [200, 201]) {
    const res = await this.request(method, path, { json });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
    }
    if (!accept.includes(res.status)) {
      if (res.status === 403)
        throw new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          403
        );
      if (res.status === 400)
        throw new AppError("VALIDATION", firstMessage(data), 400);
      throw unavailable();
    }
    return { status: res.status, data };
  }
  async upload(form) {
    const res = await this.request("POST", "/files/", {
      body: form,
      timeoutMs: 12e4
    });
    const text = await res.text();
    if (res.status === 400)
      throw new AppError("VALIDATION", firstMessage(safeJson(text)), 400);
    if (res.status !== 201) throw unavailable();
    return safeJson(text);
  }
  async download(id) {
    const res = await this.request("GET", `/files/${encodeURIComponent(id)}/`, {
      timeoutMs: 12e4
    });
    if (res.status === 404) return null;
    if (res.status !== 200) throw unavailable();
    return new Uint8Array(await res.arrayBuffer());
  }
  async deleteFile(id, actorId) {
    const res = await this.request(
      "DELETE",
      `/files/${encodeURIComponent(id)}/`,
      { json: { actorId } }
    );
    if (res.status !== 204 && res.status !== 404) throw unavailable();
  }
};
var unavailable = () => new AppError(
  "PLATFORM_UNAVAILABLE",
  "IntraForge is not answering. Try again in a moment; if it persists, open the IntraForge Control Center.",
  503
);
var safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
function firstMessage(data) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return firstMessage(data[0]);
  if (data && typeof data === "object") {
    const d = data;
    if (typeof d.detail === "string") return d.detail;
    const first = Object.values(d)[0];
    if (first !== void 0) return firstMessage(first);
  }
  return "The request was not accepted.";
}

// src/server/platform/container.ts
async function fetchSelf(client2) {
  const { data } = await client2.json("GET", "/self/");
  return data;
}

// src/server/platform/migrateStandalone.ts
import { createHash as createHash4 } from "node:crypto";
import {
  copyFileSync,
  existsSync as existsSync2,
  mkdtempSync,
  readFileSync as readFileSync2,
  rmSync as rmSync2
} from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// src/server/ops/backup.ts
import { createHash as createHash3 } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync as mkdirSync2,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, relative } from "node:path";
var sha256File = (path) => createHash3("sha256").update(readFileSync(path)).digest("hex");
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(
    (e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}
function verifyBackup(source2) {
  const path = join(source2, "backup.json");
  if (!existsSync(path))
    throw new Error("This folder is not a backup (backup.json is missing).");
  const m = JSON.parse(readFileSync(path, "utf8"));
  if (m.format !== 1)
    throw new Error("This backup was made by a newer version.");
  const db = join(source2, m.database.file);
  if (!existsSync(db) || sha256File(db) !== m.database.sha256)
    throw new Error("The database in this backup is missing or damaged.");
  const files = walk(join(source2, "files"));
  if (files.length !== m.files.count)
    throw new Error("The stored files in this backup are incomplete.");
  return m;
}

// src/server/platform/migrateStandalone.ts
var COPY_ORDER = [
  "sequences",
  "files",
  "branches",
  "customers",
  "suppliers",
  "warehouses",
  "locations",
  "products",
  "product_numbers",
  "product_suppliers",
  "product_images",
  "product_reference_links",
  "shop_vehicles",
  "product_compatibility",
  "stock_movements",
  "stock_balances",
  "reservations",
  "enquiries",
  "enquiry_items",
  "quotations",
  "quotation_items",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "invoice_items",
  "payments",
  "sales_returns",
  "sales_return_items",
  "purchase_orders",
  "purchase_order_items",
  "goods_receipts",
  "goods_receipt_items",
  "catalogue_sources",
  "manufacturers",
  "vehicle_models",
  "vehicles",
  "catalogues",
  "sections",
  "import_jobs",
  "import_job_rows",
  "assets",
  "drawings",
  "catalogue_drawings",
  "catalogue_parts",
  "source_records",
  "part_facts",
  "fitments",
  "fitment_engines",
  "part_relations",
  "drawing_callouts",
  "callout_parts",
  "audit_events"
];
var BUSINESS_TABLES = [
  "products",
  "customers",
  "suppliers",
  "stock_movements",
  "invoices",
  "catalogue_parts",
  "files"
];
var USER_COLUMNS = /* @__PURE__ */ new Set([
  "created_by",
  "linked_by",
  "recorded_by",
  "received_by",
  "actor_id"
]);
var StandaloneSource = class _StandaloneSource {
  constructor(db, filesDir, kind, tempDir) {
    this.db = db;
    this.filesDir = filesDir;
    this.kind = kind;
    this.tempDir = tempDir;
  }
  db;
  filesDir;
  kind;
  tempDir;
  static async open(path) {
    let dbFile;
    let kind;
    if (existsSync2(join2(path, "backup.json"))) {
      const manifest = verifyBackup(path);
      dbFile = join2(path, manifest.database.file);
      kind = "backup";
    } else if (existsSync2(join2(path, "spareparts.sqlite"))) {
      dbFile = join2(path, "spareparts.sqlite");
      kind = "data-folder";
    } else
      throw new Error(
        "Not a Spare Parts backup or data folder (no backup.json or spareparts.sqlite)."
      );
    const tempDir = mkdtempSync(join2(tmpdir(), "sp-migrate-"));
    const copy = join2(tempDir, "source.sqlite");
    copyFileSync(dbFile, copy);
    for (const suffix of ["-wal", "-shm"])
      if (existsSync2(dbFile + suffix))
        copyFileSync(dbFile + suffix, copy + suffix);
    const db = Database.open(copy);
    await migrate(db, migrations);
    return new _StandaloneSource(db, join2(path, "files"), kind, tempDir);
  }
  async close() {
    await this.db.close();
    rmSync2(this.tempDir, { recursive: true, force: true });
  }
  rows(table) {
    const order = table === "sections" ? "" : " ORDER BY rowid";
    return this.db.read((h) => h.all(`SELECT * FROM ${table}${order}`));
  }
  async info() {
    const counts = {};
    for (const t of COPY_ORDER)
      counts[t] = await this.db.read(
        (h) => h.count(`SELECT COUNT(*) AS n FROM ${t}`)
      );
    const users = (await this.db.read(
      (h) => h.all("SELECT id, email, display_name FROM users ORDER BY email")
    )).map((u) => ({
      id: String(u.id),
      email: String(u.email),
      displayName: String(u.display_name)
    }));
    const files = await this.rows("files");
    const problems = [];
    let bytes = 0;
    for (const f of files) {
      const path = join2(this.filesDir, String(f.storage_key));
      if (!existsSync2(path)) {
        problems.push(`file ${f.id} (${f.original_name}) is missing`);
        continue;
      }
      const data = readFileSync2(path);
      bytes += data.byteLength;
      if (createHash4("sha256").update(data).digest("hex") !== f.sha256)
        problems.push(`file ${f.id} (${f.original_name}) fails its checksum`);
    }
    const version = await this.db.read(
      (h) => h.get("SELECT MAX(version) AS v FROM schema_migrations")
    );
    return {
      kind: this.kind,
      schemaVersion: String(version?.v ?? "?"),
      counts,
      users,
      files: files.length,
      fileBytes: bytes,
      problems
    };
  }
};
async function destinationCounts(db) {
  const out = {};
  for (const t of COPY_ORDER)
    out[t] = await db.read((h) => h.count(`SELECT COUNT(*) AS n FROM ${t}`));
  return out;
}
function parentsFirst(rows) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (r) => {
    const id = String(r.id);
    if (seen.has(id)) return;
    seen.add(id);
    const parent = r.parent_id ? byId.get(String(r.parent_id)) : void 0;
    if (parent) visit(parent);
    out.push(r);
  };
  rows.forEach(visit);
  return out;
}
async function migrateStandalone(opts) {
  const log = opts.log ?? (() => void 0);
  const { source: source2, destination: destination2, client: client2 } = opts;
  const info = await source2.info();
  const before = await destinationCounts(destination2);
  const destinationEmpty = BUSINESS_TABLES.every((t) => (before[t] ?? 0) === 0);
  const conflicts = [];
  if (!destinationEmpty)
    conflicts.push(
      "The destination already holds business data (" + BUSINESS_TABLES.filter((t) => before[t]).map((t) => `${before[t]} ${t}`).join(", ") + "). Nothing is merged or overwritten; migrate into a freshly installed application."
    );
  conflicts.push(...info.problems);
  const { data } = await client2.json("GET", "/users/");
  const byEmail = new Map(
    data.results.map((u) => [u.email.toLowerCase(), u.id])
  );
  const userMap = /* @__PURE__ */ new Map();
  const userMapping = info.users.map((u) => {
    const target = byEmail.get(u.email.toLowerCase()) ?? null;
    userMap.set(u.id, target);
    return { email: u.email, intraforgeUserId: target };
  });
  const report = {
    source: info,
    destinationEmpty,
    destinationCounts: before,
    userMapping,
    imported: {},
    filesUploaded: 0,
    countsMatch: false,
    ledgerProblems: 0,
    executed: false,
    conflicts
  };
  if (!opts.execute || conflicts.length) return report;
  const files = await source2.rows("files");
  const storageKey = /* @__PURE__ */ new Map();
  const uploaded = [];
  try {
    for (const f of files) {
      const bytes = readFileSync2(join2(source2.filesDir, String(f.storage_key)));
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: String(f.mime) }),
        String(f.original_name)
      );
      form.append("kind", String(f.kind));
      const actor = userMap.get(String(f.created_by ?? "")) ?? null;
      if (actor) form.append("actorId", actor);
      const stored = await client2.upload(form);
      uploaded.push(stored.id);
      if (stored.quarantined || stored.sha256 !== f.sha256)
        throw new Error(
          `IntraForge did not store ${f.original_name} intact (${stored.quarantined ? "blocked by the malware scanner" : "checksum differs"}).`
        );
      storageKey.set(String(f.id), stored.id);
    }
    report.filesUploaded = uploaded.length;
    log(`uploaded ${uploaded.length} file(s) to IntraForge`);
    await destination2.write(async (h) => {
      for (const table of COPY_ORDER) {
        let rows = await source2.rows(table);
        if (table === "sections") rows = parentsFirst(rows);
        const destColumns = new Set(
          (await h.all(
            h.dialect === "postgres" ? "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?" : `SELECT name AS column_name FROM pragma_table_info('${table}')`,
            h.dialect === "postgres" ? [table] : []
          )).map((c) => c.column_name)
        );
        if (table === "sequences") await h.run("DELETE FROM sequences");
        let n = 0;
        for (const row of rows) {
          const r = { ...row };
          for (const c of Object.keys(r))
            if (USER_COLUMNS.has(c) && r[c] != null && userMap.has(String(r[c])))
              r[c] = userMap.get(String(r[c]));
          if (table === "files") r.storage_key = storageKey.get(String(r.id));
          const cols = Object.keys(r).filter((c) => destColumns.has(c));
          await h.run(
            `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
            cols.map((c) => r[c])
          );
          n++;
        }
        report.imported[table] = n;
        if (n) log(`${table}: ${n}`);
      }
      const search = await source2.db.read(
        (h2) => h2.all(
          "SELECT part_id, oem, description, vehicles, sections FROM catalogue_search"
        )
      );
      for (const s of search)
        await h.run(
          h.dialect === "postgres" ? "INSERT INTO catalogue_search(part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?)" : "INSERT INTO catalogue_search(part_id, oem, description, vehicles, sections) VALUES (?,?,?,?,?)",
          [s.part_id, s.oem, s.description, s.vehicles, s.sections]
        );
      report.imported.catalogue_search = search.length;
      const eventId = await insertAuditEvent(h, null, {
        action: "data.migrate",
        entityType: "application",
        summary: `Standalone Spare Parts data migrated (${report.imported.products ?? 0} products, ${report.imported.invoices ?? 0} invoices, ${uploaded.length} files)`,
        metadata: {
          source: info.kind,
          schemaVersion: info.schemaVersion,
          rows: report.imported,
          files: uploaded.length,
          peopleMapped: userMapping.filter((u) => u.intraforgeUserId).length,
          peopleUnmapped: userMapping.filter((u) => !u.intraforgeUserId).length
        }
      });
      await h.run(
        "INSERT INTO audit_outbox(event_id, queued_at) VALUES (?,?)",
        [eventId, nowIso()]
      );
    });
  } catch (error) {
    for (const id of uploaded)
      await client2.deleteFile(id, null).catch(() => void 0);
    throw error;
  }
  report.executed = true;
  const after = await destinationCounts(destination2);
  report.countsMatch = COPY_ORDER.every(
    (t) => (after[t] ?? 0) === (info.counts[t] ?? 0) + (t === "audit_events" ? 1 : 0)
  );
  report.ledgerProblems = await destination2.read(
    (h) => h.count(
      `SELECT COUNT(*) AS n FROM stock_balances b WHERE b.on_hand <> COALESCE((SELECT SUM(quantity) FROM stock_movements m WHERE m.product_id = b.product_id AND m.location_id = b.location_id), 0)
          OR b.reserved <> COALESCE((SELECT SUM(quantity) FROM reservations r WHERE r.product_id = b.product_id AND r.location_id = b.location_id AND r.status = 'ACTIVE'), 0)`
    )
  );
  return report;
}

// scripts/migrate-to-intraforge.mts
var args = process.argv.slice(2);
var folder = args.find((a) => !a.startsWith("--"));
var execute = args.includes("--execute");
var asJson = args.includes("--json");
if (!folder) {
  console.error(
    "usage: migrate-to-intraforge <standalone backup or data folder> [--execute] [--json]"
  );
  process.exit(2);
}
var client = new IntraForgeClient(platformEnv());
var self = await fetchSelf(client);
if (!self.installed || !self.database) {
  console.error(
    "Spare Parts is not installed in IntraForge yet (IntraForge > Apps > Install)."
  );
  process.exit(3);
}
var destination = new PostgresDatabase({
  host: process.env.SPAREPARTS_PG_HOST ?? "postgres-tenant",
  port: Number(process.env.SPAREPARTS_PG_PORT ?? 5432),
  database: process.env.SPAREPARTS_PG_DATABASE,
  user: self.database.role,
  password: process.env.SPAREPARTS_PG_PASSWORD,
  schema: self.database.schema,
  max: 2
});
var source = await StandaloneSource.open(folder);
var code = 0;
try {
  await migrate(destination);
  const report = await migrateStandalone({
    source,
    destination,
    client,
    execute,
    log: asJson ? void 0 : (l) => console.log("  " + l)
  });
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    const s = report.source;
    console.log(
      `Source: ${s.kind}, schema ${s.schemaVersion}, ${s.files} file(s), ${(s.fileBytes / 1e6).toFixed(1)} MB`
    );
    for (const [t, n] of Object.entries(s.counts))
      if (n) console.log(`  ${t}: ${n}`);
    console.log("People (standalone email -> IntraForge user):");
    for (const u of report.userMapping)
      console.log(
        `  ${u.email} -> ${u.intraforgeUserId ?? "no IntraForge user with access (references become empty)"}`
      );
    for (const c of report.conflicts) console.log(`CONFLICT: ${c}`);
    if (!execute)
      console.log(
        report.conflicts.length ? "Nothing can be imported until the conflicts are resolved." : "Preview only. Run again with --execute to import."
      );
    else if (!report.executed) console.log("Nothing was imported.");
    else
      console.log(
        `Imported. Files: ${report.filesUploaded}. Counts match: ${report.countsMatch ? "yes" : "NO"}. Stock ledger problems: ${report.ledgerProblems}.`
      );
  }
  if (report.conflicts.length) code = 4;
  else if (execute && (!report.countsMatch || report.ledgerProblems)) code = 5;
} catch (e) {
  console.error(
    `Migration failed and was rolled back: ${e.message}`
  );
  code = 1;
} finally {
  await source.close();
  await destination.close();
}
process.exit(code);
