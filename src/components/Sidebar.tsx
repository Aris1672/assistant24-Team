"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, ChannelWithMeta } from "@/lib/types";
import NewChatModal from "./NewChatModal";
import Toast from "./Toast";
import LanguageSwitcher from "./LanguageSwitcher";
import Avatar from "./Avatar";
import AvatarUpload from "./AvatarUpload";
import PushNotifications from "./PushNotifications";
import CircuitBackground from "./CircuitBackground";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// True below the md breakpoint (phones). The circuit background is only shown
// there: on a phone the conversation list is a full screen of its own, while
// on desktop it's a narrow side column next to the chat.
function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false
  );
}

export default function Sidebar({ currentUser }: { currentUser: Profile }) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const isPhone = useIsPhone();
  const [channels, setChannels] = useState<ChannelWithMeta[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatar_url);

  const activeChannelId = pathname?.startsWith("/channel/")
    ? pathname.split("/")[2]
    : null;

  const loadChannels = useCallback(async () => {
    const { data: memberships } = await supabase
      .from("channel_members")
      .select("channel_id, last_read_at, channels(*)")
      .eq("user_id", currentUser.id);

    if (!memberships) {
      setChannels([]);
      return;
    }

    const results: ChannelWithMeta[] = [];
    for (const m of memberships) {
      const channel = Array.isArray(m.channels) ? m.channels[0] : m.channels;
      if (!channel) continue;

      const { data: memberRows } = await supabase
        .from("channel_members")
        .select("profiles(*)")
        .eq("channel_id", channel.id);

      const members = (memberRows ?? [])
        .map((r) => (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles))
        .filter(Boolean) as Profile[];

      const { data: lastMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", channel.id)
        .gt("created_at", m.last_read_at);

      results.push({
        ...channel,
        members,
        lastMessage: lastMessages?.[0] ?? null,
        unreadCount: count ?? 0,
      });
    }

    results.sort((a, b) => {
      const ta = a.lastMessage?.created_at ?? a.created_at;
      const tb = b.lastMessage?.created_at ?? b.created_at;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

    setChannels(results);
  }, [supabase, currentUser.id]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    const channel = supabase
      .channel("sidebar-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as { channel_id: string; sender_id: string; body: string | null };
          if (msg.sender_id !== currentUser.id && msg.channel_id !== activeChannelId) {
            setToast(t("newMessageReceived"));
          }
          loadChannels();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, currentUser.id, activeChannelId]);

  function labelFor(c: ChannelWithMeta) {
    if (!c.is_dm) return c.name ?? t("unnamedChannel");
    const other = c.members.find((m) => m.id !== currentUser.id);
    return other?.display_name ?? t("directMessage");
  }

  function avatarFor(c: ChannelWithMeta) {
    if (c.is_dm) {
      const other = c.members.find((m) => m.id !== currentUser.id);
      return <Avatar name={other?.display_name ?? "?"} avatarUrl={other?.avatar_url} size="sm" />;
    }
    return <Avatar name={c.name ?? "#"} avatarUrl={null} size="sm" />;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="relative isolate flex w-full shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 md:w-72 md:bg-neutral-900">
      {isPhone && <CircuitBackground className="-z-10" />}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <AvatarUpload
            userId={currentUser.id}
            displayName={currentUser.display_name}
            avatarUrl={avatarUrl}
            onUploaded={setAvatarUrl}
            size="sm"
          />
          <div>
            <p className="text-sm font-semibold text-neutral-100">{t("appName")}</p>
            <p className="text-xs text-neutral-500">{currentUser.display_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher compact />
          <button
            onClick={handleSignOut}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            {t("signOut")}
          </button>
        </div>
      </div>

      <PushNotifications />

      <div className="px-4 py-3">
        <button
          onClick={() => setShowNewChat(true)}
          className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {t("newMessage")}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {channels.map((c) => (
          <Link
            key={c.id}
            href={`/channel/${c.id}`}
            className={`mb-1 flex items-center justify-between rounded-md px-3 py-2 text-sm transition ${
              activeChannelId === c.id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {avatarFor(c)}
              <span className="truncate">
                {c.is_dm ? "" : "# "}
                {labelFor(c)}
              </span>
            </span>
            {c.unreadCount > 0 && (
              <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[11px] font-semibold text-white">
                {c.unreadCount}
              </span>
            )}
          </Link>
        ))}
        {channels.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-500">{t("noConversations")}</p>
        )}
      </nav>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {showNewChat && (
        <NewChatModal
          currentUserId={currentUser.id}
          onClose={() => {
            setShowNewChat(false);
            loadChannels();
          }}
        />
      )}
    </aside>
  );
}
