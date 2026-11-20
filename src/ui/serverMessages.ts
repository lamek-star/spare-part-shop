import { en, type MessageKey } from "./messages/en";
import { translate, type Language, type Vars } from "./messages";

/**
 * The server answers in English (its messages are also its log and audit
 * language). The screens show them in the person's language: the English
 * text is the message id, as in gettext. Each "srv.*" key's English text is
 * either an exact message or a template whose {name} parts match the values
 * the server filled in. A value that is itself a known message, a noun
 * ("Product") or a status ("draft") is translated as well. A message the
 * catalogue does not know is shown in English, never blank.
 * tests/server/server-messages.test.ts checks every message the server can
 * send has an entry here.
 */
interface Template {
  key: MessageKey;
  re: RegExp;
  names: string[];
  /** Characters of fixed text: the more, the more specific the template. */
  fixed: number;
  /** A noun ("srv.n.*", e.g. "Product on line {line}"): only ever a value inside a message. */
  noun: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exact = new Map<string, MessageKey>();
const templates: Template[] = [];
for (const key of Object.keys(en) as MessageKey[]) {
  if (!key.startsWith("srv.")) continue;
  const parts = en[key].split(/\{(\w+)\}/);
  if (parts.length === 1) {
    exact.set(en[key], key);
    continue;
  }
  const names: string[] = [];
  let source = "^";
  let fixed = 0;
  parts.forEach((part, i) => {
    if (i % 2) {
      names.push(part);
      source += "(.*?)";
    } else {
      source += escape(part);
      fixed += part.length;
    }
  });
  templates.push({
    key,
    re: new RegExp(source + "$", "s"),
    names,
    fixed,
    noun: key.startsWith("srv.n."),
  });
}
templates.sort((a, b) => b.fixed - a.fixed);

function value(language: Language, text: string, depth: number): string {
  if (depth < 3) {
    const known = match(language, text, depth + 1, true);
    if (known !== null) return known;
  }
  const status = `status.${text
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")}`;
  if (status in en) return translate(language, status as MessageKey);
  return text;
}

function match(
  language: Language,
  text: string,
  depth: number,
  asValue = false,
): string | null {
  const key = exact.get(text);
  if (key && (asValue || !key.startsWith("srv.n.")))
    return translate(language, key);
  for (const t of templates) {
    if (t.noun && !asValue) continue;
    const m = t.re.exec(text);
    if (!m) continue;
    const vars: Vars = {};
    t.names.forEach((name, i) => {
      vars[name] = value(language, m[i + 1], depth);
    });
    return translate(language, t.key, vars);
  }
  return null;
}

/** A server message (error or notice) in the person's language. */
export function translateServerMessage(
  language: Language,
  text: string,
): string {
  if (language === "en" || !text) return text;
  const whole = match(language, text, 0);
  if (whole !== null) return whole;
  // Several messages joined into one ("A is required. B must be text."): translate the ones it knows.
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    let any = false;
    const out = sentences.map((s) => {
      const t = match(language, s, 0);
      if (t !== null) any = true;
      return t ?? s;
    });
    if (any) return out.join(" ");
  }
  return text;
}

/** Whether the catalogue has an entry for this English message (used by the tests). */
export const knowsServerMessage = (text: string): boolean =>
  match("ar", text, 0) !== null;
