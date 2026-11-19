"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { get, put } from "./api";
import { useSession } from "./session";
import {
  isLanguage,
  LANGUAGES,
  translate,
  type Language,
  type MessageKey,
  type Vars,
} from "./messages";

export { LANGUAGES, type Language } from "./messages";
/** A translate function: t(key, vars). */
export type Translate = (key: MessageKey, vars?: Vars) => string;

interface Choice {
  personal: Language | null;
  shop: Language;
  effective: Language;
}
interface I18nState {
  language: Language;
  dir: "ltr" | "rtl";
  choice: Choice | null;
  t(key: MessageKey, vars?: Vars): string;
  /** The person's own language; null = follow the shop's default. */
  choose(language: Language | null): Promise<void>;
  /** The shop's default (needs settings.manage). */
  setShopDefault(language: Language): Promise<void>;
}

const Ctx = createContext<I18nState | null>(null);
// The last language used on this device: the sign-in screen shows it before anyone is signed in.
const LAST_KEY = "spareparts.language";

function remembered(): Language {
  try {
    const v = window.localStorage.getItem(LAST_KEY);
    return isLanguage(v) ? v : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [fallback, setFallback] = useState<Language>("en");
  useEffect(() => setFallback(remembered()), []);

  const userId = session.me?.user.id;
  useEffect(() => {
    if (session.status !== "ready") {
      setChoice(null);
      return;
    }
    let live = true;
    get<Choice>("/me/language")
      .then((c) => {
        if (live) setChoice(c);
      })
      .catch(() => {
        if (live) setChoice(null);
      });
    return () => {
      live = false;
    };
  }, [session.status, userId]);

  const language = choice?.effective ?? fallback;
  const dir = LANGUAGES[language].dir;

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    try {
      window.localStorage.setItem(LAST_KEY, language);
    } catch {
      /* private window: only the sign-in screen's language is affected */
    }
  }, [language, dir]);

  const choose = useCallback(async (next: Language | null) => {
    setChoice(await put<Choice>("/me/language", { language: next }));
  }, []);
  const setShopDefault = useCallback(async (next: Language) => {
    setChoice(await put<Choice>("/settings/language", { language: next }));
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      language,
      dir,
      choice,
      t: (key, vars) => translate(language, key, vars),
      choose,
      setShopDefault,
    }),
    [language, dir, choice, choose, setShopDefault],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
/** The translate function alone: const t = useT(); t("nav.dashboard"). */
export const useT = () => useI18n().t;
