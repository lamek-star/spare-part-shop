import { getCurrentUser } from "../../../../auth/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/auth/me` — the browser's only way to know sign-in state;
 * the session cookie is HttpOnly (unreadable from page JS) by design. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ signedIn: false });
  return Response.json({
    signedIn: true,
    email: user.email,
    displayName: user.displayName,
  });
}
