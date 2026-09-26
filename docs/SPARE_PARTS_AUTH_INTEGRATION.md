# Sign in with IntraForge

This app never stores a password and never sees IntraForge's password
store. Authentication is delegated entirely to IntraForge via OAuth 2.1
Authorization Code + PKCE, with an OpenID Connect identity layer on top —
see the platform side's own
`docs/INTRAFORGE_OIDC_PROVIDER.md`/`docs/INTRAFORGE_EXTERNAL_APP_AUTH.md`
in the `intra-cloude` repo for the provider's architecture and security
model. This document covers the **client (relying party)** side, in this
codebase.

## Why this exists

Earlier in this project, `docs/INTRAFORGE_INTEGRATION.md` and
`src/integrations/intraforge/contract.ts` established that IntraForge had
no capability for a separately-hosted frontend's end users to
authenticate as themselves — only same-origin session cookies (not usable
here) and a _machine_ bearer-token identity (`applications.Application`,
the right shape for this app's _backend_ to read/write business data as
itself, the wrong shape for "let a real customer sign in"). That gap is
now closed on the IntraForge side; this integration is the client half.

## Flow

```
IntraForge Parts (this app)              IntraForge
  Sign in click
  → GET /auth/login?returnTo=<page>
      generates state/PKCE verifier/nonce,
      stores them in a short-lived HttpOnly
      cookie, redirects to:
                                    →  GET /oauth/authorize?...
                                         (shows IntraForge's own
                                          login/register/"skip
                                          organization" onboarding
                                          if not already signed in)
  ← GET /auth/callback?code&state  ←     redirects back with a code
      validates state
      POST /oauth/token (server-to-server,
        client_secret never reaches the browser)
                                    →  POST /oauth/token
                                    ←  {access_token, id_token, ...}
      verifies id_token (RS256, against
        IntraForge's published JWKS)
      maps `sub` → local SparePartsUser
        (creates one on first sign-in)
      creates this app's OWN session
      redirects to the original page
```

## Files

