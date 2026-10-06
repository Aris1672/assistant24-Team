"use client";

import CircuitBackground from "@/components/CircuitBackground";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function HomePage() {
  const { t } = useLanguage();
  return (
    <div className="relative flex flex-1 flex-col items-center justify-end overflow-hidden bg-neutral-950 pb-14 text-neutral-500">
      <CircuitBackground variant="list" />
      <p className="relative">{t("selectConversation")}</p>
    </div>
  );
}
