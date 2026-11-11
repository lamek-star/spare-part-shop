// PostgreSQL twin of ../migrations/0008_pharmacy.ts. Append-only: never
// edit a migration that has shipped; add a new version to BOTH lists.
export const p0008 = `
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
