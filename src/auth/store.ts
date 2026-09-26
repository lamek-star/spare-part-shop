import {
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomToken } from "./pkce";
/**
 * Local, file-backed identity link + session store — the same
 * development-only single-process pattern as src/catalogue/server.ts's
 * `repository()` (atomic tmp+rename write, mtime-cached in-memory
 * singleton). This is deliberately NOT a password store: `SparePartsUser`
 * holds only the mapping this app needs (`intraforge_subject_id` = the
 * stable `sub` claim, plus a cached email/display name for UI use)
 * — see docs/SPARE_PARTS_AUTH_INTEGRATION.md "User mapping".
 */
export interface SparePartsUser {
  id: string;
  intraforgeSubjectId: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastLoginAt: string;
}
export interface AuthSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}
interface AuthState {
  users: Record<string, SparePartsUser>; // keyed by intraforgeSubjectId
  sessions: Record<string, AuthSession>; // keyed by session id
}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const globals = globalThis as typeof globalThis & {
  __authState?: AuthState;
  __authStamp?: number;
};
function dir() {
  return join(
    process.cwd(),
    process.env.CATALOGUE_TEST_MODE === "1" ? ".auth-test-data" : ".auth-data",
  );
}
function file() {
  return join(dir(), "auth-v1.json");
}
function load(): AuthState {
  const f = file();
  const stamp = existsSync(f) ? statSync(f).mtimeMs : 0;
  if (!globals.__authState || globals.__authStamp !== stamp) {
    globals.__authState = existsSync(f)
      ? (JSON.parse(readFileSync(f, "utf8")) as AuthState)
      : { users: {}, sessions: {} };
    globals.__authStamp = stamp;
  }
  return globals.__authState;
}
function persist(state: AuthState) {
  const d = dir();
  mkdirSync(d, { recursive: true });
  const f = file();
  const temporary = f + ".tmp";
  writeFileSync(temporary, JSON.stringify(state));
  renameSync(temporary, f);
  globals.__authState = state;
  globals.__authStamp = statSync(f).mtimeMs;
}
export function upsertUserFromIdentity(identity: {
  sub: string;
  email?: string;
  name?: string;
}): SparePartsUser {
  const state = load();
  const now = new Date().toISOString();
  const existing = state.users[identity.sub];
  const user: SparePartsUser = existing
    ? {
        ...existing,
        email: identity.email ?? existing.email,
        displayName: identity.name ?? existing.displayName,
        lastLoginAt: now,
      }
    : {
        id: randomToken(12),
        intraforgeSubjectId: identity.sub,
        email: identity.email ?? "",
        displayName: identity.name ?? identity.email ?? "IntraForge user",
        createdAt: now,
        lastLoginAt: now,
      };
  state.users[identity.sub] = user;
  persist(state);
  return user;
}
export function createSession(userId: string): AuthSession {
  const state = load();
  const now = Date.now();
  const session: AuthSession = {
    id: randomToken(24),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  state.sessions[session.id] = session;
  persist(state);
  return session;
}
export function getSessionUser(
  sessionId: string | undefined,
): SparePartsUser | undefined {
  if (!sessionId) return undefined;
  const state = load();
  const session = state.sessions[sessionId];
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    delete state.sessions[sessionId];
    persist(state);
    return undefined;
  }
  return Object.values(state.users).find((u) => u.id === session.userId);
}
export function deleteSession(sessionId: string | undefined) {
  if (!sessionId) return;
  const state = load();
  if (state.sessions[sessionId]) {
    delete state.sessions[sessionId];
    persist(state);
  }
}
