import { toyotaEpcConfig, TOYOTA_EPC_BASE_URL } from "./config";
/**
 * Guarded HTTP transport for the Toyota EPC aggregator. Every request:
 *  - is refused outright, before any network access, unless
 *    `TOYOTA_EPC_ENABLED=true` (config.ts);
 *  - is built with `new URL(path, baseUrl)` and re-checked against the
 *    fixed origin afterwards, so a hostile path segment (VIN, part
 *    number, catalog code — all ultimately operator/user-supplied) can
 *    never redirect the request off this one allowlisted host (SSRF);
 *  - has an explicit timeout and a small bounded retry with backoff for
 *    transient failures and 429s, never for 4xx;
 *  - is logged as a structured event without ever printing full response
 *    bodies (only status, path shape and duration).
 */
export interface ToyotaEpcTransportError extends Error {
  status?: number;
}
function toError(message: string, status?: number): ToyotaEpcTransportError {
  const error = new Error(message) as ToyotaEpcTransportError;
  if (status !== undefined) error.status = status;
  return error;
}
function buildUrl(path: string, query?: Record<string, string | undefined>) {
  const url = new URL(path, TOYOTA_EPC_BASE_URL);
  if (url.origin !== new URL(TOYOTA_EPC_BASE_URL).origin)
    throw toError(
      `toyota-epc: refused to request outside the allowlisted host (${url.origin}).`,
    );
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  return url;
}
function logEvent(event: Record<string, unknown>) {
  // Structured, single-line, no response bodies or secrets — this API
  // requires no key/token, so there is nothing sensitive to redact beyond
  // keeping bodies out of the log.
  const line = JSON.stringify({ source: "toyota-epc", ...event });
  if (event.level === "error") console.error(line);
  else console.warn(line);
}
export async function fetchToyotaEpc<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const config = toyotaEpcConfig();
  if (!config.enabled)
    throw toError(
      'toyota-epc: provider is disabled (TOYOTA_EPC_ENABLED is not "true"). No request was made.',
    );
  const url = buildUrl(path, query);
  const started = Date.now();
  const attempts = config.maxRetries + 1;
  let lastError: Error = toError("toyota-epc: request never attempted.");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        logEvent({
          level: retryable ? "warn" : "error",
          path,
          status: response.status,
          attempt,
        });
        lastError = toError(
          `toyota-epc: request failed with status ${response.status}.`,
          response.status,
        );
        if (!retryable) throw lastError;
        if (attempt < attempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** (attempt - 1)),
          );
          continue;
        }
        throw lastError;
      }
      const body = (await response.json()) as {
        data?: T;
        error?: { message?: string };
      };
      if (body.error)
        throw toError(
          `toyota-epc: ${body.error.message ?? "API returned an error envelope."}`,
        );
      if (body.data === undefined)
        throw toError('toyota-epc: response had no "data" field.');
      return body.data;
    } catch (error) {
      lastError = error as Error;
      const status = (error as ToyotaEpcTransportError).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= attempts) break;
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * 2 ** (attempt - 1)),
      );
    }
  }
  logEvent({
    level: "error",
    path,
    attempts,
    durationMs: Date.now() - started,
    message: lastError.message,
  });
  throw lastError;
}
