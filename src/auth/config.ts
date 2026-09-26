/**
 * "Sign in with IntraForge" — OAuth 2.1-style Authorization Code + PKCE,
 * OpenID Connect on top. IntraForge is the identity provider; this app
 * never stores a password and never sees IntraForge's password store —
 * see docs/SPARE_PARTS_AUTH_INTEGRATION.md.
 *
 * All values are server-only env vars (no NEXT_PUBLIC_ prefix): the
 * authorize redirect is built and issued from a Route Handler, never
 * constructed in browser code, so the client secret is never reachable
 * from the browser.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export function intraforgeIssuer(): string {
  return requireEnv("INTRAFORGE_ISSUER").replace(/\/$/, "");
}

export interface IntraForgeAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scope: string;
}

export function intraforgeAuthConfig(): IntraForgeAuthConfig {
  return {
    issuer: intraforgeIssuer(),
    clientId: requireEnv("INTRAFORGE_CLIENT_ID"),
    clientSecret: requireEnv("INTRAFORGE_CLIENT_SECRET"),
    redirectUri: requireEnv("INTRAFORGE_REDIRECT_URI"),
    postLogoutRedirectUri:
      process.env.INTRAFORGE_POST_LOGOUT_REDIRECT_URI ?? "/",
    scope: "openid profile email",
  };
}
