import { validation } from "../kernel/errors";

/** Small, strict input helpers. Untrusted JSON goes through these before
 * it reaches a service, so services can rely on plain typed values. */
export function text(
  value: unknown,
  field: string,
  opts: { max?: number; required?: boolean } = {},
): string {
  const max = opts.max ?? 500;
  if (value === undefined || value === null || value === "") {
    if (opts.required) throw validation(`${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw validation(`${field} must be text.`);
  const trimmed = value.trim();
  if (opts.required && !trimmed) throw validation(`${field} is required.`);
  if (trimmed.length > max)
    throw validation(`${field} must be at most ${max} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed))
    throw validation(`${field} contains invalid characters.`);
  return trimmed;
}
export function optionalEmail(value: unknown, field = "Email"): string {
  const v = text(value, field, { max: 200 });
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    throw validation(`${field} is not a valid email address.`);
  return v;
}
export function currency(value: unknown, fallback = "AED"): string {
  const v =
    typeof value === "string" && value ? value.trim().toUpperCase() : fallback;
  if (!/^[A-Z]{3}$/.test(v))
    throw validation("Currency must be a 3-letter code such as AED.");
  return v;
}
export function integer(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; default?: number } = {},
): number {
  if (value === undefined || value === null || value === "") {
    if (opts.default !== undefined) return opts.default;
    throw validation(`${field} is required.`);
  }
  if (typeof value !== "number" || !Number.isInteger(value))
    throw validation(`${field} must be a whole number.`);
  if (opts.min !== undefined && value < opts.min)
    throw validation(`${field} must be at least ${opts.min}.`);
  if (opts.max !== undefined && value > opts.max)
    throw validation(`${field} must be at most ${opts.max}.`);
  return value;
}
/** Money on the wire is always integer minor units. */
export function moneyMinor(
  value: unknown,
  field: string,
  opts: { default?: number } = {},
): number {
  return integer(value, field, {
    min: 0,
    max: 9_000_000_000_000,
    default: opts.default,
  });
}
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback?: T,
): T {
  if (
    (value === undefined || value === null || value === "") &&
    fallback !== undefined
  )
    return fallback;
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  )
    throw validation(`${field} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}
export function isoDate(
  value: unknown,
  field: string,
  opts: { required?: boolean } = {},
): string | null {
  if (value === undefined || value === null || value === "") {
    if (opts.required) throw validation(`${field} is required.`);
    return null;
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw validation(`${field} must be a date (YYYY-MM-DD).`);
  return value;
}
export function record(
  value: unknown,
  what = "Request body",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validation(`${what} must be a JSON object.`);
  return value as Record<string, unknown>;
}
