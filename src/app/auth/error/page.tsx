"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  state_mismatch:
    "Your sign-in request could not be verified. Please try signing in again.",
  missing_transaction:
    "Your sign-in session expired before it could complete. Please try again.",
  missing_code: "IntraForge did not return a sign-in code. Please try again.",
  invalid_client:
    "This site is not currently able to sign in through IntraForge. Please try again shortly.",
  invalid_grant:
    "Your sign-in code was invalid or had expired. Please try again.",
  invalid_scope:
    "This site requested access IntraForge did not grant. Please try again.",
  access_denied: "Sign-in was cancelled.",
  token_exchange_failed:
    "IntraForge could not be reached to complete sign-in. Please try again shortly.",
  no_id_token_returned:
    "IntraForge did not confirm your identity. Please try again.",
  invalid_id_token: "Your sign-in could not be verified. Please try again.",
  unexpected_error:
    "Something went wrong while signing you in. Please try again.",
};

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorPageInner />
    </Suspense>
  );
}

function AuthErrorPageInner() {
  const reason = useSearchParams().get("reason") ?? "unexpected_error";
  const message = MESSAGES[reason] ?? MESSAGES.unexpected_error;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
        Sign-in didn&apos;t complete
      </h1>
      <p style={{ color: "#475569", maxWidth: "28rem" }}>{message}</p>
      <a
        href="/"
        style={{
          marginTop: "0.5rem",
          color: "#0f766e",
          textDecoration: "underline",
          fontSize: "0.875rem",
        }}
      >
        Back to IntraForge Parts
      </a>
    </div>
  );
}
