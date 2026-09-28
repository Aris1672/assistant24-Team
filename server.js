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
