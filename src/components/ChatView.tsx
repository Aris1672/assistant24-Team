"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message, Profile, Attachment } from "@/lib/types";
import { safeStorageKey } from "@/lib/storage";
import AttachmentLink from "./AttachmentLink";
import Avatar from "./Avatar";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export default function ChatView({
  channel,
  members,
  initialMessages,
  currentUserId,
}: {
  channel: Channel;
  members: Profile[];
  initialMessages: Message[];
  currentUserId: string;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const otherMember = channel.is_dm
    ? members.find((m) => m.id !== currentUserId)
    : undefined;
  const title = channel.is_dm ? otherMember?.display_name ?? t("directMessage") : `# ${channel.name}`;

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const sub = supabase
      .channel(`channel-${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        async (payload) => {
          const newMsg = payload.new as Message;
          const { data: sender } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", newMsg.sender_id)
            .single();
          setMessages((prev) =>
            prev.some((m) => m.id === newMsg.id)
              ? prev
              : [...prev, { ...newMsg, sender: sender ?? undefined, attachments: [] }]
          );

          if (newMsg.sender_id !== currentUserId) {
            await supabase
              .from("channel_members")
              .update({ last_read_at: new Date().toISOString() })
              .eq("channel_id", channel.id)
              .eq("user_id", currentUserId);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attachments",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const att = payload.new as Attachment;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === att.message_id
                ? { ...m, attachments: [...(m.attachments ?? []), att] }
                : m
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, currentUserId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    setSending(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: inserted, error } = await supabase
        .from("messages")
        .insert({ channel_id: channel.id, sender_id: user.id, body: body.trim() || null })
        .select()
        .single();

      if (error || !inserted) throw error;

      // Optimistically show it locally (realtime will also deliver it; dedupe by id).
      setMessages((prev) =>
        prev.some((m) => m.id === inserted.id)
          ? prev
          : [...prev, { ...inserted, sender: undefined, attachments: [] }]
      );

      for (const file of files) {
        const path = `${channel.id}/${inserted.id}/${safeStorageKey(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;

        const { data: att, error: attError } = await supabase
          .from("attachments")
          .insert({
            message_id: inserted.id,
            channel_id: channel.id,
            uploader_id: user.id,
            storage_path: path,
            file_name: file.name,
            content_type: file.type || null,
            size_bytes: file.size,
          })
          .select()
          .single();
        if (attError) throw attError;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === inserted.id
              ? { ...m, attachments: [...(m.attachments ?? []), att] }
              : m
          )
        );
      }

      setBody("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error(err);
      alert(t("failedToSend"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-4 md:px-6">
        <Link
          href="/"
          className="-ml-1 rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 md:hidden"
          aria-label={t("backToConversations")}
        >
          ←
        </Link>
        {channel.is_dm && <Avatar name={title} avatarUrl={otherMember?.avatar_url} size="sm" />}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-neutral-100">{title}</h1>
          {!channel.is_dm && (
            <p className="truncate text-xs text-neutral-500">
              {members.map((m) => m.display_name).join(", ")}
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const isMine = m.sender_id === currentUserId;
          const sender =
            m.sender ?? members.find((mem) => mem.id === m.sender_id);
          const senderName = sender?.display_name ?? t("someone");
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}
            >
              {!isMine && (
                <Avatar name={senderName} avatarUrl={sender?.avatar_url} size="sm" />
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-base md:max-w-[70%] md:text-sm ${
                  isMine ? "bg-indigo-600 text-white" : "bg-neutral-800 text-neutral-100"
                }`}
              >
                {!isMine && (
                  <p className="mb-1 text-sm font-semibold text-neutral-400 md:text-xs">{senderName}</p>
                )}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.attachments.map((a) => (
                      <AttachmentLink key={a.id} attachment={a} />
                    ))}
                  </div>
                )}
                <p
                  className={`mt-1 text-xs md:text-[10px] ${
                    isMine ? "text-indigo-200" : "text-neutral-500"
                  }`}
                >
                  {formatTime(m.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">{t("noMessagesYet")}</p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-neutral-800 px-6 py-4">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
              >
                {f.name}
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-neutral-500 hover:text-neutral-200"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
            title={t("attachFiles")}
          >
            📎
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            rows={1}
            placeholder={t("writeMessage")}
            className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-base text-neutral-100 outline-none focus:border-indigo-500 md:text-sm"
          />
          <button
            type="submit"
            disabled={sending}
            aria-label={t("send")}
            title={t("send")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
