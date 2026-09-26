// PostgreSQL twin of ../migrations/0003_sales_purchasing.ts. Append-only: never edit a
// migration that has shipped; add a new version to BOTH lists.
export const p0003 = `
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
