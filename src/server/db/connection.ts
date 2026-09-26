import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SqlParam =
  string | number | bigint | boolean | null | undefined | Uint8Array;
const bind = (params: SqlParam[]) =>
  params.map((p) =>
    p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p,
  );

/** Synchronous SQL handle. Only ever handed out inside Database.run(), so
 * every statement executes while the caller holds the database lock. */
export class Handle {
  private cache = new Map<string, StatementSync>();
  constructor(readonly raw: DatabaseSync) {}
  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  run(sql: string, params: SqlParam[] = []) {
    const r = this.stmt(sql).run(...(bind(params) as never[]));
    return {
      changes: Number(r.changes),
      lastInsertRowid: Number(r.lastInsertRowid),
    };
  }
  get<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = [],
  ): T | undefined {
    return this.stmt(sql).get(...(bind(params) as never[])) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
    return this.stmt(sql).all(...(bind(params) as never[])) as T[];
  }
  /** Number of rows matched by a `SELECT COUNT(*) AS n ...` query. */
  count(sql: string, params: SqlParam[] = []): number {
    const row = this.get<{ n: number }>(sql, params);
    return Number(row?.n ?? 0);
  }
}

export type RunMode = "read" | "write";
interface Context {
  handle: Handle;
  mode: RunMode;
}

/**
 * One SQLite file, one connection, strict serialization. Every operation
 * runs through run(): callers queue behind each other, so a write
 * transaction can never observe (or leak) another request's uncommitted
 * rows, and a failure rolls the whole operation back. Nested run() calls
 * inside an operation join it instead of re-locking.
 */
export class Database {
  private tail: Promise<void> = Promise.resolve();
  private readonly context = new AsyncLocalStorage<Context>();
  private closed = false;
  readonly handle: Handle;
  private constructor(
    readonly file: string,
    raw: DatabaseSync,
  ) {
    this.handle = new Handle(raw);
  }
  static open(file: string): Database {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") {
      raw.exec("PRAGMA journal_mode = WAL");
      raw.exec("PRAGMA synchronous = FULL");
    }
    return new Database(file, raw);
  }
  async run<T>(mode: RunMode, fn: (h: Handle) => Promise<T> | T): Promise<T> {
    const outer = this.context.getStore();
    if (outer) {
      if (mode === "write" && outer.mode === "read")
        throw new Error(
          "Cannot start a write operation inside a read-only one.",
        );
      return fn(outer.handle);
    }
    if (this.closed) throw new Error("Database is closed.");
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await this.context.run({ handle: this.handle, mode }, async () => {
        if (mode === "write") this.handle.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(this.handle);
          if (mode === "write") this.handle.exec("COMMIT");
          return result;
        } catch (error) {
          if (mode === "write") {
            try {
              this.handle.exec("ROLLBACK");
            } catch {
              /* connection already rolled back */
            }
          }
          throw error;
        }
      });
    } finally {
      release();
    }
  }
  read<T>(fn: (h: Handle) => Promise<T> | T) {
    return this.run("read", fn);
  }
  write<T>(fn: (h: Handle) => Promise<T> | T) {
    return this.run("write", fn);
  }
  async close() {
    if (this.closed) return;
    await this.tail;
    this.closed = true;
    this.handle.raw.close();
  }
}
