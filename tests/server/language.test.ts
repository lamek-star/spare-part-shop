import test from "node:test";
import assert from "node:assert/strict";
import { makeHttpApp } from "./http-helpers";

test("each person chooses a language; otherwise the shop's default; the shop default needs settings.manage", async () => {
  const t = await makeHttpApp();
  try {
    const owner = await t.as("OWNER");
    const sales = await t.as("SALES");

    // Nothing chosen: English.
    let r = await sales.send("GET", "/me/language");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { personal: null, shop: "en", effective: "en" });

    // The owner sets the shop to Amharic: everyone who has not chosen follows.
    r = await owner.send("PUT", "/settings/language", {
      json: { language: "am" },
    });
    assert.equal(r.status, 200);
    r = await sales.send("GET", "/me/language");
    assert.equal(r.data.effective, "am");

    // A person's own choice wins, and only for them; null follows the shop again.
    r = await sales.send("PUT", "/me/language", { json: { language: "ar" } });
    assert.deepEqual(r.data, { personal: "ar", shop: "am", effective: "ar" });
    assert.equal(
      (await owner.send("GET", "/me/language")).data.effective,
      "am",
    );
    r = await sales.send("PUT", "/me/language", { json: { language: null } });
    assert.equal(r.data.effective, "am");

    // Only the four languages; only settings.manage changes the shop default.
    r = await sales.send("PUT", "/me/language", { json: { language: "fr" } });
    assert.equal(r.status, 400);
    r = await sales.send("PUT", "/settings/language", {
      json: { language: "en" },
    });
    assert.equal(r.status, 403);
    r = await owner.send("PUT", "/settings/language", {
      json: { language: "xx" },
    });
    assert.equal(r.status, 400);

    // Not signed in: refused.
    assert.equal((await t.client().send("GET", "/me/language")).status, 401);

    // The shop default change is in the audit log.
    const audit = await owner.send("GET", "/audit?entityType=settings");
    assert.ok(
      JSON.stringify(audit.data).includes("Shop language set to am"),
      "audit records the change",
    );
  } finally {
    await t.cleanup();
  }
});
