"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translations, LOCALE_STORAGE_KEY, type Locale, type TranslationKey } from "./translations";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    // localStorage unavailable (private browsing etc.) — fall through.
  }
  const browserLang = window.navigator.language?.toLowerCase() ?? "";
  return browserLang.startsWith("ru") ? "ru" : "en";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Start with "en" on both server and client's first render so hydration
  // matches, then sync to the real preference (localStorage / browser lang)
  // right after mount.
  const [locale, setLocaleState] = useState<Locale>("en");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLocaleState(detectInitialLocale());
    setHydrated(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore write failures; the in-memory locale still updates.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey) => translations[locale][key] ?? translations.en[key] ?? key,
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  // Avoid a flash of mismatched text: render children immediately, they'll
  // just briefly show English (or the persisted locale once hydrated).
  void hydrated;

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
