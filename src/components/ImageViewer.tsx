"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";
import { getSignedImageUrl } from "@/lib/attachments";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// Swipe tuning.
const SWIPE_DISTANCE = 50; // px dragged sideways to change picture
const SWIPE_VELOCITY = 0.3; // px/ms — a quick flick counts even if short
const FLICK_MIN_DISTANCE = 30; // px — ...but not a mere twitch
const CLOSE_DISTANCE = 120; // px dragged up/down to dismiss

type Gesture = { id: number; x: number; y: number; t: number; axis: "x" | "y" | null };

// Full-screen viewer for the pictures of one message.
//  - Touch / mouse: drag sideways to move between the message's pictures (the
//    strip follows the finger and snaps), drag up/down to dismiss.
//  - Keyboard: ← → step, Esc closes. Arrow buttons are shown on wide screens.
// Rendered in a portal so no parent's stacking context or overflow can clip it.
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
  // Live finger offset while dragging; null when idle (so the snap animates).
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const last = images.length - 1;
  const many = images.length > 1;
  const current = images[index];

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta))),
    [last]
  );

  // Load the current picture's URL, and quietly warm up its neighbours.
  useEffect(() => {
    let cancelled = false;
    [index - 1, index, index + 1]
      .filter((i) => i >= 0 && i <= last)
      .forEach((i) => {
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
  }, [index, images, last]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  function onPointerDown(e: React.PointerEvent) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    suppressClick.current = false;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // still a tap
      g.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"; // lock to one axis
    }
    if (g.axis === "x") {
      // Resist (rubber-band) when dragging past the first / last picture.
      const pastEdge = (dx > 0 && index === 0) || (dx < 0 && index === last);
      setDrag({ x: pastEdge ? dx * 0.3 : dx, y: 0 });
    } else {
      setDrag({ x: 0, y: dy });
    }
  }

  function endGesture(e: React.PointerEvent, cancelled: boolean) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDrag(null);
    if (g.axis) suppressClick.current = true; // it was a drag, not a tap
    if (cancelled || !g.axis) return;

    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const elapsed = Math.max(1, performance.now() - g.t);
    if (g.axis === "x") {
      const flick = Math.abs(dx) / elapsed > SWIPE_VELOCITY && Math.abs(dx) > FLICK_MIN_DISTANCE;
      if (Math.abs(dx) > SWIPE_DISTANCE || flick) go(dx < 0 ? 1 : -1);
    } else if (Math.abs(dy) > CLOSE_DISTANCE) {
      onClose();
    }
  }

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
  const arrow = `${btn} absolute top-1/2 z-10 hidden -translate-y-1/2 md:flex disabled:pointer-events-none disabled:opacity-0`;
  // Fade the backdrop while the picture is being dragged away vertically.
  const backdrop = 0.9 * (1 - Math.min(Math.abs(drag?.y ?? 0) / 400, 1));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.file_name}
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{ backgroundColor: `rgba(0, 0, 0, ${backdrop})` }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onClose();
      }}
    >
      {/* Strip of all pictures side by side; shifted to show the current one. */}
      <div
        className="absolute inset-0 flex touch-none select-none"
        style={{
          transform: `translate3d(calc(${-index * 100}% + ${drag?.x ?? 0}px), ${drag?.y ?? 0}px, 0)`,
          transition: drag ? "none" : "transform 250ms ease-out",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
      >
        {images.map((a, i) => (
          <div key={a.id} className="flex h-full w-full shrink-0 items-center justify-center">
            {Math.abs(i - index) <= 1 &&
              (failed[a.id] ? (
                <p className="text-sm text-white/70">{t("imageLoadFailed")}</p>
              ) : urls[a.id] ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, short-lived signed URL
                <img
                  src={urls[a.id]}
                  alt={a.file_name}
                  draggable={false}
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-[85vh] max-w-[95vw] object-contain"
                />
              ) : (
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ))}
          </div>
        ))}
      </div>

      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 px-4 py-3 text-white"
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

      {many && (
        <>
          <button
            type="button"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={t("previousImage")}
            className={`${arrow} left-3`}
          >
            ‹
          </button>
          <button
            type="button"
            disabled={index === last}
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t("nextImage")}
            className={`${arrow} right-3`}
          >
            ›
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
