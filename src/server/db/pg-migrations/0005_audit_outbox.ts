// PostgreSQL twin of ../migrations/0005_audit_outbox.ts. Append-only: never
// edit a migration that has shipped; add a new version to BOTH lists.
export const p0005 = `
CREATE TABLE audit_outbox (
  event_id TEXT PRIMARY KEY REFERENCES audit_events(id),
  queued_at TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_outbox_queued ON audit_outbox(queued_at);
`;
