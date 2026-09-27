import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "./cookie-name";

// Server-side code can hit the self-hosted Supabase stack's plain-HTTP
// address directly — mixed-content blocking only applies to requests the
// *browser* makes. SUPABASE_URL (no NEXT_PUBLIC_ prefix, server-only) is
// preferred when set; falls back to NEXT_PUBLIC_SUPABASE_URL (the
// same-origin HTTPS proxy path the browser uses) so this still works if
// only that one var is configured.
//
// IMPORTANT: whichever URL is used here, the auth COOKIE NAME must still
// match the browser client's (see cookie-name.ts) — @supabase/ssr derives a
// cookie name from the URL by default, so using a different URL server-side
// than client-side would otherwise silently break session recognition
// (a real successful sign-in whose cookie the server can never see).
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: AUTH_COOKIE_NAME },
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