import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { SqlDatabase } from "../db/connection";
import type { Actor, Role } from "../domain/types";
import { roles } from "../domain/types";
import type {
  AuditProvider,
  AuthenticatedSession,
  IdentityProvider,
  NewUser,
  UserRecord,
} from "../providers/core";
import { AppError, conflict, notFound, validation } from "../kernel/errors";
import { newId, nowIso } from "../kernel/ids";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_HOURS = 12;
const SESSION_MAX_DAYS = 7;
const LOCK_AFTER_FAILURES = 5;
const LOCK_WINDOW_MINUTES = 15;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const DUMMY_HASH = hashPassword("not-a-real-password-for-timing");
const COMMON = new Set([
  "password123",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "admin12345",
]);
export function checkPasswordPolicy(password: string, email: string): void {
  if (password.length < 10)
    throw validation("Use a password of at least 10 characters.");
  if (password.length > 200) throw validation("Password is too long.");
  if (/^\d+$/.test(password) || COMMON.has(password.toLowerCase()))
    throw validation("That password is too easy to guess.");
  if (
    password.toLowerCase().includes(email.split("@")[0].toLowerCase()) &&
    email.split("@")[0].length > 3
  )
    throw validation("Password must not contain your email name.");
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const cleanEmail = (email: string) => email.trim().toLowerCase();

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  password_hash: string;
  status: "ACTIVE" | "DISABLED";
  must_change_password: number;
  created_at: string;
  last_login_at: string | null;
}
const toRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  status: r.status,
  mustChangePassword: Boolean(r.must_change_password),
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

/**
 * Temporary standalone identity: local users, scrypt password hashes,
 * server-side sessions. It exists only so this phase has a real
 * authentication boundary; a later phase replaces it with IntraForge
 * identity behind the same IdentityProvider interface.
 */
export class LocalIdentityProvider implements IdentityProvider {
  constructor(
    private readonly db: SqlDatabase,
    private readonly audit: AuditProvider,
  ) {}

  async hasAnyUser(): Promise<boolean> {
    return (
      (await this.db.read((h) => h.count("SELECT COUNT(*) AS n FROM users"))) >
      0
    );
  }

