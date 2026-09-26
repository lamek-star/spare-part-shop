import type { Database } from "../db/connection";
import type { AuditEvent } from "../domain/types";
import type { AuditInput, AuditProvider } from "../providers/core";
import { newId, nowIso } from "../kernel/ids";

const SECRET_KEYS =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key/i;
/** Audit metadata is for people to read later: strip anything that looks
 * like a credential rather than trusting every caller to remember. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object")
    return typeof value === "string" && value.length > 500
      ? value.slice(0, 500) + "…"
      : value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1),
    ]),
  );
}

export class SqliteAuditProvider implements AuditProvider {
  constructor(private readonly db: Database) {}
  async record(
    actor: { id: string; displayName: string } | null,
    event: AuditInput,
  ): Promise<void> {
    await this.db.write((h) => {
      h.run(
        `INSERT INTO audit_events(id, at, actor_id, actor_label, action, entity_type, entity_id, summary, metadata)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          newId(),
          nowIso(),
          actor?.id ?? null,
          actor?.displayName ?? "System",
          event.action,
          event.entityType,
          event.entityId ?? null,
          event.summary.slice(0, 500),
          event.metadata ? JSON.stringify(scrub(event.metadata)) : null,
        ],
      );
    });
  }
  async query(filter: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit?: number;
    before?: string;
  }): Promise<AuditEvent[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.entityType)
      (where.push("entity_type = ?"), params.push(filter.entityType));
    if (filter.entityId)
      (where.push("entity_id = ?"), params.push(filter.entityId));
    if (filter.actorId)
      (where.push("actor_id = ?"), params.push(filter.actorId));
    if (filter.before) (where.push("at < ?"), params.push(filter.before));
    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    return this.db.read((h) =>
      h
        .all<{
          id: string;
          at: string;
          actor_id: string | null;
          actor_label: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          summary: string;
          metadata: string | null;
        }>(
          `SELECT * FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""}
           ORDER BY at DESC, id DESC LIMIT ?`,
          [...params, limit],
        )
        .map((r) => ({
          id: r.id,
          at: r.at,
          actorId: r.actor_id,
          actorLabel: r.actor_label,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          summary: r.summary,
          metadata: r.metadata
            ? (JSON.parse(r.metadata) as Record<string, unknown>)
            : null,
        })),
    );
  }
}
