import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { intraforgeIssuer } from "./config";
/**
 * Minimal JWKS fetch + RS256 verification — hand-rolled with Node's
 * built-in `crypto` (which accepts a JWK directly via
 * `createPublicKey({format:"jwk", key})`) rather than adding a JWT
 * dependency for the one algorithm IntraForge's provider issues.
 * Deliberately NOT a general-purpose JWT library: no algorithm
 * negotiation, `alg: "none"` is never accepted, and only RS256 is
 * implemented — exactly what docs/INTRAFORGE_OIDC_PROVIDER.md documents
 * the provider as issuing.
 */
interface Jwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
}
let cachedKeys: { keys: Jwk[]; fetchedAt: number } | undefined;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
async function getJwks(): Promise<Jwk[]> {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedKeys.keys;
  }
  const issuer = intraforgeIssuer();
  const url = new URL("/oauth/jwks.json", issuer);
  if (url.origin !== new URL(issuer).origin) {
    throw new Error(
      "intraforge: refused to fetch JWKS outside the configured issuer origin.",
    );
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error(
      `intraforge: JWKS fetch failed with status ${response.status}.`,
    );
  const body = (await response.json()) as { keys: Jwk[] };
  cachedKeys = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}
function toPublicKey(jwk: Jwk): KeyObject {
  return createPublicKey({
    key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
    format: "jwk",
  });
}
function base64urlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
export interface IdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
}
export class IdTokenVerificationError extends Error {}
/** Verifies signature (RS256, against the issuer's published JWKS),
 * `iss`, `aud`, `exp`, and (if provided) `nonce` — every check the
 * OIDC Core spec requires an RP to perform before trusting an ID
 * token's claims. */
export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce?: string },
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3)
    throw new IdTokenVerificationError("Malformed ID token.");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlDecode(headerB64).toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") {
    throw new IdTokenVerificationError(
      `Unsupported/unexpected ID token algorithm: ${header.alg}.`,
    );
  }
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk)
    throw new IdTokenVerificationError(
      "ID token signed by an unknown key (kid not in JWKS).",
    );

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(
    toPublicKey(jwk),
    base64urlDecode(signatureB64),
  );
  if (!signatureValid)
    throw new IdTokenVerificationError(
      "ID token signature verification failed.",
    );

  const claims = JSON.parse(
    base64urlDecode(payloadB64).toString("utf8"),
  ) as IdTokenClaims;
  const issuer = intraforgeIssuer();
  if (claims.iss !== issuer) {
    throw new IdTokenVerificationError(`Unexpected issuer: ${claims.iss}.`);
  }
  if (claims.aud !== expected.clientId) {
    throw new IdTokenVerificationError("Unexpected audience.");
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new IdTokenVerificationError("ID token has expired.");
  }
  if (expected.nonce && claims.nonce !== expected.nonce) {
    throw new IdTokenVerificationError("Nonce mismatch — possible replay.");
  }
  if (!claims.sub)
    throw new IdTokenVerificationError("ID token has no subject.");
  return claims;
}
