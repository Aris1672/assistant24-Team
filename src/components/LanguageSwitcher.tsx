"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { Locale } from "@/lib/i18n/translations";

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t("language")}
      className={`rounded-md border border-neutral-700 bg-neutral-800 text-neutral-300 outline-none focus:border-indigo-500 ${
        compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"
      }`}
    >
      <option value="en">EN</option>
      <option value="ru">RU</option>
    </select>
  );
}
