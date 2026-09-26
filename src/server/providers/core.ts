import type { Actor, AuditEvent, Role } from "../domain/types";

/**
 * Provider interfaces. These are the seams where a later phase swaps in
 * IntraForge (identity, file storage, audit, configuration, data). Business
 * logic depends on these types only; the standalone implementations live
 * in server/standalone. See docs/INTRAFORGE_INTEGRATION_CONTRACT.md.
 */

// ---------- identity ----------
export interface AuthenticatedSession {
  actor: Actor;
  sessionId: string;
  csrfToken: string;
  mustChangePassword: boolean;
}
export interface UserRecord extends Actor {
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface NewUser {
  email: string;
  displayName: string;
  role: Role;
  password: string;
  mustChangePassword?: boolean;
}
export interface IdentityProvider {
  /** Verifies credentials and opens a session; returns the opaque token
   * the transport layer stores in a cookie. Throws AppError on failure. */
  signIn(input: {
    email: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; session: AuthenticatedSession }>;
  /** Resolves a token to a session, or null when missing/expired. */
  authenticate(
    token: string | null | undefined,
  ): Promise<AuthenticatedSession | null>;
  signOut(token: string): Promise<void>;
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  hasAnyUser(): Promise<boolean>;
  createUser(actor: Actor | null, user: NewUser): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  updateUser(
    actor: Actor,
    id: string,
    patch: {
      displayName?: string;
      role?: Role;
      status?: "ACTIVE" | "DISABLED";
      password?: string;
    },
  ): Promise<UserRecord>;
}

// ---------- audit ----------
export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}
export interface AuditProvider {
  /** Records inside the caller's transaction, so an operation and its
   * audit trail commit or roll back together. Never store secrets. */
  record(
    actor: Pick<Actor, "id" | "displayName"> | null,
    event: AuditInput,
  ): Promise<void>;
  query(filter: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit?: number;
    before?: string;
  }): Promise<AuditEvent[]>;
}

// ---------- files ----------
export interface StoredFile {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}
export interface FileStorage {
  /** Stores bytes and their metadata. The caller has already validated
   * type/size; storage additionally guarantees a safe, generated key. */
  put(input: {
    bytes: Uint8Array;
    originalName: string;
    mime: string;
    kind: string;
    entityType?: string;
    entityId?: string;
    createdBy?: string | null;
  }): Promise<StoredFile>;
  get(id: string): Promise<{ file: StoredFile; bytes: Uint8Array } | null>;
  meta(id: string): Promise<StoredFile | null>;
  /** Files attached to one business entity, newest first. */
  listFor(
    entityType: string,
    entityId: string,
    kind?: string,
  ): Promise<StoredFile[]>;
  delete(id: string): Promise<void>;
  /** Files nothing refers to any more (e.g. after a product image delete). */
  listOrphans(): Promise<StoredFile[]>;
}

// ---------- configuration ----------
export interface ShopConfig {
  shopName: string;
  address: string;
  phone: string;
  email: string;
  taxRegistration: string;
  currency: string;
  defaultTaxBp: number;
  quotationValidityDays: number;
  invoiceDueDays: number;
  quotationTerms: string;
  invoiceNotes: string;
}
export interface ConfigurationProvider {
  get(): Promise<ShopConfig>;
  update(actor: Actor, patch: Partial<ShopConfig>): Promise<ShopConfig>;
  /** Next human-readable document number, e.g. QUO-2026-000001. Atomic. */
  nextNumber(sequence: string, prefix: string): Promise<string>;
  /** Next permanent code without a year, e.g. CUS-000001. Atomic. */
  nextCode(sequence: string, prefix: string): Promise<string>;
}
