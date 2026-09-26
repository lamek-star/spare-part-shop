import { cookies } from "next/headers";
import {
  exchangeCodeForTokens,
  revokeAccessToken,
  TokenExchangeError,
} from "../../../auth/oidc";
import { verifyIdToken, IdTokenVerificationError } from "../../../auth/jwks";
import { createSession, upsertUserFromIdentity } from "../../../auth/store";
import { intraforgeAuthConfig } from "../../../auth/config";
import {
  SESSION_COOKIE_NAME,
  TXN_COOKIE_NAME,
  parseTxn,
} from "../../../auth/txnCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /auth/callback` — IntraForge's registered `redirect_uri`.
 * Validates `state`, exchanges the code (server-to-server, client_secret
 * never reaching the browser), verifies the ID token's signature/
 * issuer/audience/expiry/nonce, maps to (or creates) this app's own
 * SparePartsUser by the token's `sub`, and starts a local, HttpOnly
 * session — see docs/SPARE_PARTS_AUTH_INTEGRATION.md.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  const txn = parseTxn(store.get(TXN_COOKIE_NAME)?.value);
  store.delete(TXN_COOKIE_NAME);

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return errorRedirect(providerError);
  }
  if (!txn) {
    return errorRedirect("missing_transaction");
  }
  const returnedState = url.searchParams.get("state");
  if (!returnedState || returnedState !== txn.state) {
    return errorRedirect("state_mismatch");
  }
  const code = url.searchParams.get("code");
  if (!code) {
    return errorRedirect("missing_code");
  }

  let idToken: string | undefined;
  let accessToken: string | undefined;
  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: txn.codeVerifier,
    });
    idToken = tokens.id_token;
    accessToken = tokens.access_token;
  } catch (error) {
    return errorRedirect(
      error instanceof TokenExchangeError
        ? error.oauthError
        : "token_exchange_failed",
    );
  }
  if (!idToken) {
    return errorRedirect("no_id_token_returned");
  }

  const config = intraforgeAuthConfig();
  try {
    const claims = await verifyIdToken(idToken, {
      clientId: config.clientId,
      nonce: txn.nonce,
    });
    const user = upsertUserFromIdentity({
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
    });
    const session = createSession(user.id);

    if (accessToken) await revokeAccessToken(accessToken); // best-effort; this app never needs it again.

    store.set(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return Response.redirect(new URL(txn.returnTo, url.origin), 302);
  } catch (error) {
    return errorRedirect(
      error instanceof IdTokenVerificationError
        ? "invalid_id_token"
        : "unexpected_error",
    );
  }
}

function errorRedirect(reason: string): Response {
  const safeReason = /^[a-z_]+$/.test(reason) ? reason : "unexpected_error";
  return new Response(null, {
    status: 302,
    headers: { Location: `/auth/error?reason=${safeReason}` },
  });
}
