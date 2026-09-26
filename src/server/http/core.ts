import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  AppError,
  forbidden,
  unauthorized,
  validation,
} from "../kernel/errors";
import type { App } from "../domain/app";
import type { AppContainer } from "../standalone/container";
import type { Actor } from "../domain/types";
import type { AuthenticatedSession } from "../providers/core";
import { requirePermission, type Permission } from "../domain/permissions";
import { BASE_PATH } from "../../lib/basePath";

/**
 * The transport layer. It knows about HTTP (cookies, CSRF, bodies, status
 * codes) and nothing about business rules: every route names the permission
 * it needs and hands typed input to a domain service. It is framework
 * neutral (Web Request/Response), so tests call it directly and Next.js
 * mounts it from one catch-all route file.
 */
export const SESSION_COOKIE = "sp_session";
export const API_PREFIX = "/api/v1";
const PREFIXES = [BASE_PATH + API_PREFIX, API_PREFIX];

export interface Query {
  str(name: string): string | undefined;
  int(name: string): number | undefined;
  bool(name: string): boolean | undefined;
}
export interface Ctx {
  req: Request;
  app: App;
  container: AppContainer;
  params: Record<string, string>;
  query: Query;
  /** Present on every non-public route. */
  actor: Actor;
  session: AuthenticatedSession | null;
  ip: string | null;
  /** Parsed JSON object body (limited to 1 MB). */
  json(): Promise<Record<string, unknown>>;
  /** Raw body bytes, bounded by the route's maxBytes. */
  bytes(): Promise<Uint8Array>;
  /** multipart/form-data, bounded by the route's maxBytes. */
  form(): Promise<FormData>;
  /** Cookie to set on the response (login / logout). */
  setSession(token: string | null): void;
  /** The session token the request carried, if any. */
  sessionToken: string | undefined;
}
export type Result =
  | { status?: number; data?: unknown }
  | {
      status?: number;
      binary: {
        bytes: Uint8Array;
        mime: string;
        fileName?: string;
        inline?: boolean;
      };
    }
  | {
      status?: number;
      text: { body: string; mime: string; fileName?: string };
    };
export interface RouteOptions {
  /** No session required (login, first-run setup). */
  public?: boolean;
  permission?: Permission;
  /** Upload limit in bytes for bytes()/form(); JSON is always ≤ 1 MB. */
  maxBytes?: number;
  /** Allowed while the account must still change its password. */
  allowMustChange?: boolean;
}
type Handler = (ctx: Ctx) => Promise<Result | void> | Result | void;
interface Route {
  method: string;
  parts: string[];
  options: RouteOptions;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];
  add(
    method: string,
    pattern: string,
    options: RouteOptions,
    handler: Handler,
  ) {
    this.routes.push({
      method,
      parts: pattern.split("/").filter(Boolean),
      options,
      handler,
    });
  }
  get(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("GET", pattern, options, handler);
  }
  post(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("POST", pattern, options, handler);
  }
  put(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("PUT", pattern, options, handler);
  }
  patch(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("PATCH", pattern, options, handler);
  }
  delete(pattern: string, options: RouteOptions, handler: Handler) {
    this.add("DELETE", pattern, options, handler);
  }
  /** Every registered route, for generated documentation and tests. */
  entries(): { method: string; path: string; options: RouteOptions }[] {
    return this.routes.map((r) => ({
      method: r.method,
      path: "/" + r.parts.join("/"),
      options: r.options,
    }));
  }
  match(
    method: string,
    segments: string[],
  ):
    | { route: Route; params: Record<string, string> }
    | { methods: string[] }
    | null {
    const allowed = new Set<string>();
    for (const route of this.routes) {
      if (route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segments.length && ok; i++) {
        const p = route.parts[i];
        if (p.startsWith(":")) params[p.slice(1)] = segments[i];
        else if (p !== segments[i]) ok = false;
      }
      if (!ok) continue;
      if (route.method === method) return { route, params };
      allowed.add(route.method);
    }
    return allowed.size ? { methods: [...allowed] } : null;
  }
}

