import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Exclude static assets AND /supabase/* — that path is a transparent
    // proxy passthrough to the Supabase backend (see next.config.ts), not
    // an app page, and must never be intercepted by the login-redirect
    // logic below (it isn't a browser navigation, it's an API call made by
    // the Supabase client — redirecting it silently breaks auth, realtime,
    // and file upload/download with confusing non-JSON error responses).
    "/((?!_next/static|_next/image|favicon.ico|supabase/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};