"use client";

import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/types";
import { getSignedImageUrl } from "@/lib/attachments";
import AttachmentLink from "./AttachmentLink";

// An image attachment shown as a picture inside a chat bubble.
//  - "single": the picture at its natural aspect ratio (capped in height)
//  - "tile":   fills its grid cell (object-cover); the parent sets the cell's
//              aspect ratio through className
// The signed URL is only requested once the picture is near the viewport, so
// opening a long chat doesn't download every photo at once.
export default function AttachmentImage({
  attachment,
  variant,
  className = "",
  onOpen,
  onLoaded,
}: {
  attachment: Attachment;
  variant: "single" | "tile";
  className?: string;
  onOpen: () => void;
  onLoaded?: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let cancelled = false;

    const load = () => {
      getSignedImageUrl(attachment.storage_path)
        .then((u) => {
          if (!cancelled) setUrl(u);
        })
        .catch((err) => {
          console.error(err);
          if (!cancelled) setFailed(true);
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [attachment.storage_path]);

  // Couldn't get or decode the picture: fall back to the regular file row so
  // the file is still reachable.
  if (failed) {
    return (
      <div className="px-2 py-1">
        <AttachmentLink attachment={attachment} />
      </div>
    );
  }

  const isTile = variant === "tile";

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={onOpen}
      aria-label={attachment.file_name}
      title={attachment.file_name}
      className={`relative block cursor-zoom-in overflow-hidden bg-black/20 ${
        isTile ? "w-full" : loaded ? "" : "min-h-[160px] min-w-[200px]"
      } ${loaded ? "" : "animate-pulse"} ${className}`}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- private, short-lived signed URL
        <img
          src={url}
          alt={attachment.file_name}
          draggable={false}
          onLoad={() => {
            setLoaded(true);
            onLoaded?.();
          }}
          onError={() => setFailed(true)}
          className={
            isTile
              ? "absolute inset-0 h-full w-full object-cover"
              : "block h-auto max-h-96 w-auto max-w-full"
          }
        />
      )}
    </button>
  );
}
