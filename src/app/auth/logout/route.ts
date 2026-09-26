import { cookies } from "next/headers";
import { deleteSession } from "../../../auth/store";
import { SESSION_COOKIE_NAME } from "../../../auth/txnCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /auth/logout` — ends this app's own local session only.
 * Deliberately does not also end the IntraForge identity session (RP-
 * initiated logout / IntraForge's own `/auth/logout/`): a customer
 * signing out of the spare-parts site has no reason to expect that to
 * also sign them out of IntraForge itself, and IntraForge's session
 * cookie is same-origin-only from this app's perspective anyway (it
 * cannot be reached or cleared from here). See
 * docs/SPARE_PARTS_AUTH_INTEGRATION.md "Logout" for the deferred global-
 * logout option.
 */
export async function POST() {
  const store = await cookies();
  deleteSession(store.get(SESSION_COOKIE_NAME)?.value);
  store.delete(SESSION_COOKIE_NAME);
  return new Response(null, { status: 204 });
}
