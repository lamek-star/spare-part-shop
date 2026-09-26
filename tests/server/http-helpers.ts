import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../../src/server/standalone/container";
import { createApp } from "../../src/server/domain/app";
import { createHttpHandler } from "../../src/server/http/core";
import { buildRouter } from "../../src/server/http/routes";
import type { Role } from "../../src/server/domain/types";

export interface Reply {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw: Uint8Array;
}
export class Client {
  cookie = "";
  csrf = "";
  constructor(
    private readonly handle: (r: Request) => Promise<Response>,
    readonly origin = "http://shop.test",
  ) {}
  async send(method: string, path: string, opts: { json?: unknown; form?: FormData; body?: BodyInit; headers?: Record<string, string>; csrf?: boolean; origin?: string | null } = {}): Promise<Reply> {
    const headers: Record<string, string> = { host: new URL(this.origin).host, ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false && this.csrf && method !== "GET") headers["x-csrf-token"] = this.csrf;
    if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? this.origin;
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    if (opts.form) body = opts.form;
    const res = await this.handle(new Request(`${this.origin}/api/v1${path}`, { method, headers, body }));
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0];
      this.cookie = /=$/.test(pair) ? "" : pair;
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    let parsed: unknown = null;
    if ((res.headers.get("content-type") ?? "").includes("json") && raw.length) parsed = JSON.parse(new TextDecoder().decode(raw));
    const p = parsed as { data?: unknown } | null;
    return { status: res.status, headers: res.headers, body: parsed, data: p?.data, raw };
  }
  get = (p: string, o = {}) => this.send("GET", p, o);
  post = (p: string, json?: unknown, o = {}) => this.send("POST", p, { json: json ?? {}, ...o });
  put = (p: string, json?: unknown, o = {}) => this.send("PUT", p, { json: json ?? {}, ...o });
  patch = (p: string, json?: unknown, o = {}) => this.send("PATCH", p, { json: json ?? {}, ...o });
  del = (p: string, o = {}) => this.send("DELETE", p, o);
  async login(email: string, password = "correct-horse-battery"): Promise<Reply> {
    this.cookie = "";
    this.csrf = "";
    const r = await this.post("/auth/login", { email, password });
    if (r.status === 200) this.csrf = r.data.csrfToken;
    return r;
  }
}
export interface HttpApp {
  client(): Client;
  as(role: Role): Promise<Client>;
  logs: string[];
  dir: string;
  cleanup(): Promise<void>;
  container: Awaited<ReturnType<typeof createContainer>>;
}
/** Boots the whole stack (real SQLite, real router) with one user per role. */
export async function makeHttpApp(): Promise<HttpApp> {
  const dir = mkdtempSync(join(tmpdir(), "sp-http-"));
  const container = await createContainer({ dataDir: dir });
  const app = createApp(container);
  const logs: string[] = [];
  const handle = createHttpHandler(buildRouter(), async () => ({ app, container }), { log: (l) => logs.push(l) });
  const anon = () => new Client(handle);
  const setup = anon();
  const r = await setup.post("/auth/setup", { email: "owner@example.test", displayName: "Olivia Owner", password: "correct-horse-battery", shopName: "Test Auto Parts" });
  if (r.status !== 201) throw new Error("setup failed: " + JSON.stringify(r.body));
  setup.csrf = r.data.csrfToken;
  for (const role of ["ADMIN", "SALES", "INVENTORY", "VIEWER"] as const) {
    const c = await setup.post("/users", { email: `${role.toLowerCase()}@example.test`, displayName: `${role} User`, role, password: "correct-horse-battery", mustChangePassword: false });
    if (c.status !== 201) throw new Error("user failed: " + JSON.stringify(c.body));
  }
  return {
    client: anon,
    async as(role) {
      const c = anon();
      const l = await c.login(`${role.toLowerCase()}@example.test`);
      if (l.status !== 200) throw new Error(`login ${role}: ${JSON.stringify(l.body)}`);
      return c;
    },
    logs,
    dir,
    container,
    async cleanup() {
      await container.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
