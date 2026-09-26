"use client";
/** Browser client for the standalone API (/api/v1). Cookies carry the
 * session; state-changing calls also send the CSRF token from /auth/me. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
let csrf = "";
export const setCsrfToken = (t: string) => {
  csrf = t;
};
export const UNAUTHENTICATED_EVENT = "sp:unauthenticated";

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError("NETWORK", "Cannot reach the server. Check that the application is running.", 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: { data?: T; error?: { code: string; message: string; requestId?: string } } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = parsed.error;
    if (res.status === 401 && !path.startsWith("/auth/login") && typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    throw new ApiError(e?.code ?? "ERROR", e?.message ?? `The server answered ${res.status}.`, res.status, e?.requestId);
  }
  return parsed.data as T;
}
export const get = <T,>(path: string) => api<T>("GET", path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const put = <T,>(path: string, body: unknown = {}) => api<T>("PUT", path, body);
export const patch = <T,>(path: string, body: unknown = {}) => api<T>("PATCH", path, body);
export const del = <T,>(path: string) => api<T>("DELETE", path);

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

// ---------- formatting ----------
export function formatMoney(minor: number | null | undefined, currency = "AED"): string {
  if (minor === null || minor === undefined) return "—";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100).toLocaleString("en-US");
  return `${sign}${currency} ${whole}.${String(abs % 100).padStart(2, "0")}`;
}
/** "12.5" -> 1250. Returns null when the text is not a valid amount. */
export function parseMinor(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.replace("-", "").split(".");
  const minor = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return t.startsWith("-") ? -minor : minor;
}
export const minorToInput = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));
export const formatDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
export const formatDateTime = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
