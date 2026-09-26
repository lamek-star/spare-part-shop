import { AppError } from "../kernel/errors";

/**
 * Client for IntraForge's internal service-application API (ADR-0018 in the
 * IntraForge repository). It talks only to the one configured internal
 * address (the IntraForge backend on the private Docker network), never to
 * anything a user supplies, and authenticates with this deployment's
 * service token. Every call has a hard timeout; a failure surfaces as
 * PLATFORM_UNAVAILABLE (503), never as a hang.
 */
export interface PlatformEnv {
  internalUrl: string;
  serviceToken: string;
  timeoutMs: number;
}

export function platformEnv(env: NodeJS.ProcessEnv = process.env): PlatformEnv {
  const internalUrl = (env.INTRAFORGE_INTERNAL_URL ?? "").replace(/\/+$/, "");
  const serviceToken = env.INTRAFORGE_SERVICE_TOKEN ?? "";
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(internalUrl))
    throw new Error("INTRAFORGE_INTERNAL_URL must be http(s)://host[:port].");
  if (serviceToken.length < 32)
    throw new Error("INTRAFORGE_SERVICE_TOKEN is missing or too short.");
  return {
    internalUrl,
    serviceToken,
    timeoutMs: Number(env.INTRAFORGE_TIMEOUT_MS ?? 8000),
  };
}

const PREFIX = "/api/v1/internal/service-apps";

export class IntraForgeClient {
  constructor(private readonly env: PlatformEnv) {}

  private async request(
    method: string,
    path: string,
    init: { json?: unknown; body?: BodyInit; timeoutMs?: number } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      init.timeoutMs ?? this.env.timeoutMs,
    );
    try {
      return await fetch(`${this.env.internalUrl}${PREFIX}${path}`, {
        method,
        headers: {
          "X-IntraForge-Service-Token": this.env.serviceToken,
          ...(init.json !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          Accept: "application/json",
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async json<T>(
    method: string,
    path: string,
    json?: unknown,
    accept: number[] = [200, 201],
  ): Promise<{ status: number; data: T }> {
    const res = await this.request(method, path, { json });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!accept.includes(res.status)) {
      if (res.status === 403)
        throw new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          403,
        );
      if (res.status === 400)
        throw new AppError("VALIDATION", firstMessage(data), 400);
      throw unavailable();
    }
    return { status: res.status, data: data as T };
  }

  async upload(form: FormData) {
    const res = await this.request("POST", "/files/", {
      body: form,
      timeoutMs: 120_000,
    });
    const text = await res.text();
    if (res.status === 400)
      throw new AppError("VALIDATION", firstMessage(safeJson(text)), 400);
    if (res.status !== 201) throw unavailable();
    return safeJson(text) as {
      id: string;
      size: number;
      sha256: string;
      mime: string;
      quarantined: boolean;
    };
  }

  async download(id: string): Promise<Uint8Array | null> {
    const res = await this.request("GET", `/files/${encodeURIComponent(id)}/`, {
      timeoutMs: 120_000,
    });
    if (res.status === 404) return null;
    if (res.status !== 200) throw unavailable();
    return new Uint8Array(await res.arrayBuffer());
  }

  async deleteFile(id: string, actorId: string | null) {
    const res = await this.request(
      "DELETE",
      `/files/${encodeURIComponent(id)}/`,
      { json: { actorId } },
    );
    if (res.status !== 204 && res.status !== 404) throw unavailable();
  }
}

const unavailable = () =>
  new AppError(
    "PLATFORM_UNAVAILABLE",
    "IntraForge is not answering. Try again in a moment; if it persists, open the IntraForge Control Center.",
    503,
  );
const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
function firstMessage(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return firstMessage(data[0]);
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    const first = Object.values(d)[0];
    if (first !== undefined) return firstMessage(first);
  }
  return "The request was not accepted.";
}
