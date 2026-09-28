// Builds an ASCII-only, URL-safe object key for Supabase Storage uploads.
//
// Why this exists: @supabase/storage-js builds the upload URL by simply
// string-concatenating the path onto the API URL (no encodeURIComponent —
// see `_getFinalPath` in its source), and self-hosted Supabase adds a
// Kong/Envoy hop in front of the storage-api that this app's own /supabase
// proxy rewrite also passes through. A raw file name containing non-ASCII
// characters (Cyrillic, for instance) or characters like spaces, `#`, `%`,
// `+`, parentheses, etc. can silently fail somewhere in that chain even
// though plain-ASCII names upload fine — which is exactly the "some files
// upload, others don't" symptom this fixes.
//
// The random id keeps keys unique without depending on the original name at
// all; the real, human-readable name is preserved separately (e.g. in the
// `attachments.file_name` / `profiles.avatar_url` columns) for display and
// download, so nothing user-facing changes.
export function safeStorageKey(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const rawExt = dot > 0 ? originalName.slice(dot + 1) : "";
  // Only keep the extension if it's short and plain ASCII alphanumeric —
  // otherwise drop it rather than risk carrying over the same problem.
  const ext = /^[a-zA-Z0-9]{1,8}$/.test(rawExt) ? `.${rawExt.toLowerCase()}` : "";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}${ext}`;
}
