"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(attachment.storage_path, 60);
      if (error || !data) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      alert("Couldn't get a download link for this file.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex w-full items-center gap-2 rounded-md bg-black/20 px-2 py-1.5 text-left text-xs hover:bg-black/30 disabled:opacity-50"
    >
      <span>📄</span>
      <span className="truncate">{attachment.file_name}</span>
      <span className="ml-auto shrink-0 text-[10px] opacity-70">
        {formatSize(attachment.size_bytes)}
      </span>
    </button>
  );
}
