import type { SqlDatabase } from "../db/connection";
import { nowIso } from "../kernel/ids";
import type { AuditInput } from "../providers/core";
import { insertAuditEvent, SqliteAuditProvider } from "../standalone/audit";
import type { IntraForgeClient } from "./intraforge";

/**
 * AuditProvider for IntraForge. The contract's ground rule 1 (an operation
 * and its audit trail commit together) is kept by writing the event -- and an
 * outbox entry -- in the application's own schema inside the caller's
 * transaction. The relay then sends committed events to IntraForge's audit
 * log (at least once; IntraForge records each event id exactly once) and
 * removes them from the outbox. History tabs read the local copy.
 */
export class PlatformAuditProvider extends SqliteAuditProvider {
  constructor(
    db: SqlDatabase,
    private readonly relay: AuditRelay,
  ) {
    super(db);
  }
  override async record(
    actor: { id: string; displayName: string } | null,
    event: AuditInput,
  ): Promise<void> {
    await this.db.write(async (h) => {
      const id = await insertAuditEvent(h, actor, event);
      await h.run(
        "INSERT INTO audit_outbox(event_id, queued_at) VALUES (?,?)",
        [id, nowIso()],
      );
    });
    this.db.afterCommit(() => this.relay.kick());
  }
}

interface EventRow {
  id: string;
  at: string;
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: string | null;
}

export class AuditRelay {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly db: SqlDatabase,
    private readonly client: IntraForgeClient,
    private readonly log: (line: string) => void = (l) => console.error(l),
    private readonly batch = 200,
  ) {}

  /** Relays anything still queued now and every `everyMs` (retries after an
   * outage, and events queued before a restart). */
  start(everyMs = 30_000) {
    this.kick();
    this.timer = setInterval(() => this.kick(), everyMs);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.flush()
      .catch((e) =>
        this.log(`audit relay: ${(e as Error)?.message ?? String(e)}`),
      )
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** Sends queued events until the outbox is empty or IntraForge refuses. */
  async flush(): Promise<number> {
    let sent = 0;
    for (;;) {
      const rows = await this.db.read((h) =>
        h.all<EventRow>(
          `SELECT e.* FROM audit_outbox o JOIN audit_events e ON e.id = o.event_id
            ORDER BY o.queued_at, e.id LIMIT ?`,
          [this.batch],
        ),
      );
      if (!rows.length) return sent;
      let accepted: string[];
      try {
        const { data } = await this.client.json<{ accepted: string[] }>(
          "POST",
          "/audit-events/",
          {
            events: rows.map((r) => ({
              id: r.id,
              at: r.at,
              actorId: r.actor_id,
              actorLabel: r.actor_label,
              action: r.action,
              entityType: r.entity_type,
              entityId: r.entity_id,
              summary: r.summary,
              metadata: r.metadata ? JSON.parse(r.metadata) : {},
            })),
          },
        );
        accepted = data.accepted;
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        await this.db.write((h) =>
          h.run(
            `UPDATE audit_outbox SET attempts = attempts + 1, last_error = ? WHERE event_id IN (${rows.map(() => "?").join(",")})`,
            [message.slice(0, 300), ...rows.map((r) => r.id)],
          ),
        );
        throw e;
      }
      if (!accepted.length) return sent;
      await this.db.write((h) =>
        h.run(
          `DELETE FROM audit_outbox WHERE event_id IN (${accepted.map(() => "?").join(",")})`,
          accepted,
        ),
      );
      sent += accepted.length;
      if (rows.length < this.batch) return sent;
    }
  }

  /** Waiting events (for diagnostics and health). */
  pending(): Promise<number> {
    return this.db.read((h) =>
      h.count("SELECT COUNT(*) AS n FROM audit_outbox"),
    );
  }
}
