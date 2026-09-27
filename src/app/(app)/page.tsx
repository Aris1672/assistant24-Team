"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function HomePage() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 items-center justify-center text-neutral-500">
      <p>{t("selectConversation")}</p>
    </div>
  );
}
