import { intraforgeAuthConfig, intraforgeIssuer } from "./config";
import { codeChallengeFromVerifier } from "./pkce";
/**
 * Authorization Code + PKCE against IntraForge — the client (this
 * app's own backend) side of docs/INTRAFORGE_OIDC_PROVIDER.md. Every
 * request to the issuer is built via `new URL(path, issuer)` and
 * re-checked against the configured origin before being sent, the same
 * SSRF-safe pattern as src/integrations/catalogues/toyota-epc/transport.ts
 * — `redirect_uri`/`code`/`code_verifier` never come from anywhere but
 * this server's own generated values or the callback's own query
 * string, but the discipline costs nothing and matches the rest of this
 * codebase.
 */
function issuerUrl(path: string): URL {
  const issuer = intraforgeIssuer();
  const url = new URL(path, issuer);
  if (url.origin !== new URL(issuer).origin) {
    throw new Error(
      `intraforge: refused to request outside the configured issuer origin (${url.origin}).`,
    );
  }
  return url;
}
export function buildAuthorizeUrl(params: {
  state: string;
  codeVerifier: string;
  nonce: string;
}): string {
  const config = intraforgeAuthConfig();
  const url = issuerUrl("/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set(
    "code_challenge",
    codeChallengeFromVerifier(params.codeVerifier),
  );
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", params.nonce);
  return url.toString();
}
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}
export class TokenExchangeError extends Error {
  constructor(
    public readonly oauthError: string,
    description: string,
  ) {
    super(`${oauthError}: ${description}`);
  }
}
export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const config = intraforgeAuthConfig();
  const response = await fetch(issuerUrl("/oauth/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      redirect_uri: config.redirectUri,
      code_verifier: params.codeVerifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || body.error) {
    throw new TokenExchangeError(
      body.error ?? "unknown_error",
      body.error_description ?? "Token exchange failed.",
    );
  }
  return body as TokenResponse;
}
export async function revokeAccessToken(accessToken: string): Promise<void> {
  await fetch(issuerUrl("/oauth/revoke"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: accessToken }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined); // best-effort: local logout must not fail if this does.
}
