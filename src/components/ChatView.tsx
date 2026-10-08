"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Message, Profile, Attachment } from "@/lib/types";
import { safeStorageKey } from "@/lib/storage";
import AttachmentLink from "./AttachmentLink";
import Avatar from "./Avatar";
import CircuitBackground, { type CircuitBackgroundHandle } from "./CircuitBackground";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

// One-line text used when quoting a message: its body, or the first file name
// for a file-only message.
function previewText(m: Message) {
  if (m.body) return m.body;
  const first = m.attachments?.[0];
  return first ? `📎 ${first.file_name}` : "";
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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const meshRef = useRef<CircuitBackgroundHandle>(null);

  const otherMember = channel.is_dm
    ? members.find((m) => m.id !== currentUserId)
    : undefined;
  const title = channel.is_dm ? otherMember?.display_name ?? t("directMessage") : `# ${channel.name}`;

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // A pending reply belongs to the conversation it was started in; ignore it
  // if the user has switched to another channel since.
  const activeReply = replyTo && replyTo.channel_id === channel.id ? replyTo : null;

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
            meshRef.current?.pulse("left");
            await supabase
              .from("channel_members")
              .update({ last_read_at: new Date().toISOString() })
              .eq("channel_id", channel.id)
              .eq("user_id", currentUserId);
          }
        }
      )
      .on(
        // Someone (us on another device, or the other person) deleted a
        // message. DELETE events can't be filtered by channel (only the
        // primary key is in the payload), so every subscriber gets them —
        // harmless: we only drop the id if it's one we're showing.
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
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
        .insert({
          channel_id: channel.id,
          sender_id: user.id,
          body: body.trim() || null,
          // Only sent when actually replying, so ordinary messages keep
          // working even on a database that hasn't run 0004 yet.
          ...(activeReply ? { reply_to_id: activeReply.id } : {}),
        })
        .select()
        .single();

      if (error || !inserted) throw error;

      // Optimistically show it locally (realtime will also deliver it; dedupe by id).
      setMessages((prev) =>
        prev.some((m) => m.id === inserted.id)
          ? prev
          : [...prev, { ...inserted, sender: undefined, attachments: [] }]
      );
      meshRef.current?.pulse("right");

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
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error(err);
      alert(t("failedToSend"));
    } finally {
      setSending(false);
    }
  }

  function startReply(m: Message) {
    setReplyTo(m);
    textareaRef.current?.focus();
  }

  // Scroll to a quoted message and flash it briefly. Safe no-op if it isn't
  // in the DOM (e.g. it was deleted).
  function jumpToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1500);
  }

  async function handleDelete(m: Message) {
    if (!window.confirm(t("deleteMessageConfirm"))) return;
    try {
      // Remove the files first, then the message row (its attachment rows
      // cascade). Realtime then removes the message on the other side too.
      const paths = (m.attachments ?? []).map((a) => a.storage_path);
      if (paths.length > 0) {
        const { error: rmError } = await supabase.storage.from("attachments").remove(paths);
        if (rmError) throw rmError;
      }
      const { error } = await supabase.from("messages").delete().eq("id", m.id);
      if (error) throw error;
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      console.error(err);
      alert(t("failedToDelete"));
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

      <div className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950">
        <CircuitBackground ref={meshRef} />
        <div className="relative h-full space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => {
          const isMine = m.sender_id === currentUserId;
          const sender =
            m.sender ?? members.find((mem) => mem.id === m.sender_id);
          const senderName = sender?.display_name ?? t("someone");
          const quoted = m.reply_to_id
            ? messages.find((x) => x.id === m.reply_to_id)
            : undefined;
          const quotedName = quoted
            ? (quoted.sender ?? members.find((mem) => mem.id === quoted.sender_id))
                ?.display_name ?? t("someone")
            : "";
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={`flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}
            >
              {!isMine && (
                <Avatar name={senderName} avatarUrl={sender?.avatar_url} size="sm" />
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-base transition-shadow md:max-w-[70%] md:text-sm ${
                  isMine ? "bg-indigo-600 text-white" : "bg-neutral-800 text-neutral-100"
                } ${highlightId === m.id ? "ring-2 ring-amber-400" : ""}`}
              >
                {!isMine && (
                  <p className="mb-1 text-sm font-semibold text-neutral-400 md:text-xs">{senderName}</p>
                )}
                {m.reply_to_id &&
                  (quoted ? (
                    <button
                      type="button"
                      onClick={() => jumpToMessage(quoted.id)}
                      className={`mb-1 block w-full rounded border-l-2 px-2 py-1 text-left ${
                        isMine
                          ? "border-indigo-200 bg-indigo-700/60 hover:bg-indigo-700"
                          : "border-neutral-500 bg-neutral-900/60 hover:bg-neutral-900"
                      }`}
                    >
                      <span
                        className={`block truncate text-xs font-semibold ${
                          isMine ? "text-indigo-100" : "text-neutral-300"
                        }`}
                      >
                        {quotedName}
                      </span>
                      <span
                        className={`block truncate text-xs ${
                          isMine ? "text-indigo-200" : "text-neutral-400"
                        }`}
                      >
                        {previewText(quoted)}
                      </span>
                    </button>
                  ) : (
                    <p
                      className={`mb-1 rounded border-l-2 px-2 py-1 text-xs italic ${
                        isMine
                          ? "border-indigo-200 bg-indigo-700/60 text-indigo-200"
                          : "border-neutral-500 bg-neutral-900/60 text-neutral-500"
                      }`}
                    >
                      {t("originalDeleted")}
                    </p>
                  ))}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.attachments.map((a) => (
                      <AttachmentLink key={a.id} attachment={a} />
                    ))}
                  </div>
                )}
                <div
                  className={`mt-1 flex items-center justify-between gap-2 text-xs md:text-[10px] ${
                    isMine ? "text-indigo-200" : "text-neutral-500"
                  }`}
                >
                  <span>{formatTime(m.created_at)}</span>
                  <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startReply(m)}
                    aria-label={t("reply")}
                    title={t("reply")}
                    className={`rounded p-1 ${
                      isMine
                        ? "text-indigo-200/80 hover:bg-indigo-500 hover:text-white"
                        : "text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 md:h-3.5 md:w-3.5"
                    >
                      <path d="M9 14L4 9l5-5" />
                      <path d="M4 9h10a6 6 0 0 1 6 6v3" />
                    </svg>
                  </button>
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => handleDelete(m)}
                      aria-label={t("deleteMessage")}
                      title={t("deleteMessage")}
                      className="-mr-1 rounded p-1 text-indigo-200/80 hover:bg-indigo-500 hover:text-white"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4 md:h-3.5 md:w-3.5"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">{t("noMessagesYet")}</p>
        )}
        <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={handleSend} className="border-t border-neutral-800 px-6 py-4">
        {activeReply && (
          <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-indigo-400 bg-neutral-800 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-indigo-300">
                {t("replyingTo")}{" "}
                {(activeReply.sender ?? members.find((mem) => mem.id === activeReply.sender_id))
                  ?.display_name ?? t("someone")}
              </p>
              <p className="truncate text-xs text-neutral-400">{previewText(activeReply)}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label={t("cancelReply")}
              title={t("cancelReply")}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
            >
              ×
            </button>
          </div>
        )}
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
            ref={textareaRef}
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
