/**
 * Where the application is served. Empty when it runs on its own; on
 * IntraForge it is served on IntraForge's origin under its launch path
 * (e.g. "/apps/spare-parts"), set at build time so Next.js and the browser
 * code agree. Every raw URL to the API goes through apiUrl(); <Link> adds
 * the base path by itself.
 */
const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
if (raw && !/^(\/[a-z0-9-]+)+$/.test(raw))
  throw new Error(`Invalid NEXT_PUBLIC_BASE_PATH: ${raw}`);

export const BASE_PATH = raw;
export const API_PREFIX = "/api/v1";
export const apiUrl = (path: string) => `${BASE_PATH}${API_PREFIX}${path}`;
