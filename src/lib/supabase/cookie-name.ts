// @supabase/ssr derives its auth cookie's name from the Supabase URL passed
// to createBrowserClient/createServerClient (roughly `sb-<host-derived-ref>-auth-token`).
// This app intentionally uses TWO different URLs for Supabase: the browser
// talks to a same-origin proxy path (to avoid mixed-content blocking, see
// next.config.ts), while server-side code (server.ts, middleware.ts) can
// talk to the self-hosted Supabase stack directly. Those two different URLs
// would otherwise produce two DIFFERENT cookie names — meaning a real,
// successful sign-in's cookie is invisible to the server-side check,
// causing an infinite redirect back to /login even with valid credentials.
// Pinning one fixed name here and passing it to every client (browser AND
// server) keeps them in sync regardless of which URL each one uses.
export const AUTH_COOKIE_NAME = "sb-teamchat-auth-token";