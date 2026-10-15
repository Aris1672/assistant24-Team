import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";

// Formats every current browser can draw in an <img>. HEIC/TIFF/SVG are left
// out on purpose: they fall back to the normal file row instead of a broken
// picture.
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export function isImageAttachment(a: Attachment): boolean {
  if (a.content_type) return IMAGE_TYPES.has(a.content_type.toLowerCase());
  return IMAGE_EXT.test(a.file_name);
}

// The attachments bucket is private, so every picture needs a signed URL.
// Cache them (and de-duplicate in-flight requests) so thumbnails and the
// full-screen viewer don't mint a new URL each time they render.
const TTL_SECONDS = 3600;
const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

export function getSignedImageUrl(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return Promise.resolve(hit.url);

  const inflight = pending.get(path);
  if (inflight) return inflight;

  const request = (async () => {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("attachments")
      .createSignedUrl(path, TTL_SECONDS);
    if (error || !data) throw error ?? new Error("No signed URL returned");
    cache.set(path, { url: data.signedUrl, expires: Date.now() + TTL_SECONDS * 1000 });
    return data.signedUrl;
  })().finally(() => {
    pending.delete(path);
  });

  pending.set(path, request);
  return request;
}
