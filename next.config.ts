import type { NextConfig } from "next";

// The self-hosted Supabase stack only serves plain HTTP
// (http://77.222.47.140:8006). Once this app is served over HTTPS at its
// own domain, a browser calling that http:// URL directly gets silently
// blocked as mixed content (auth, realtime, and file upload/download all
// call Supabase directly from the browser). This proxies those calls
// through the app's own same-origin HTTPS path instead: the browser only
// ever talks to https://<this-domain>/supabase/*, and this Node server
// makes the plain-HTTP hop to the real Supabase host itself, where
// mixed-content rules don't apply. Works for REST/Auth/Storage and for the
// Realtime websocket (Next's rewrites proxy the upgrade too in this
// self-hosted `next start` runtime).
const SUPABASE_UPSTREAM = "http://77.222.47.140:8006";

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server build (server.js + only the
  // node_modules it actually needs) — makes the Docker image much smaller
  // and the container start faster on Coolify.
  output: "standalone",

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
