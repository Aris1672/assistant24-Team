// Custom server, used instead of plain `next start`.
//
// Why this exists: `next.config.ts`'s `rewrites()` proxies ordinary HTTP
// calls to the self-hosted Supabase stack, but Next.js's rewrite engine does
// not forward WebSocket "Upgrade" handshakes. Supabase Realtime is a
// WebSocket connection, so without this file, the browser's realtime
// subscription (used for live-updating messages) would either fail outright
// or silently never receive events — matching the exact symptom of new
// messages only appearing after a manual page refresh (which re-runs the
// server-side data fetch, but isn't "live").
//
// This server does two things:
//   1. Runs the normal Next.js request handler for everything (pages, API
//      routes, the /supabase/* HTTP rewrite, static assets).
//   2. Listens for raw HTTP `upgrade` events and, for paths starting with
//      /supabase/realtime, proxies the WebSocket connection directly to the
//      Supabase stack (stripping the `/supabase` prefix so Kong/Realtime see
//      the path they expect, e.g. /realtime/v1/websocket).
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const httpProxy = require("http-proxy");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Same upstream as the /supabase rewrite in next.config.ts. Kept as an env
// var too so it can be overridden without a rebuild if the Supabase stack
// ever moves.
const SUPABASE_UPSTREAM =
  process.env.SUPABASE_REALTIME_UPSTREAM || "http://77.222.47.140:8006";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({
  target: SUPABASE_UPSTREAM,
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err) => {
  console.error("[realtime-proxy] error:", err.message);
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req, socket, head) => {
    // Temporary diagnostic logging: prints every upgrade request the
    // container actually receives, and whether it matched. If NOTHING logs
    // here when testing from a browser, the request is being dropped
    // upstream (Traefik/Coolify) and never reaches this Node process at all.
    console.log("[realtime-proxy] upgrade request received, url:", req.url);

    if (req.url && req.url.startsWith("/supabase/realtime")) {
      // Strip the same-origin proxy prefix so Supabase's Kong gateway sees
      // the path it actually expects (e.g. /realtime/v1/websocket).
      req.url = req.url.replace(/^\/supabase/, "");
      console.log("[realtime-proxy] proxying to upstream as:", req.url);
      proxy.ws(req, socket, head);
    } else {
      console.log("[realtime-proxy] url did not match /supabase/realtime, destroying socket");
      socket.destroy();
    }
  });

  proxy.on("open", () => {
    console.log("[realtime-proxy] upstream websocket connection opened");
  });

  proxy.on("close", () => {
    console.log("[realtime-proxy] websocket connection closed");
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
