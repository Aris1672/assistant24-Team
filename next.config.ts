import type { NextConfig } from "next";

// The self-hosted Supabase stack only serves plain HTTP
// (http://77.222.47.140:8006). Once this app is served over HTTPS at its
// own domain, a browser calling that http:// URL directly gets silently
// blocked as mixed content (auth, realtime, and file upload/download all
// call Supabase directly from the browser). This proxies those calls
// through the app's own same-origin HTTPS path instead: the browser only
// ever talks to https://<this-domain>/supabase/*, and this Node server
// makes the plain-HTTP hop to the real Supabase host itself, where
// mixed-content rules don't apply.
//
// IMPORTANT: this `rewrites()` block only proxies ordinary HTTP
// request/response calls (REST/Auth/Storage) — Next.js's built-in rewrite
// engine does NOT forward WebSocket "Upgrade" handshakes, so it silently
// cannot proxy the Supabase Realtime connection. That's handled instead by
// a small custom `server.js` (see that file) that intercepts the raw HTTP
// `upgrade` event for `/supabase/realtime/*` and proxies it directly to
// Supabase. Because of that custom server, `output: "standalone"` is NOT
// used here (a standalone build's generated server.js can't easily be
// extended with our own `upgrade` handler) — the Docker image instead
// ships full node_modules, which is fine for an internal tool.
const SUPABASE_UPSTREAM = "http://77.222.47.140:8006";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/supabase/:path*",
        destination: `${SUPABASE_UPSTREAM}/:path*`,
      },
    ];
  },
};

export default nextConfig;