const JSON_LIMIT = 1024 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore a malformed cookie value */
      }
    }
  }
  return out;
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Reads a request body but stops (and refuses) as soon as it exceeds `max`. */
async function readBounded(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max)
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `The upload is larger than the ${Math.round(max / 1024 / 1024)} MB limit.`,
      413,
    );
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.releaseLock();
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `The upload is larger than the ${Math.round(max / 1024 / 1024)} MB limit.`,
        413,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const query = (u: URL): Query => ({
  str: (n) => {
    const v = u.searchParams.get(n);
    return v === null || v === "" ? undefined : v;
  },
  int: (n) => {
    const v = u.searchParams.get(n);
    if (v === null || v === "") return undefined;
    if (!/^-?\d{1,9}$/.test(v))
      throw validation(`${n} must be a whole number.`);
    return Number(v);
  },
  bool: (n) => {
    const v = u.searchParams.get(n);
    if (v === null || v === "") return undefined;
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    throw validation(`${n} must be true or false.`);
  },
});

export interface HttpOptions {
  /** Extra origins allowed to make state-changing calls (comma list in env). */
  allowedOrigins?: string[];
  secureCookies?: boolean;
  log?: (line: string) => void;
  /** Session cookie name and path. On IntraForge the cookie is the
   * application session IntraForge set on the launch path. */
  sessionCookie?: string;
  cookiePath?: string;
}

