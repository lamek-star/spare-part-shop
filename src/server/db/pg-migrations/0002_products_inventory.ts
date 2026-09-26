// PostgreSQL twin of ../migrations/0002_products_inventory.ts. Append-only: never edit a
// migration that has shipped; add a new version to BOTH lists.
export const p0002 = `
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
