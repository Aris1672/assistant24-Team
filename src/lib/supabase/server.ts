import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side code can hit the self-hosted Supabase stack's plain-HTTP
// address directly — mixed-content blocking only applies to requests the
// *browser* makes. SUPABASE_URL (no NEXT_PUBLIC_ prefix, server-only) is
// preferred when set; falls back to NEXT_PUBLIC_SUPABASE_URL (the
// same-origin HTTPS proxy path the browser uses) so this still works if
// only that one var is configured.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; middleware refreshes sessions instead.
          }
        },
      },
    }
  );
}