| File                              | Role                                                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth/config.ts`              | Reads `INTRAFORGE_*` env vars.                                                                                                                                                                                                                     |
| `src/auth/pkce.ts`                | `state`/`code_verifier`/`nonce` generation, S256 challenge.                                                                                                                                                                                        |
| `src/auth/oidc.ts`                | `buildAuthorizeUrl`, `exchangeCodeForTokens`, `revokeAccessToken` — all requests built via `new URL(path, issuer)` and re-checked against the configured origin (same SSRF-safe pattern as `src/integrations/catalogues/toyota-epc/transport.ts`). |
| `src/auth/jwks.ts`                | Fetches + caches IntraForge's JWKS, hand-rolled RS256 verification (Node's built-in `crypto`, no new dependency) — checks signature, `iss`, `aud`, `exp`, `nonce`.                                                                                 |
| `src/auth/txnCookie.ts`           | The short-lived `sp_oauth_txn` cookie carrying `state`/verifier/nonce/`returnTo` between `/auth/login` and `/auth/callback`; `isSafeReturnTo` guards against open redirects.                                                                       |
| `src/auth/store.ts`               | File-backed (`.auth-data/`) user + session store — same dev-only single-process pattern as `src/catalogue/server.ts`'s `repository()`. **Not** a password store.                                                                                   |
| `src/auth/currentUser.ts`         | `getCurrentUser()` — server-only, reads the session cookie.                                                                                                                                                                                        |
| `src/app/auth/login/route.ts`     | `GET /auth/login?returnTo=...`                                                                                                                                                                                                                     |
| `src/app/auth/callback/route.ts`  | `GET /auth/callback` — IntraForge's registered `redirect_uri`.                                                                                                                                                                                     |
| `src/app/auth/logout/route.ts`    | `POST /auth/logout`                                                                                                                                                                                                                                |
| `src/app/auth/error/page.tsx`     | Clean, specific failure messages — never a raw stack trace.                                                                                                                                                                                        |
| `src/app/api/auth/me/route.ts`    | `GET /api/auth/me` — the only way the browser learns sign-in state (session cookie is HttpOnly).                                                                                                                                                   |
| `src/components/AuthControls.tsx` | Sign in / Sign out UI, mounted in `Workspace.tsx`'s header — deliberately separate from the pre-existing `persona`/"Demo operator" selector (that simulates an internal staff role for the back-office demo; this is the real customer identity).  |

## User mapping

`SparePartsUser { id, intraforgeSubjectId, email, displayName, createdAt,
lastLoginAt }`, keyed by `intraforgeSubjectId` = the ID token's `sub`
claim — a durable UUID, **never** email (an email can change; `sub`
never does). First sign-in creates the record; every subsequent sign-in
updates `email`/`displayName`/`lastLoginAt` in place, same `id`.

## Org-less users

A customer who chose "Continue without an organization" during
IntraForge onboarding authenticates exactly the same way — their ID
token simply carries no organization claim (never did, for any user; see
the provider-side doc). Nothing here requires or checks for one. Business
authorization inside this app (what a signed-in customer may do: saved
vehicles, quotes, etc.) is this app's own concern, unrelated to whether
they have an IntraForge organization.

## Logout

`POST /auth/logout` ends only this app's own local session. It
deliberately does not also end the user's IntraForge identity session
(RP-initiated/global logout) — signing out of the spare-parts site has no
reason to imply signing out of IntraForge entirely, and doing so would
need a redirect through IntraForge's own (not-yet-built) logout-redirect
endpoint. `INTRAFORGE_POST_LOGOUT_REDIRECT_URI` is configured and
registered on the IntraForge side already, ready for that when it's
worth adding.

## Environment variables

See `.env.example`. `INTRAFORGE_CLIENT_SECRET` has no default —
required. The development client (`ifc_harmoney_spareparts_dev`) is
seeded by a migration on the IntraForge side; its secret is printed once
there.

### Local TLS trust

IntraForge's dev proxy presents a certificate from its own local CA
(Caddy `tls internal`). Node's `fetch` (used for the token exchange and
JWKS fetch) will refuse it unless trusted — export the CA once and run
the dev server with it:

```
docker cp <intraforge-proxy-container>://data/caddy/pki/authorities/local/root.crt .dev-certs/intraforge-local-ca.crt
NODE_EXTRA_CA_CERTS=$(pwd)/.dev-certs/intraforge-local-ca.crt npm run dev
```

(`.dev-certs/` is gitignored — this is a local, machine-specific trust
anchor, not a secret to commit.)

### Host consistency matters

This app's dev script binds `127.0.0.1` specifically
(`next dev --hostname 127.0.0.1`). Browsers treat `localhost` and
`127.0.0.1` as different origins for cookies — `INTRAFORGE_REDIRECT_URI`
must use whichever host you actually browse to, consistently, or the
`sp_oauth_txn` cookie set by `/auth/login` won't be sent back to
`/auth/callback` (surfaces as `/auth/error?reason=missing_transaction`).
The IntraForge-side dev client registers both hosts' callback URLs so
either works, as long as this app's own env var matches what's in the
browser's address bar.

## Testing

No dedicated unit tests were added in this app for the OIDC client code
itself (the verification logic it exercises — PKCE, code single-use,
`redirect_uri`/client binding, signature/`iss`/`aud`/`exp`/`nonce`
checking — is exhaustively covered server-side by IntraForge's own
`oauth_provider` test suite, which is the actual source of truth for
"is this protocol implemented correctly"; duplicating that against a
live IntraForge instance from this repo would mostly re-test the same
thing through an extra network hop). What was verified here:

- `npx tsc --noEmit` — clean.
- Manual, live, cross-application browser verification (real Chrome,
  both apps' real dev servers, real IntraForge Docker stack) — see the
  session's final report for the exact sequence and results: sign-in as
  an existing org-less user, `/api/auth/me` reflecting the true session
  state, sign-out clearing it, `.auth-data/auth-v1.json` showing the
  correct `sub`-keyed user record.

Not yet added: a Playwright e2e spec in this repo driving the full
cross-app flow (would need both dev servers _and_ the IntraForge Docker
stack running together in CI) — a reasonable follow-up, not attempted in
this pass given that constraint.

## Known limitations / deferred

- **Global (RP-initiated) logout** — not implemented; see Logout above.
- **No saved-vehicles/parts/quotes wiring to this identity yet** — this
  pass delivers real, working Sign In/Sign Up/Sign Out and the
  `SparePartsUser` mapping; connecting existing account-scoped features
  to `getCurrentUser()` is the natural next slice, not attempted here to
  keep this change reviewable.
- **No dedicated e2e spec in this repo** — see Testing above.
