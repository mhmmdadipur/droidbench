// Lightweight, dependency-free i18n for Droidbench.
//
// Adding a language (for contributors):
//   1. Copy src/i18n/en.ts to src/i18n/<lang>.ts and translate the values.
//   2. Import it below and add an entry to `dictionaries` and `LANGUAGES`.
// Keys must stay identical across every language file (TypeScript enforces this
// because each dictionary is typed as `Dict`).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en, { type Dict } from "./en";
import id from "./id";

export type Lang = "en" | "id";

/** Registered languages (shown in the language switcher, in this order). */
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
];

const dictionaries: Record<Lang, Dict> = { en, id };

export type TKey = keyof Dict;
type Vars = Record<string, string | number>;

/** Interpolate {placeholders} in a template string. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

const STORAGE_KEY = "droidbench.lang";
// Default language is English (open-source default). The last chosen language
// is remembered across launches via localStorage.
const DEFAULT_LANG: Lang = "en";

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "id") return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Vars) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  // keep <html lang> in sync for accessibility
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: TKey, vars?: Vars): string => {
      const dict = dictionaries[lang] ?? en;
      const template = dict[key] ?? en[key] ?? (key as string);
      return interpolate(template, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
