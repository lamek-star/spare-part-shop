import test from "node:test";
import assert from "node:assert/strict";
import { makeApp } from "./helpers";
import { AppError } from "../../src/server/kernel/errors";
import {
  hashPassword,
  verifyPassword,
} from "../../src/server/standalone/identity";
import {
  can,
  permissions,
  rolePermissions,
} from "../../src/server/domain/permissions";
import { roles } from "../../src/server/domain/types";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError
      ? e.code
      : `UNEXPECTED:${(e as Error).message}`;
  }
};

test("passwords are hashed with scrypt, salted, and verified in constant time", () => {
  const a = hashPassword("a-long-passphrase");
  const b = hashPassword("a-long-passphrase");
  assert.notEqual(a, b, "salt must differ");
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword("a-long-passphrase", a), true);
  assert.equal(verifyPassword("wrong", a), false);
  assert.equal(verifyPassword("a-long-passphrase", "garbage"), false);
});

test("sign in creates a server-side session; the token is never stored", async () => {
  const t = await makeApp();
  try {
    const { token, session } = await t.container.identity.signIn({
      email: "OWNER@example.test",
      password: "correct-horse-battery",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(session.actor.role, "OWNER");
    const stored = await t.container.db.read((h) =>
      h.all<{ id: string }>("SELECT id FROM sessions"),
    );
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].id, token, "only a hash of the token is stored");
    const again = await t.container.identity.authenticate(token);
    assert.equal(again?.actor.email, "owner@example.test");
    assert.equal(
      await t.container.identity.authenticate("nope-nope-nope-nope-nope"),
      null,
    );
    await t.container.identity.signOut(token);
    assert.equal(await t.container.identity.authenticate(token), null);
  } finally {
    await t.cleanup();
  }
});

test("bad credentials give one generic answer and lock the account after repeated failures", async () => {
  const t = await makeApp();
  try {
    const attempt = (email: string, password: string) =>
      code(
        t.container.identity.signIn({
          email,
          password,
          ip: null,
          userAgent: null,
        }),
      );
    assert.equal(
      await attempt("nobody@example.test", "whatever-long-1"),
      "BAD_CREDENTIALS",
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        await attempt("sales@example.test", "wrong-password-1"),
        "BAD_CREDENTIALS",
      );
    assert.equal(
      await attempt("sales@example.test", "correct-horse-battery"),
      "RATE_LIMITED",
    );
  } finally {
    await t.cleanup();
  }
});

test("a disabled user cannot sign in, and disabling ends their sessions", async () => {
  const t = await makeApp();
  try {
    const { token } = await t.container.identity.signIn({
      email: "sales@example.test",
      password: "correct-horse-battery",
      ip: null,
      userAgent: null,
    });
    await t.container.identity.updateUser(t.actors.OWNER, t.actors.SALES.id, {
      status: "DISABLED",
    });
    assert.equal(await t.container.identity.authenticate(token), null);
    assert.equal(
      await code(
        t.container.identity.signIn({
          email: "sales@example.test",
          password: "correct-horse-battery",
          ip: null,
          userAgent: null,
        }),
      ),
      "BAD_CREDENTIALS",
    );
  } finally {
    await t.cleanup();
  }
});

test("only the very first account may be created without signing in, and it must be the Owner", async () => {
  const t = await makeApp();
  try {
    assert.equal(
      await code(
        t.container.identity.createUser(null, {
          email: "x@example.test",
          displayName: "X",
          role: "OWNER",
          password: "correct-horse-battery",
        }),
      ),
      "FORBIDDEN",
    );
  } finally {
    await t.cleanup();
  }
});

test("password policy and the last-Owner safeguard", async () => {
  const t = await makeApp();
  try {
    assert.equal(
      await code(
        t.container.identity.createUser(t.actors.OWNER, {
          email: "n@example.test",
          displayName: "N",
          role: "SALES",
          password: "short",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.container.identity.createUser(t.actors.OWNER, {
          email: "n@example.test",
          displayName: "N",
          role: "SALES",
          password: "1234567890",
        }),
      ),
      "VALIDATION",
    );
    assert.equal(
      await code(
        t.container.identity.createUser(t.actors.OWNER, {
          email: "owner@example.test",
          displayName: "Dup",
          role: "SALES",
          password: "correct-horse-battery",
        }),
      ),
      "CONFLICT",
    );
    assert.equal(
      await code(
        t.container.identity.updateUser(t.actors.OWNER, t.actors.OWNER.id, {
          role: "ADMIN",
        }),
      ),
      "CONFLICT",
    );
    assert.equal(
      await code(
        t.container.identity.updateUser(t.actors.OWNER, t.actors.OWNER.id, {
          status: "DISABLED",
        }),
      ),
      "CONFLICT",
    );
  } finally {
    await t.cleanup();
  }
});

test("changing a password requires the current one and ends all sessions", async () => {
  const t = await makeApp();
  try {
    const { token } = await t.container.identity.signIn({
      email: "admin@example.test",
      password: "correct-horse-battery",
      ip: null,
      userAgent: null,
    });
    assert.equal(
      await code(
        t.container.identity.changePassword(
          t.actors.ADMIN.id,
          "wrong-current-1",
          "another-long-pass",
        ),
      ),
      "BAD_CREDENTIALS",
    );
    await t.container.identity.changePassword(
      t.actors.ADMIN.id,
      "correct-horse-battery",
      "another-long-pass",
    );
    assert.equal(await t.container.identity.authenticate(token), null);
    const again = await t.container.identity.signIn({
      email: "admin@example.test",
      password: "another-long-pass",
      ip: null,
      userAgent: null,
    });
    assert.equal(again.session.actor.role, "ADMIN");
  } finally {
    await t.cleanup();
  }
});

test("audit never records credentials", async () => {
  const t = await makeApp();
  try {
    await t.container.identity.updateUser(t.actors.OWNER, t.actors.SALES.id, {
      password: "brand-new-passphrase",
    });
    const events = await t.container.repos.audit.query({});
    const dump = JSON.stringify(events);
    assert.doesNotMatch(dump, /brand-new-passphrase/);
    assert.doesNotMatch(dump, /correct-horse-battery/);
  } finally {
    await t.cleanup();
  }
});

test("the permission matrix follows the documented roles", () => {
  assert.equal(permissions.length, new Set(permissions).size);
  for (const p of permissions)
    assert.equal(can({ role: "OWNER" }, p), true, `owner ${p}`);
  assert.equal(can({ role: "ADMIN" }, "users.manage"), false);
  assert.equal(can({ role: "ADMIN" }, "catalogue.import"), true);
  assert.equal(
    can({ role: "SALES" }, "products.cost.read"),
    false,
    "sales must not see cost",
  );
  assert.equal(can({ role: "SALES" }, "quotations.write"), true);
  assert.equal(can({ role: "SALES" }, "inventory.write"), false);
  assert.equal(can({ role: "INVENTORY" }, "inventory.write"), true);
  assert.equal(can({ role: "INVENTORY" }, "invoices.write"), false);
  assert.equal(can({ role: "INVENTORY" }, "payments.record"), false);
  for (const p of rolePermissions.VIEWER)
    assert.match(p, /\.read$/, `viewer has only read permissions (${p})`);
  assert.deepEqual([...roles].sort(), Object.keys(rolePermissions).sort());
});
