import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/server/domain/app";
import { IntraForgeClient } from "../../src/server/platform/intraforge";
import { PlatformAccessRequests } from "../../src/server/platform/accessRequests";
import type { AccessRequestsGateway } from "../../src/server/providers/core";
import { makeApp } from "./helpers";

test("standalone: there are no IntraForge requests", async () => {
  const t = await makeApp();
  try {
    assert.equal(t.app.accessRequests.available, false);
    assert.deepEqual(await t.app.accessRequests.list(t.actors.OWNER), { results: [], roles: [] });
  } finally {
    await t.cleanup();
  }
});

test("only people who manage users ask IntraForge, always for themselves", async () => {
  const t = await makeApp();
  const calls: unknown[] = [];
  const fake: AccessRequestsGateway = {
    async list(actorId) {
      calls.push({ list: actorId });
      return { results: [], roles: [] };
    },
    async decide(input) {
      calls.push(input);
      return { link: "https://localhost/confirm#t=x", emailed: false };
    },
  };
  try {
    const app = createApp({ ...t.container, accessRequests: fake });
    assert.equal(app.accessRequests.available, true);
    await assert.rejects(() => app.accessRequests.list(t.actors.SALES), /may not perform/);
    await app.accessRequests.list(t.actors.OWNER);
    const d = await app.accessRequests.decide(t.actors.OWNER, {
      requestId: "r1",
      decision: "approve",
      roleSlug: "spare-parts-sales",
      origin: "https://localhost",
    });
    assert.equal(d.link, "https://localhost/confirm#t=x");
    assert.deepEqual(calls, [
      { list: t.actors.OWNER.id },
      {
        actorId: t.actors.OWNER.id,
        requestId: "r1",
        decision: "approve",
        roleSlug: "spare-parts-sales",
        origin: "https://localhost",
      },
    ]);
  } finally {
    await t.cleanup();
  }
});

test("IntraForge's refusals come back as clear errors, and a refused list is empty", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      res.statusCode = 403;
      res.end(JSON.stringify({ detail: "no" }));
      return;
    }
    res.statusCode = 409;
    res.end(JSON.stringify({ detail: "This request was already decided." }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const gw = new PlatformAccessRequests(
      new IntraForgeClient({ internalUrl: `http://127.0.0.1:${port}`, serviceToken: "t".repeat(40), timeoutMs: 2000 }),
    );
    assert.deepEqual(await gw.list("u1"), { results: [], roles: [] });
    await assert.rejects(
      () => gw.decide({ actorId: "u1", requestId: "r1", decision: "approve", origin: "https://localhost" }),
      (e: Error & { status?: number }) => e.status === 409 && /already decided/.test(e.message),
    );
  } finally {
    server.close();
  }
});
