import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "../../../auth/oidc";
import { randomToken } from "../../../auth/pkce";
import {
  TXN_COOKIE_NAME,
  isSafeReturnTo,
  serializeTxn,
} from "../../../auth/txnCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /auth/login?returnTo=/oem/04465-0K290` — starts the
 * Authorization Code + PKCE flow against IntraForge. A real, top-level
 * browser redirect (never a fetch()) so the ensuing chain — IntraForge's
 * own login/register/welcome pages, then back here — all happen as
 * ordinary page navigations.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedReturnTo = url.searchParams.get("returnTo");
  const returnTo = isSafeReturnTo(requestedReturnTo) ? requestedReturnTo : "/";

  const state = randomToken();
  const codeVerifier = randomToken();
  const nonce = randomToken();

  const authorizeUrl = buildAuthorizeUrl({ state, codeVerifier, nonce });

  const store = await cookies();
  store.set(
    TXN_COOKIE_NAME,
    serializeTxn({ state, codeVerifier, nonce, returnTo }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
      maxAge: 600,
    },
  );

  return Response.redirect(authorizeUrl, 302);
}
