import { cookies } from "next/headers";
import { getSessionUser, type SparePartsUser } from "./store";
import { SESSION_COOKIE_NAME } from "./txnCookie";

/** Server-only — resolves the signed-in SparePartsUser (via IntraForge)
 * from the request's session cookie, or undefined if signed out. Use
 * from a Server Component, Route Handler, or Server Action; never
 * exposed to the browser directly (the cookie is HttpOnly). */
export async function getCurrentUser(): Promise<SparePartsUser | undefined> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE_NAME)?.value);
}
