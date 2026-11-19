import { am } from "./am";
import { ar } from "./ar";
import { en, type MessageKey, type Messages } from "./en";
import { ti } from "./ti";

export type { MessageKey } from "./en";

/** The languages Spare Parts speaks (the server accepts the same four: server/i18n/language.ts). */
export const LANGUAGES = {
  en: { native: "English", dir: "ltr" },
  ar: { native: "العربية", dir: "rtl" },
  am: { native: "አማርኛ", dir: "ltr" },
  ti: { native: "ትግርኛ", dir: "ltr" },
} as const;
export type Language = keyof typeof LANGUAGES;

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && value in LANGUAGES;

const CATALOG: Record<Language, Messages> = { en, ar, am, ti };

export type Vars = Record<string, string | number>;

/** The message in that language, or in English if it has none yet; {name} filled from vars. */
export function translate(
  language: Language,
  key: MessageKey,
  vars?: Vars,
): string {
  const text = CATALOG[language][key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** How many of the English keys a language translates (0..1); shown nowhere, used by the tests. */
export function coverage(language: Language): number {
  const keys = Object.keys(en) as MessageKey[];
  return keys.filter((k) => CATALOG[language][k]).length / keys.length;
}
