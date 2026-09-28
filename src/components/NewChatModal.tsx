"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import Avatar from "./Avatar";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function NewChatModal({
  currentUserId,
  onClose,
}: {
  currentUserId: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLanguage();
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .neq("id", currentUserId)
      .order("display_name")
      .then(({ data }) => setPeople(data ?? []));
  }, [currentUserId, supabase]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleCreate() {
    setError(null);
    if (selected.length === 0) {
      setError(t("pickAtLeastOnePerson"));
      return;
    }
    setLoading(true);
    try {
      if (selected.length === 1 && !channelName.trim()) {
        const res = await fetch("/api/new-dm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ otherUserId: selected[0] }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("failedToCreateChat"));
        router.push(`/channel/${json.channelId}`);
      } else {
        if (!channelName.trim()) {
          setError(t("groupChatsNeedName"));
          setLoading(false);
          return;
        }
        const res = await fetch("/api/new-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: channelName.trim(), memberIds: selected }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("failedToCreateChannel"));
        router.push(`/channel/${json.channelId}`);
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{t("newMessageTitle")}</h2>

        <label className="mb-1 block text-sm text-neutral-400">
          {t("groupNameLabel")}
        </label>
        <input
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          placeholder={t("groupNamePlaceholder")}
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />

        <label className="mb-1 block text-sm text-neutral-400">{t("addPeople")}</label>
        <div className="mb-4 max-h-56 overflow-y-auto rounded-md border border-neutral-800">
          {people.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-2 border-b border-neutral-800 px-3 py-2 last:border-b-0 hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <Avatar name={p.display_name} avatarUrl={p.avatar_url} size="sm" />
              <span className="text-sm">{p.display_name}</span>
              <span className="ml-auto text-xs text-neutral-500">{p.email}</span>
            </label>
          ))}
          {people.length === 0 && (
            <p className="px-3 py-4 text-sm text-neutral-500">
              {t("noOtherTeammates")}
            </p>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? t("creating") : t("startChat")}
          </button>
        </div>
      </div>
    </div>
  );
}
