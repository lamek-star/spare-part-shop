import type { SqlDatabase } from "../db/connection";
import type { Actor } from "../domain/types";
import type { AuditProvider } from "../providers/core";
import { validation } from "../kernel/errors";
import { nowIso } from "../kernel/ids";

/**
 * The language the screens and printed documents use: each person may choose
 * their own; otherwise the shop's default (set by someone with
 * settings.manage); otherwise English. Kept in this application's own
 * app_config table (same in the standalone and the IntraForge edition), so a
 * choice follows the person to every device they sign in on.
 */
export const LANGUAGES = ["en", "ar", "am", "ti"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Languages whose translations stay in the code but are not offered or accepted yet: Amharic waits for its next
 * build (2026-11-27). A saved choice of one reads as "not chosen" (the shop's language, or English). Switch one
 * back on by removing it here and in src/ui/messages/index.ts (a test keeps the two lists equal). */
export const DORMANT_LANGUAGES: readonly Language[] = ["am"];

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" &&
  (LANGUAGES as readonly string[]).includes(value) &&
  !(DORMANT_LANGUAGES as readonly string[]).includes(value);

const SHOP_KEY = "language:shop";
const userKey = (userId: string) => `language:user:${userId}`;

export interface LanguageChoice {
  /** The person's own choice; null = follow the shop. */
  personal: Language | null;
  shop: Language;
  /** What the screens use. */
  effective: Language;
}

async function read(db: SqlDatabase, key: string): Promise<Language | null> {
  const row = await db.read((h) =>
    h.get<{ value: string }>("SELECT value FROM app_config WHERE key = ?", [
      key,
    ]),
  );
  return row && isLanguage(row.value) ? row.value : null;
}

async function write(
  db: SqlDatabase,
  key: string,
  value: Language | null,
): Promise<void> {
  await db.write(async (h) => {
    if (value === null)
      await h.run("DELETE FROM app_config WHERE key = ?", [key]);
    else
      await h.run(
        `INSERT INTO app_config(key,value,updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, nowIso()],
      );
  });
}

export async function languageChoice(
  db: SqlDatabase,
  userId: string,
): Promise<LanguageChoice> {
  const personal = await read(db, userKey(userId));
  const shop = (await read(db, SHOP_KEY)) ?? "en";
  return { personal, shop, effective: personal ?? shop };
}

/** The person's own choice (null = follow the shop's default). */
export async function setPersonalLanguage(
  db: SqlDatabase,
  actor: Actor,
  value: unknown,
): Promise<LanguageChoice> {
  if (value !== null && !isLanguage(value))
    throw validation("Choose English, Arabic or Tigrinya.");
  await write(db, userKey(actor.id), value);
  return languageChoice(db, actor.id);
}

/** The shop's default; the caller checks settings.manage. */
export async function setShopLanguage(
  db: SqlDatabase,
  audit: AuditProvider,
  actor: Actor,
  value: unknown,
): Promise<LanguageChoice> {
  if (!isLanguage(value))
    throw validation("Choose English, Arabic or Tigrinya.");
  await db.write(async () => {
    await write(db, SHOP_KEY, value);
    await audit.record(actor, {
      action: "settings.update",
      entityType: "settings",
      summary: `Shop language set to ${value}`,
      metadata: { fields: ["language"], language: value },
    });
  });
  return languageChoice(db, actor.id);
}
