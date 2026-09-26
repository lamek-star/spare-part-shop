import { randomUUID } from "node:crypto";
export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Same rule as the rest of the application: strip spaces/dashes, upper-case. */
export const normalizeNumber = (value: string): string =>
  value.toUpperCase().replace(/[\s-]/g, "");
