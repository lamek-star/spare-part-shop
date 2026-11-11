// PostgreSQL twin of ../migrations/0006_pay_requests.ts. Append-only: never
// edit a migration that has shipped; add a new version to BOTH lists.
export const p0006 = `
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
