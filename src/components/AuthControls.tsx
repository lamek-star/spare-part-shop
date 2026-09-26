"use client";
import { useEffect, useState } from "react";
import { LogIn, LogOut, User } from "lucide-react";
/**
 * Real "Sign in with IntraForge" controls — deliberately separate from
 * the `persona`/"Demo operator" selector elsewhere in this header
 * (Workspace.tsx): that one simulates an internal staff role for the
 * back-office demo (sessionStorage only, no real identity); this one is
 * the actual customer identity, backed by IntraForge via
 * /api/auth/{login,callback,logout,me} — see
 * docs/SPARE_PARTS_AUTH_INTEGRATION.md.
 */
interface Me {
  signedIn: boolean;
  email?: string;
  displayName?: string;
}
export function AuthControls() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: Me) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe({ signedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    setMe({ signedIn: false });
  }

  function signIn() {
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(
      `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  if (me === null) return null; // avoid a Sign in/Sign out flash before /api/auth/me resolves.

  if (!me.signedIn) {
    return (
      <button
        className="button"
        onClick={signIn}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <LogIn size={15} /> Sign in
      </button>
    );
  }

  return (
    <details className="account">
      <summary>
        <span className="avatar">
          <User size={14} />
        </span>
        <span>
          {me.displayName || me.email}
          <small>IntraForge account</small>
        </span>
      </summary>
      <button onClick={signOut}>
        <LogOut size={15} /> Sign out
      </button>
    </details>
  );
}
