/** Audit events waiting to be relayed to IntraForge's audit log (platform
 * mode). A row is written in the same transaction as its event, so an event
 * is relayed if and only if its change committed; it is removed once
 * IntraForge has recorded it (idempotently, by event id). Unused on the
 * standalone build. */
export const m0005 = `
CREATE TABLE audit_outbox (
  event_id TEXT PRIMARY KEY REFERENCES audit_events(id),
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_outbox_queued ON audit_outbox(queued_at);
`;
