import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Prefer the direct, plain-HTTP Supabase URL for server-to-server calls —
// see the comment in server.ts. Falls back to the browser's proxied URL if
// that's the only one configured.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Server-only client using the service_role key. Never import this from
// client components. Used to bypass RLS for trusted server-side operations
// like creating a DM channel between two users.
export function createAdminClient() {
  return createSupabaseClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