export function createHttpHandler(
  router: Router,
  boot: () => Promise<{ app: App; container: AppContainer }>,
  opts: HttpOptions = {},
) {
  const log = opts.log ?? ((line: string) => console.error(line));
  const cookieName = opts.sessionCookie ?? SESSION_COOKIE;
  const loginBuckets = new Map<string, { n: number; reset: number }>();

  function sameOrigin(req: Request): boolean {
    const origin = req.headers.get("origin");
    if (!origin) return true; // non-browser clients; the CSRF token still applies to sessions
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const own =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      new URL(req.url).host;
    return host === own || (opts.allowedOrigins ?? []).includes(origin);
  }

  function respond(
    result: Result | void,
    cookie: string | undefined,
    requestId: string,
  ): Response {
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("X-Request-Id", requestId);
    if (cookie !== undefined) headers.append("Set-Cookie", cookie);
    if (result && "binary" in result) {
      const b = result.binary;
      headers.set("Content-Type", b.mime);
      headers.set("Content-Length", String(b.bytes.byteLength));
      headers.set(
        "Content-Disposition",
        `${b.inline ? "inline" : "attachment"}${b.fileName ? `; filename="${b.fileName.replace(/[^\w.\- ]/g, "_")}"` : ""}`,
      );
      // Stored files are never allowed to run script, whatever their type.
      if (b.mime !== "application/pdf")
        headers.set(
          "Content-Security-Policy",
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        );
      headers.set("Cache-Control", "private, max-age=300");
      return new Response(b.bytes as unknown as BodyInit, {
        status: result.status ?? 200,
        headers,
      });
    }
    if (result && "text" in result) {
      const t = result.text;
      headers.set("Content-Type", `${t.mime}; charset=utf-8`);
      headers.set(
        "Content-Disposition",
        `attachment${t.fileName ? `; filename="${t.fileName.replace(/[^\w.\- ]/g, "_")}"` : ""}`,
      );
      return new Response(t.body, { status: result.status ?? 200, headers });
    }
    headers.set("Content-Type", "application/json; charset=utf-8");
    const status = result?.status ?? 200;
    if (status === 204) return new Response(null, { status, headers });
    return new Response(
      JSON.stringify({ data: result && "data" in result ? result.data : null }),
      { status, headers },
    );
  }
  function fail(e: unknown, requestId: string, cookie?: string): Response {
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("X-Request-Id", requestId);
    if (cookie !== undefined) headers.append("Set-Cookie", cookie);
    if (e instanceof AppError) {
      if (e.status === 429) headers.set("Retry-After", "60");
      return new Response(
        JSON.stringify({
          error: {
            code: e.code,
            message: e.message,
            details: e.details,
            requestId,
          },
        }),
        { status: e.status, headers },
      );
    }
    // An unexpected fault: full detail goes to the server log only.
    log(
      `[${requestId}] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
    return new Response(
      JSON.stringify({
        error: {
          code: "INTERNAL",
          message: `Something went wrong on the server. Reference: ${requestId}.`,
          requestId,
        },
      }),
      { status: 500, headers },
    );
  }

  return async function handle(req: Request): Promise<Response> {
    const requestId = randomUUID().slice(0, 8);
    let cookieOut: string | undefined;
    try {
      const url = new URL(req.url);
      const prefix = PREFIXES.find((p) => url.pathname.startsWith(p));
      const path = prefix ? url.pathname.slice(prefix.length) : url.pathname;
      let segments: string[];
      try {
        segments = path
          .split("/")
          .filter(Boolean)
          .map((s) => decodeURIComponent(s));
      } catch {
        throw validation("The address is malformed.");
      }
      if (segments.some((s) => s.includes("\0") || s.length > 300))
        throw validation("The address is malformed.");
      const matched = router.match(req.method.toUpperCase(), segments);
      if (!matched) throw new AppError("NOT_FOUND", "No such endpoint.", 404);
      if ("methods" in matched) {
        const e = new AppError(
          "METHOD_NOT_ALLOWED",
          "That method is not allowed here.",
          405,
        );
        const res = fail(e, requestId);
        res.headers.set("Allow", matched.methods.join(", "));
        return res;
      }
      const { route, params } = matched;
      const unsafe = !["GET", "HEAD"].includes(req.method.toUpperCase());
      if (unsafe && !sameOrigin(req))
        throw forbidden("Cross-site requests are not allowed.");

      const { app, container } = await boot();
      const ip =
        (req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
          req.headers.get("x-real-ip")) ??
        null;
      const secure =
        opts.secureCookies ??
        (url.protocol === "https:" ||
          req.headers.get("x-forwarded-proto") === "https");
      const cookies = parseCookies(req.headers.get("cookie"));
      const token = cookies[cookieName];

      let session: AuthenticatedSession | null = null;
      if (!route.options.public) {
        session = await app.identity.authenticate(token);
        if (!session) throw unauthorized();
        if (unsafe) {
          const sent = req.headers.get("x-csrf-token") ?? "";
          if (!sent || !safeEqual(sent, session.csrfToken))
            throw forbidden(
              "The security token is missing or has expired. Reload the page and try again.",
            );
        }
        if (session.mustChangePassword && !route.options.allowMustChange)
          throw new AppError(
            "PASSWORD_CHANGE_REQUIRED",
            "You must change your password before continuing.",
            403,
          );
        if (route.options.permission)
          requirePermission(session.actor, route.options.permission);
      } else if (unsafe && route.options.public) {
        const key = ip ?? "unknown";
        const now = Date.now();
        const b = loginBuckets.get(key);
        if (!b || b.reset < now)
          loginBuckets.set(key, { n: 1, reset: now + 60_000 });
        else if (++b.n > 30)
          throw new AppError(
            "RATE_LIMITED",
            "Too many attempts. Wait a minute and try again.",
            429,
          );
        if (loginBuckets.size > 5000)
          for (const [k, v] of loginBuckets)
            if (v.reset < now) loginBuckets.delete(k);
      }

      let cached: Promise<Uint8Array> | null = null;
      const max = route.options.maxBytes ?? JSON_LIMIT;
      const bodyBytes = (limit: number) => (cached ??= readBounded(req, limit));
      const ctx: Ctx = {
        req,
        app,
        container,
        params,
        query: query(url),
        actor: session?.actor as Actor,
        session,
        ip,
        json: async () => {
          const ct = req.headers.get("content-type") ?? "";
          if (!/^application\/json\b/i.test(ct))
            throw new AppError(
              "UNSUPPORTED_MEDIA_TYPE",
              "Send the request as application/json.",
              415,
            );
          const bytes = await bodyBytes(Math.min(max, JSON_LIMIT));
          if (!bytes.length) return {};
          let parsed: unknown;
          try {
            parsed = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
          } catch {
            throw validation("The request body is not valid JSON.");
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw validation("The request body must be a JSON object.");
          return parsed as Record<string, unknown>;
        },
        bytes: () => bodyBytes(max),
        form: async () => {
          const ct = req.headers.get("content-type") ?? "";
          if (!/^multipart\/form-data\b/i.test(ct))
            throw new AppError(
              "UNSUPPORTED_MEDIA_TYPE",
              "Send the request as multipart/form-data.",
              415,
            );
          const bytes = await bodyBytes(max);
          try {
            return await new Response(bytes as unknown as BodyInit, {
              headers: { "content-type": ct },
            }).formData();
          } catch {
            throw validation("The upload could not be read.");
          }
        },
        sessionToken: token,
        setSession: (t) => {
          const attrs = [
            `Path=${opts.cookiePath ?? "/"}`,
            "HttpOnly",
            "SameSite=Lax",
            secure ? "Secure" : "",
          ].filter(Boolean);
          cookieOut =
            t === null
              ? `${cookieName}=; Max-Age=0; ${attrs.join("; ")}`
              : `${cookieName}=${encodeURIComponent(t)}; Max-Age=${60 * 60 * 24 * 7}; ${attrs.join("; ")}`;
        },
      };
      const result = await route.handler(ctx);
      return respond(result, cookieOut, requestId);
    } catch (e) {
      return fail(e, requestId, cookieOut);
    }
  };
}
