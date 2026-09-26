/**
 * Server-only config for this app's *own* private OEM part/diagram
 * catalogue — stored in IntraForge (Postgres + object storage), reached
 * via a bearer-token Application credential, not to be confused with
 * `src/auth/config.ts` (the OAuth client used for end-user "Sign in with
 * IntraForge"). See docs/CATALOGUE_STORAGE.md.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export function catalogueStorageEnabled(): boolean {
  return Boolean(
    process.env.INTRAFORGE_CATALOGUE_BEARER_TOKEN &&
    process.env.INTRAFORGE_ISSUER,
  );
}

export function catalogueStorageIssuer(): string {
  return requireEnv("INTRAFORGE_ISSUER").replace(/\/$/, "");
}

export function catalogueStorageBearerToken(): string {
  return requireEnv("INTRAFORGE_CATALOGUE_BEARER_TOKEN");
}

/**
 * Whether the browser may load a not-locally-stored diagram straight from
 * its source's own URL (an <img> pointing at the provider — nothing is
 * downloaded, cached or re-hosted by this app or IntraForge, and the
 * source is credited on screen). Off unless explicitly enabled, because
 * the source's own legal notice disclaims a redistribution licence — see
 * docs/CATALOGUE_STORAGE.md "Image handling". Locally stored,
 * permission-confirmed images are unaffected by this flag.
 */
export function externalDiagramImagesEnabled(): boolean {
  return process.env.CATALOGUE_SHOW_EXTERNAL_DIAGRAMS?.trim() === "true";
}
