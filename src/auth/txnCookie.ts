/**
 * The short-lived, httpOnly cookie carrying `state`/PKCE `code_verifier`/
 * `nonce`/`returnTo` between /api/auth/login issuing the authorize
 * redirect and /api/auth/callback receiving it back. Not signed: it is
 * httpOnly (never readable by page JS) and server-set/server-read only,
 * so the only party who could tamper with it already controls the
 * victim's cookie jar — a strictly worse position than forging this
 * cookie's contents would gain them. `state` is still checked against
 * the callback's own query param (CSRF/session-fixation defense), and
 * PKCE's own binding (services.py, IntraForge side) is what actually
 * defends the authorization code itself against interception.
 */
export const TXN_COOKIE_NAME = "sp_oauth_txn";
export const SESSION_COOKIE_NAME = "sp_session";
export interface OAuthTxn {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}
export function serializeTxn(txn: OAuthTxn): string {
  return Buffer.from(JSON.stringify(txn)).toString("base64url");
}
export function parseTxn(raw: string | undefined): OAuthTxn | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed.state === "string" &&
      typeof parsed.codeVerifier === "string" &&
      typeof parsed.nonce === "string" &&
      typeof parsed.returnTo === "string"
    ) {
      return parsed as OAuthTxn;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
/** Same rule as IntraForge's own frontend `isSafeNextPath`: a same-
 * origin, absolute-from-root path only — never used to build an open
 * redirect out of `?returnTo=`. */
export function isSafeReturnTo(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (value.includes("://")) return false;
  return true;
}
