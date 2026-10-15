"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";
import { getSignedImageUrl } from "@/lib/attachments";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// Full-screen viewer for the pictures of one message. Esc / click outside /
// the close button dismiss it; ← → (or the arrow buttons) step through the
// message's pictures. Rendered in a portal so no parent's stacking context
// or overflow can clip it.
export default function ImageViewer({
  images,
  startIndex,
  onClose,
}: {
  images: Attachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(startIndex);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const current = images[index];
  const many = images.length > 1;

  const step = useCallback(
    (delta: number) => setIndex((i) => (i + delta + images.length) % images.length),
    [images.length]
  );

  // Load the current picture, and quietly warm up its neighbours.
  useEffect(() => {
    let cancelled = false;
    const wanted = new Set([index, (index + 1) % images.length, (index - 1 + images.length) % images.length]);
    wanted.forEach((i) => {
      const a = images[i];
      getSignedImageUrl(a.storage_path)
        .then((u) => {
          if (!cancelled) setUrls((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: u }));
        })
        .catch((err) => {
          console.error(err);
          if (!cancelled) setFailed((prev) => ({ ...prev, [a.id]: true }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [index, images]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && many) step(-1);
      else if (e.key === "ArrowRight" && many) step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, many, step]);

  async function handleDownload() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(current.storage_path, 60, { download: current.file_name });
      if (error || !data) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      alert(t("downloadFailed"));
    }
  }

  const btn =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.file_name}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm">
          {current.file_name}
          {many && <span className="ml-2 text-white/60">{index + 1} / {images.length}</span>}
        </p>
        <button type="button" onClick={handleDownload} aria-label={t("download")} title={t("download")} className={btn}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M12 4v11" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
        </button>
        <button type="button" onClick={onClose} aria-label={t("close")} title={t("close")} className={btn}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {failed[current.id] ? (
        <p className="text-sm text-white/70" onClick={(e) => e.stopPropagation()}>
          {t("imageLoadFailed")}
        </p>
      ) : urls[current.id] ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, short-lived signed URL
        <img
          src={urls[current.id]}
          alt={current.file_name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85vh] max-w-[95vw] object-contain"
        />
      ) : (
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      )}

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label={t("previousImage")}
            className={`${btn} absolute left-3 top-1/2 -translate-y-1/2`}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label={t("nextImage")}
            className={`${btn} absolute right-3 top-1/2 -translate-y-1/2`}
          >
            ›
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
