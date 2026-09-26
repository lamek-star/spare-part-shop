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

/** Which SQL engine a handle talks to. Repositories write portable SQL and
 * branch on this only where the engines genuinely differ (full-text search,
 * date arithmetic, string aggregation). */
export type Dialect = "sqlite" | "postgres";

/**
 * The statement API every store implementation hands to repositories.
 * Asynchronous so the same repository code runs on the embedded SQLite
 * store and on IntraForge's PostgreSQL. Only ever handed out inside
 * SqlDatabase.run(), i.e. inside one transaction.
 */
export interface SqlHandle {
  readonly dialect: Dialect;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[],
  ): Promise<T | undefined>;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[],
  ): Promise<T[]>;
  /** Number of rows matched by a `SELECT COUNT(*) AS n ...` query. */
  count(sql: string, params?: SqlParam[]): Promise<number>;
}

export type RunMode = "read" | "write";

/** True when a statement failed on a CHECK constraint, on either engine
 * (SQLite reports it in the message, PostgreSQL as SQLSTATE 23514). */
export function isCheckViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === "23514" || /CHECK constraint/i.test(String(e?.message));
}

/** A transactional store: every read/write runs as one unit; nested calls
 * join the outer unit instead of opening a second one. */
export interface SqlDatabase {
  readonly dialect: Dialect;
  run<T>(mode: RunMode, fn: (h: SqlHandle) => Promise<T> | T): Promise<T>;
  read<T>(fn: (h: SqlHandle) => Promise<T> | T): Promise<T>;
  write<T>(fn: (h: SqlHandle) => Promise<T> | T): Promise<T>;
  /** Runs `fn` once the outermost unit around the caller has committed
   * (never if it rolls back); immediately when called outside a unit.
   * For effects outside the database -- deleting a stored file, relaying
   * audit events -- that must not happen for a rolled-back change. */
  afterCommit(fn: () => void | Promise<void>): void;
  close(): Promise<void>;
}

/** Synchronous SQLite statement cache; wrapped by SqliteHandle. */
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
    return { changes: Number(r.changes) };
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
}

/** The async statement API over the synchronous SQLite handle. */
class SqliteHandle implements SqlHandle {
  readonly dialect = "sqlite" as const;
  constructor(private readonly h: Handle) {}
  async exec(sql: string) {
    this.h.exec(sql);
  }
  async run(sql: string, params: SqlParam[] = []) {
    return this.h.run(sql, params);
  }
  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []) {
    return this.h.get<T>(sql, params);
  }
  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []) {
    return this.h.all<T>(sql, params);
  }
  async count(sql: string, params: SqlParam[] = []) {
    const row = this.h.get<{ n: number }>(sql, params);
    return Number(row?.n ?? 0);
  }
}

interface Context {
  handle: SqlHandle;
  mode: RunMode;
  committed: (() => void | Promise<void>)[];
}

/** Runs after-commit callbacks without letting one failure stop the rest
 * or surface into the request that already committed. */
export function runAfterCommit(
  callbacks: (() => void | Promise<void>)[],
): void {
  for (const fn of callbacks)
    Promise.resolve()
      .then(fn)
      .catch((e) =>
        console.error(
          `after-commit task failed: ${(e as Error)?.message ?? e}`,
        ),
      );
}

/**
 * One SQLite file, one connection, strict serialization. Every operation
 * runs through run(): callers queue behind each other, so a write
 * transaction can never observe (or leak) another request's uncommitted
 * rows, and a failure rolls the whole operation back. Nested run() calls
 * inside an operation join it instead of re-locking.
 */
export class Database implements SqlDatabase {
  readonly dialect = "sqlite" as const;
  private tail: Promise<void> = Promise.resolve();
  private readonly context = new AsyncLocalStorage<Context>();
  private closed = false;
  readonly handle: Handle;
  private readonly asyncHandle: SqlHandle;
  private constructor(
    readonly file: string,
    raw: DatabaseSync,
  ) {
    this.handle = new Handle(raw);
    this.asyncHandle = new SqliteHandle(this.handle);
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
  async run<T>(
    mode: RunMode,
    fn: (h: SqlHandle) => Promise<T> | T,
  ): Promise<T> {
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
    const committed: (() => void | Promise<void>)[] = [];
    let result: T;
    try {
      result = await this.context.run(
        { handle: this.asyncHandle, mode, committed },
        async () => {
          if (mode === "write") this.handle.exec("BEGIN IMMEDIATE");
          try {
            const value = await fn(this.asyncHandle);
            if (mode === "write") this.handle.exec("COMMIT");
            return value;
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
        },
      );
    } finally {
      release();
    }
    // Outside the unit's context: the callbacks start units of their own.
    runAfterCommit(committed);
    return result;
  }
  read<T>(fn: (h: SqlHandle) => Promise<T> | T) {
    return this.run("read", fn);
  }
  write<T>(fn: (h: SqlHandle) => Promise<T> | T) {
    return this.run("write", fn);
  }
  afterCommit(fn: () => void | Promise<void>) {
    const outer = this.context.getStore();
    if (outer) outer.committed.push(fn);
    else runAfterCommit([fn]);
  }
  async close() {
    if (this.closed) return;
    await this.tail;
    this.closed = true;
    this.handle.raw.close();
  }
}
