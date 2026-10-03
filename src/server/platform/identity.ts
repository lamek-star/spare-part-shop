import { AppError } from "../kernel/errors";
import type { Actor } from "../domain/types";
import type {
  AuthenticatedSession,
  IdentityProvider,
  NewUser,
  UserRecord,
} from "../providers/core";
import type { IntraForgeClient } from "./intraforge";
import {
  permissionsFromCapabilities,
  roleFromCapabilities,
} from "./capabilities";

/**
 * IdentityProvider over IntraForge (the contract's "SSO variant").
 * IntraForge owns users, passwords, roles and sessions; this provider only
 * resolves the application session IntraForge set when the user pressed
 * Open, on every request, through IntraForge's introspection endpoint. A
 * short cache keeps that cheap; it is short enough that logging out of
 * IntraForge, losing a capability or being disabled takes effect within
 * seconds. Nothing the browser sends besides the token is trusted.
 */
const CACHE_MS = 5000;
const CACHE_MAX = 1000;

interface Introspection {
  active: boolean;
  user: { id: string; email: string; displayName: string };
  capabilities: string[];
  csrfToken: string;
  expiresAt: string;
  sessionId: string;
}

const managedElsewhere = () =>
  new AppError(
    "MANAGED_BY_INTRAFORGE",
    "People, passwords and roles are managed in IntraForge (Organization > Members and Roles).",
    409,
  );

export class PlatformIdentityProvider implements IdentityProvider {
  private cache = new Map<
    string,
    { at: number; session: AuthenticatedSession | null }
  >();
  constructor(private readonly client: IntraForgeClient) {}

  async authenticate(
    token: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const hit = this.cache.get(token);
    const now = Date.now();
    if (hit && now - hit.at < CACHE_MS) return hit.session;
    const { status, data } = await this.client.json<Introspection>(
      "POST",
      "/sessions/introspect/",
      { token },
      [200, 401],
    );
    const session =
      status === 200 && data.active
        ? {
            actor: toActor(data),
            sessionId: data.sessionId,
            csrfToken: data.csrfToken,
            mustChangePassword: false,
          }
        : null;
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(token, { at: now, session });
    return session;
  }

  /** "Sign out" here ends the IntraForge sign-in this session came from too, so
   * on a shared counter PC the next person must sign in as themselves. */
  async signOut(token: string): Promise<void> {
    this.cache.delete(token);
    await this.client.json("POST", "/sessions/revoke/", {
      token,
      sign_out: true,
    });
  }

  async hasAnyUser(): Promise<boolean> {
    return true; // IntraForge has its own first-run; this app never shows one
  }

  async listUsers(): Promise<UserRecord[]> {
    const { data } = await this.client.json<{
      results: {
        id: string;
        email: string;
        displayName: string;
        active: boolean;
        capabilities: string[];
      }[];
    }>("GET", "/users/");
    return data.results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: roleFromCapabilities(u.capabilities),
      status: u.active ? "ACTIVE" : "DISABLED",
      mustChangePassword: false,
      createdAt: "",
      lastLoginAt: null,
    }));
  }

  async signIn(): Promise<{ token: string; session: AuthenticatedSession }> {
    throw new AppError(
      "USE_INTRAFORGE",
      "Sign in to IntraForge and open Spare Parts from Apps.",
      403,
    );
  }
  async changePassword(): Promise<void> {
    throw managedElsewhere();
  }
  async createUser(_actor: Actor | null, _user: NewUser): Promise<UserRecord> {
    throw managedElsewhere();
  }
  async updateUser(): Promise<UserRecord> {
    throw managedElsewhere();
  }
}

function toActor(data: Introspection): Actor {
  return {
    id: data.user.id,
    email: data.user.email,
    displayName: data.user.displayName,
    role: roleFromCapabilities(data.capabilities),
    permissions: permissionsFromCapabilities(data.capabilities),
  };
}
