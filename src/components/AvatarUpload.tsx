"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import Avatar from "./Avatar";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function AvatarUpload({
  userId,
  displayName,
  avatarUrl,
  onUploaded,
  size = "lg",
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  onUploaded: (url: string) => void;
  size?: "sm" | "md" | "lg";
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError(t("avatarInvalidType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("avatarTooLarge"));
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      // Fixed filename per user so re-uploads overwrite the old avatar
      // instead of accumulating orphaned files in the bucket.
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-bust so the new image shows immediately everywhere it's used.
      const bustedUrl = `${publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: bustedUrl })
        .eq("id", userId);
      if (updateError) throw updateError;

      onUploaded(bustedUrl);
    } catch (err) {
      console.error(err);
      setError(t("avatarUploadFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative rounded-full disabled:opacity-60"
        title={t("changeAvatar")}
        aria-label={t("changeAvatar")}
      >
        <Avatar name={displayName} avatarUrl={avatarUrl} size={size} />
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-transparent transition group-hover:bg-black/50 group-hover:text-white ${
            size === "sm" ? "text-[8px]" : "text-[10px]"
          }`}
        >
          {uploading ? "…" : size === "sm" ? "✎" : t("changeAvatar")}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="max-w-[8rem] text-center text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
