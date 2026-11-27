import test from "node:test";
import assert from "node:assert/strict";
import { en, type MessageKey } from "../../src/ui/messages/en";
import { ar } from "../../src/ui/messages/ar";
import { am } from "../../src/ui/messages/am";
import { ti } from "../../src/ui/messages/ti";
import {
  coverage,
  DORMANT_LANGUAGES,
  LANGUAGES,
  translate,
  type Language,
} from "../../src/ui/messages";
import {
  DORMANT_LANGUAGES as SERVER_DORMANT,
  LANGUAGES as SERVER_LANGUAGES,
} from "../../src/server/i18n/language";

const OTHERS = { ar, am, ti } as const;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

test("the browser and the server know the same four languages; only Arabic is right-to-left", () => {
  assert.deepEqual(Object.keys(LANGUAGES).sort(), [...SERVER_LANGUAGES].sort());
  assert.deepEqual([...DORMANT_LANGUAGES].sort(), [...SERVER_DORMANT].sort());
  for (const [code, info] of Object.entries(LANGUAGES))
    assert.equal(info.dir, code === "ar" ? "rtl" : "ltr", code);
});

test("every language translates every message, keeping each {placeholder}", () => {
  for (const [code, messages] of Object.entries(OTHERS)) {
    assert.equal(coverage(code as Language), 1, `${code} misses messages`);
    for (const key of Object.keys(messages) as MessageKey[]) {
      assert.ok(key in en, `${code} has a key English does not: ${key}`);
      assert.deepEqual(
        placeholders(messages[key]!),
        placeholders(en[key]),
        `${code} ${key} placeholders`,
      );
      assert.notEqual(messages[key]!.trim(), "", `${code} ${key} is empty`);
    }
  }
});

test("translate fills placeholders and falls back to English, never blank", () => {
  assert.equal(
    translate("en", "lang.followShop", { language: "አማርኛ" }),
    "Shop default (አማርኛ)",
  );
  assert.equal(translate("ar", "nav.dashboard"), ar["nav.dashboard"]);
  // A value that is not given stays visible rather than disappearing.
  assert.equal(translate("en", "lang.followShop"), "Shop default ({language})");
});
