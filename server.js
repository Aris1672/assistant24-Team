// Custom server, used instead of plain `next start`.
//
// Why this exists: originally just the WebSocket piece below (Next.js's
// rewrites() forwards ordinary HTTP calls to the self-hosted Supabase stack
// fine, but can't forward a WebSocket "Upgrade" handshake, which Realtime
// needs). It has since taken over *all* /supabase/* HTTP traffic too (see
// below) because Next's rewrite-to-external-URL mechanism turned out to
// stall/hang on large request bodies rather than cleanly erroring or timing
// out — confirmed in production with multi-megabyte file attachment
// uploads that just sat at "pending" in the browser forever. `http-proxy`
// (already a dependency, for the WS case) is a proper streaming proxy and
// doesn't have that problem, so every /supabase/* request — HTTP or
// WebSocket — now goes through it directly, and next.config.ts's rewrites()
// for this path is dead code kept only as a documented fallback.
//
// This server does three things:
//   1. For any request whose path starts with /supabase/, proxies it
//      directly to the Supabase stack via http-proxy (stripping the
//      /supabase prefix), streaming the body both ways instead of letting
//      Next.js's own rewrite handling anywhere near it.
//   2. Runs the normal Next.js request handler for everything else (pages,
//      API routes, static assets).
//   3. Listens for raw HTTP `upgrade` events and, for paths starting with
//      /supabase/realtime, proxies the WebSocket connection the same way
//      (Next's rewrites() never even attempts to forward these).
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const httpProxy = require("http-proxy");
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");

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
  // No short ceiling on how long a single proxied request/response may
  // take — large uploads over a slow hop can legitimately run for a
  // while — but not literally infinite either, so a truly hung upstream
  // connection still eventually frees its socket instead of leaking it.
  proxyTimeout: 10 * 60 * 1000, // 10 minutes
  timeout: 10 * 60 * 1000,
});

proxy.on("error", (err, req, res) => {
  console.error("[supabase-proxy] error:", err.message);
  // Without this, a proxy-level error (upstream unreachable, etc.) on an
  // ordinary HTTP request leaves the browser's fetch/XHR hanging forever
  // instead of getting a response — the same "stuck at pending" symptom
  // this whole rewrite was replaced to fix, just from a different cause.
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad gateway (Supabase proxy)");
  }
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url && req.url.startsWith("/supabase/")) {
      // Strip the same-origin proxy prefix so Supabase's gateway sees the
      // path it actually expects (e.g. /storage/v1/object/...).
      req.url = req.url.replace(/^\/supabase/, "");
      proxy.web(req, res);
      return;
    }
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.on("upgrade", (req, socket, head) => {
    // Temporary diagnostic logging: prints every upgrade request the
    // container actually receives, and whether it matched. If NOTHING logs
    // here when testing from a browser, the request is being dropped
    // upstream (Traefik/Coolify) and never reaches this Node process at all.
    // Log the path only: the query string carries the apikey, which has no
    // business sitting in log files.
    const logPath = (req.url || "").split("?")[0];
    console.log("[realtime-proxy] upgrade request received, path:", logPath);

    if (req.url && req.url.startsWith("/supabase/realtime")) {
      // Strip the same-origin proxy prefix so Supabase's Kong gateway sees
      // the path it actually expects (e.g. /realtime/v1/websocket).
      req.url = req.url.replace(/^\/supabase/, "");
      console.log("[realtime-proxy] proxying to upstream as:", req.url.split("?")[0]);
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

  startPushNotifier();
});

// --- Web Push: notify channel members of new messages -------------------
//
// This runs *inside* the same long-lived Node process that already proxies
// the Realtime WebSocket above (see the file header), rather than as a
// Postgres trigger or a separate worker: server.js is already the one part
// of this app that stays running continuously, has a direct server-to-server
// connection to Supabase (no mixed-content restriction — see gotcha #1), and
// already depends on Realtime being reachable. Adding a second Realtime
// subscription here (this time using the service_role key, so it isn't
// scoped to any one browser session) avoids introducing a whole extra
// deployable just to send push notifications.
//
// Requires SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, and the three VAPID_*
// env vars (see README's "Push notifications" section for how to generate
// them). If any are missing, this logs once and does nothing further —
// the rest of the app works fine without push notifications configured.
function startPushNotifier() {
  const SUPABASE_URL = process.env.SUPABASE_URL || SUPABASE_UPSTREAM;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

  if (!SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.log(
      "[push] SUPABASE_SERVICE_ROLE_KEY / VAPID_* env vars not fully set — push notifications disabled."
    );
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  admin
    .channel("push-notifier")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => notifyChannelMembers(admin, payload.new).catch((err) => {
        console.error("[push] failed to notify for message", payload.new?.id, err);
      })
    )
    .subscribe((status) => {
      console.log("[push] realtime subscription status:", status);
    });
}

async function notifyChannelMembers(admin, message) {
  const [{ data: sender }, { data: members }, { data: channel }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", message.sender_id).single(),
    admin.from("channel_members").select("user_id").eq("channel_id", message.channel_id).neq("user_id", message.sender_id),
    admin.from("channels").select("name, is_dm").eq("id", message.channel_id).single(),
  ]);

  if (!members || members.length === 0) return;

  const senderName = sender?.display_name || "Someone";
  const title = channel && !channel.is_dm ? `#${channel.name}` : senderName;
  const body = message.body ? (channel && !channel.is_dm ? `${senderName}: ${message.body}` : message.body) : "📎 Sent a file";
  const url = `/channel/${message.channel_id}`;
  const payload = JSON.stringify({ title, body, url });

  const { data: subscriptions } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", members.map((m) => m.user_id));

  if (!subscriptions || subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        // 404/410 means the browser/OS has invalidated this subscription
        // (uninstalled, permission revoked, etc.) — clean it up so future
        // messages don't keep retrying a dead endpoint.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[push] sendNotification failed:", err.statusCode, err.body || err.message);
        }
      }
    })
  );
}
