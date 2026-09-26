import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../../src/server/db/connection";
import { migrate } from "../../src/server/db/migrate";
import { migrations } from "../../src/server/db/migrations";

test("migrations apply once, are idempotent, and record checksums", async () => {
  const db = Database.open(":memory:");
  const first = await migrate(db);
  assert.equal(first.applied.length, migrations.length);
  const second = await migrate(db);
  assert.deepEqual(second.applied, []);
  assert.equal(second.alreadyApplied.length, migrations.length);
  const rows = await db.read((h) =>
    h.all("SELECT version, checksum FROM schema_migrations"),
  );
  assert.equal(rows.length, migrations.length);
  await db.close();
});

test("a migration edited after it was applied is refused", async () => {
  const db = Database.open(":memory:");
  await migrate(db);
  await db.write((h) =>
    h.run(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001'",
    ),
  );
  await assert.rejects(migrate(db), /modified after it was applied/);
  await db.close();
});

test("a failed write operation rolls back completely", async () => {
  const db = Database.open(":memory:");
  await migrate(db);
  await assert.rejects(
    db.write(async (h) => {
      await h.run(
        "INSERT INTO app_config(key,value,updated_at) VALUES ('a','1','t')",
      );
      await h.run(
        "INSERT INTO app_config(key,value,updated_at) VALUES ('a','dup','t')",
      );
    }),
  );
  assert.equal(
    await db.read((h) => h.count("SELECT COUNT(*) AS n FROM app_config")),
    0,
  );
  await db.close();
});

test("concurrent writers are serialized even with async gaps inside the transaction", async () => {
  const db = Database.open(":memory:");
  await migrate(db);
  await db.write((h) =>
    h.run("INSERT INTO sequences(name,next_value) VALUES ('x',0)"),
  );
  const bump = () =>
    db.write(async (h) => {
      const v = (await h.get<{ next_value: number }>(
        "SELECT next_value FROM sequences WHERE name='x'",
      ))!.next_value;
      await new Promise((r) => setTimeout(r, 5));
      await h.run("UPDATE sequences SET next_value = ? WHERE name='x'", [
        v + 1,
      ]);
    });
  await Promise.all(Array.from({ length: 25 }, bump));
  assert.equal(
    await db.read(
      async (h) =>
        (await h.get<{ next_value: number }>(
          "SELECT next_value FROM sequences",
        ))!.next_value,
    ),
    25,
  );
  await db.close();
});

test("audit events are immutable", async () => {
  const db = Database.open(":memory:");
  await migrate(db);
  await db.write((h) =>
    h.run(
      "INSERT INTO audit_events(id,at,actor_label,action,entity_type,summary) VALUES ('1','t','x','a','e','s')",
    ),
  );
  await assert.rejects(
    db.write((h) => h.run("UPDATE audit_events SET summary='changed'")),
    /immutable/,
  );
  await assert.rejects(
    db.write((h) => h.run("DELETE FROM audit_events")),
    /immutable/,
  );
  await db.close();
});

test("nested operations join the outer transaction; a write inside a read is refused", async () => {
  const db = Database.open(":memory:");
  await migrate(db);
  await db.write(async () => {
    await db.write((h) =>
      h.run(
        "INSERT INTO app_config(key,value,updated_at) VALUES ('n','1','t')",
      ),
    );
  });
  assert.equal(
    await db.read((h) => h.count("SELECT COUNT(*) AS n FROM app_config")),
    1,
  );
  await assert.rejects(
    db.read(() => db.write(() => 1)),
    /read-only/,
  );
  await db.close();
});
