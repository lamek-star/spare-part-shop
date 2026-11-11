/** IntraForge Pay payments taken for an invoice (platform mode). One row per
 * payment QR the shop showed for the invoice: the Pay request id, the amount
 * it was for, and -- once Pay confirms the customer paid -- the invoice
 * payment it became. `payment_id` is set at most once, so a Pay payment is
 * recorded on the invoice exactly once however often its status is asked.
 * Unused on the standalone build. */
export const m0006 = `
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
