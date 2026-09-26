import { randomBytes, createHash } from "node:crypto";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** High-entropy random string for `state`, `nonce`, and the PKCE
 * `code_verifier` — the same primitive for all three, since all three
 * are opaque, server-generated, single-use random tokens. */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** S256 only — PKCE `plain` is never generated or accepted (matches
 * IntraForge's own provider, which rejects anything but S256). */
export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}