  async createUser(actor: Actor | null, user: NewUser): Promise<UserRecord> {
    const email = cleanEmail(user.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw validation("Enter a valid email address.");
    if (!user.displayName.trim()) throw validation("Enter the person's name.");
    if (!(roles as readonly string[]).includes(user.role))
      throw validation("Unknown role.");
    checkPasswordPolicy(user.password, email);
    return this.db.write(async (h) => {
      const first = (await h.count("SELECT COUNT(*) AS n FROM users")) === 0;
      if (!actor && !first)
        throw new AppError(
          "FORBIDDEN",
          "Only the first account may be created without signing in.",
          403,
        );
      if (!actor && user.role !== "OWNER")
        throw validation("The first account must be the Owner.");
      if (await h.get("SELECT 1 AS x FROM users WHERE email = ?", [email]))
        throw conflict("A user with that email already exists.");
      const id = newId();
      const now = nowIso();
      await h.run(
        `INSERT INTO users(id,email,display_name,role,password_hash,status,must_change_password,created_at,updated_at)
         VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`,
        [
          id,
          email,
          user.displayName.trim(),
          user.role,
          hashPassword(user.password),
          user.mustChangePassword ? 1 : 0,
          now,
          now,
        ],
      );
      await this.audit.record(
        actor ?? { id, displayName: user.displayName.trim() },
        {
          action: "user.create",
          entityType: "user",
          entityId: id,
          summary: `User ${email} created with role ${user.role}`,
          metadata: { role: user.role },
        },
      );
      return toRecord(
        (await h.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!,
      );
    });
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.db.read(async (h) =>
      (
        await h.all<UserRow>(
          "SELECT * FROM users ORDER BY display_name COLLATE NOCASE",
        )
      ).map(toRecord),
    );
  }

  async updateUser(
    actor: Actor,
    id: string,
    patch: {
      displayName?: string;
      role?: Role;
      status?: "ACTIVE" | "DISABLED";
      password?: string;
    },
  ): Promise<UserRecord> {
    return this.db.write(async (h) => {
      const row = await h.get<UserRow>("SELECT * FROM users WHERE id = ?", [
        id,
      ]);
      if (!row) throw notFound("User");
      const role = patch.role ?? row.role;
      const status = patch.status ?? row.status;
      if (patch.role && !(roles as readonly string[]).includes(patch.role))
        throw validation("Unknown role.");
      if (patch.status && !["ACTIVE", "DISABLED"].includes(patch.status))
        throw validation("Unknown status.");
      const losesOwner =
        row.role === "OWNER" &&
        row.status === "ACTIVE" &&
        (role !== "OWNER" || status !== "ACTIVE");
      if (
        losesOwner &&
        (await h.count(
          "SELECT COUNT(*) AS n FROM users WHERE role='OWNER' AND status='ACTIVE'",
        )) <= 1
      )
        throw conflict("There must always be at least one active Owner.");
      let hash = row.password_hash;
      if (patch.password !== undefined) {
        checkPasswordPolicy(patch.password, row.email);
        hash = hashPassword(patch.password);
      }
      await h.run(
        `UPDATE users SET display_name=?, role=?, status=?, password_hash=?, must_change_password=?, updated_at=? WHERE id=?`,
        [
          patch.displayName?.trim() || row.display_name,
          role,
          status,
          hash,
          patch.password !== undefined ? 1 : row.must_change_password,
          nowIso(),
          id,
        ],
      );
      if (
        status === "DISABLED" ||
        patch.password !== undefined ||
        role !== row.role
      )
        await h.run("DELETE FROM sessions WHERE user_id = ?", [id]);
      await this.audit.record(actor, {
        action: "user.update",
        entityType: "user",
        entityId: id,
        summary: `User ${row.email} updated`,
        metadata: {
          role: patch.role,
          status: patch.status,
          passwordReset: patch.password !== undefined,
        },
      });
      return toRecord(
        (await h.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!,
      );
    });
  }

  async signIn(input: {
    email: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; session: AuthenticatedSession }> {
    const email = cleanEmail(input.email);
    const now = new Date();
    // The attempt is recorded even when sign-in fails, so the outcome is
    // decided inside the transaction but the error is thrown after it
    // commits (a throw inside would roll the failure record back and the
    // lockout would never trigger).
    const outcome = await this.db.write(
      async (
        h,
      ): Promise<
        { error: AppError } | { token: string; session: AuthenticatedSession }
      > => {
        const since = new Date(
          now.getTime() - LOCK_WINDOW_MINUTES * 60_000,
        ).toISOString();
        const failures = await h.count(
          "SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND success = 0 AND at > ?",
          [email, since],
        );
        if (failures >= LOCK_AFTER_FAILURES)
          return {
            error: new AppError(
              "RATE_LIMITED",
              `Too many failed sign-in attempts. Try again in ${LOCK_WINDOW_MINUTES} minutes.`,
              429,
            ),
          };
        const user = await h.get<UserRow>(
          "SELECT * FROM users WHERE email = ?",
          [email],
        );
        const ok =
          verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH) &&
          user?.status === "ACTIVE";
        await h.run(
          "INSERT INTO login_attempts(identifier, ip, at, success) VALUES (?,?,?,?)",
          [email, input.ip, now.toISOString(), ok ? 1 : 0],
        );
        // Same message for unknown user, wrong password and disabled account.
        if (!ok || !user)
          return {
            error: new AppError(
              "BAD_CREDENTIALS",
              "Email or password is incorrect.",
              401,
            ),
          };
        await h.run(
          "DELETE FROM login_attempts WHERE identifier = ? AND success = 0",
          [email],
        );
        await h.run("DELETE FROM sessions WHERE expires_at < ?", [
          now.toISOString(),
        ]);
        const token = randomBytes(32).toString("base64url");
        const csrf = randomBytes(24).toString("base64url");
        await h.run(
          `INSERT INTO sessions(id,user_id,csrf_token,created_at,expires_at,last_seen_at,ip,user_agent)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            tokenHash(token),
            user.id,
            csrf,
            now.toISOString(),
            new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString(),
            now.toISOString(),
            input.ip,
            (input.userAgent ?? "").slice(0, 200),
          ],
        );
        await h.run("UPDATE users SET last_login_at = ? WHERE id = ?", [
          now.toISOString(),
          user.id,
        ]);
        return {
          token,
          session: {
            actor: {
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              role: user.role,
            },
            sessionId: tokenHash(token),
            csrfToken: csrf,
            mustChangePassword: Boolean(user.must_change_password),
          },
        };
      },
    );
    if ("error" in outcome) throw outcome.error;
    return outcome;
  }

  async authenticate(
    token: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const id = tokenHash(token);
    return this.db.write(async (h) => {
      const row = await h.get<
        UserRow & {
          csrf_token: string;
          expires_at: string;
          s_created: string;
          last_seen_at: string;
        }
      >(
        `SELECT u.*, s.csrf_token, s.expires_at, s.created_at AS s_created, s.last_seen_at
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
        [id],
      );
      const now = new Date();
      if (!row || row.status !== "ACTIVE" || new Date(row.expires_at) <= now) {
        if (row) await h.run("DELETE FROM sessions WHERE id = ?", [id]);
        return null;
      }
      if (now.getTime() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        const cap =
          new Date(row.s_created).getTime() + SESSION_MAX_DAYS * 86_400_000;
        const next = Math.min(cap, now.getTime() + SESSION_HOURS * 3_600_000);
        await h.run(
          "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
          [now.toISOString(), new Date(next).toISOString(), id],
        );
      }
      return {
        actor: {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
        },
        sessionId: id,
        csrfToken: row.csrf_token,
        mustChangePassword: Boolean(row.must_change_password),
      };
    });
  }

  async signOut(token: string): Promise<void> {
    await this.db.write((h) =>
      h.run("DELETE FROM sessions WHERE id = ?", [tokenHash(token)]),
    );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.db.write(async (h) => {
      const row = await h.get<UserRow>("SELECT * FROM users WHERE id = ?", [
        userId,
      ]);
      if (!row || !verifyPassword(currentPassword, row.password_hash))
        throw new AppError(
          "BAD_CREDENTIALS",
          "Current password is incorrect.",
          401,
        );
      checkPasswordPolicy(newPassword, row.email);
      if (newPassword === currentPassword)
        throw validation("Choose a different password.");
      await h.run(
        "UPDATE users SET password_hash=?, must_change_password=0, updated_at=? WHERE id=?",
        [hashPassword(newPassword), nowIso(), userId],
      );
      await h.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
      await this.audit.record(
        { id: row.id, displayName: row.display_name },
        {
          action: "user.password_change",
          entityType: "user",
          entityId: row.id,
          summary: `${row.email} changed their password`,
        },
      );
    });
  }
}
