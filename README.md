# TeamChat

A team messaging + file-sharing web app: direct messages, group channels, file
attachments, avatars, in-app + push notifications, a mobile-responsive layout,
and a language switcher (English/Russian). Installable as a PWA. Built with
Next.js (App Router) and self-hosted Supabase (Postgres + Auth + Storage +
Realtime), deployed on self-hosted Coolify.

**Status: live in production** at https://team.assistant24info.ru — sign-up,
sign-in, messaging, file sharing (including large multi-megabyte
attachments — see gotcha #12), avatar upload, Web Push notifications,
mobile layout, dark theme, and the language switcher all verified working
end-to-end in a real browser as of 2026-10-02.

---

## Live deployment reference

This section is the source of truth for where everything actually runs.
Keep it updated as things change — this is what a future session needs to
pick up maintenance without re-discovering all of this from scratch.

### Infra (per the "Self-Host Migration — Master Reference" playbook)

- **App hosting:** Coolify on `assistant_vps_4` (`168.222.202.222`)
- **Database:** self-hosted Supabase **Stack 7** on `assistant_vps_3`
  (`77.222.47.140`) — one dedicated stack, single-tenant (internal team tool,
  no multi-client RLS tenancy needed)
  - Studio/API gateway port: **8006**
  - Postgres port: **5438**
  - Transaction pooler port: **6549**
  - Kong HTTPS port: **8449**
  - Stack location on disk: `~/supabase-teamchat/docker` on `assistant_vps_3`
  - Docker Compose project name: `teamchat` (containers prefixed
    `teamchat-supabase-*`, plus `teamchat-realtime-dev.supabase-realtime`)
  - Studio URL: `http://77.222.47.140:8006` — dashboard username is
    `supabase`; password is in that stack's `.env` (`DASHBOARD_PASSWORD`) —
    not duplicated here, see that file on the VPS.
  - `ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET`/`POSTGRES_PASSWORD` all live in
    `~/supabase-teamchat/docker/.env` on `assistant_vps_3` — see that file
    directly rather than looking for them here.
  - **`ENABLE_EMAIL_AUTOCONFIRM=true`** was explicitly set (default is
    `false`) — this stack has no SMTP configured (self-hosted Supabase never
    does by default), so email-confirmation-required signup would otherwise
    fail with "Error sending confirmation email". Since this is an internal
    team tool, auto-confirming email on signup is the right tradeoff over
    standing up SMTP.
  - Port allocation ledger note: **Stack 6 was already in use** by another
    app when this was set up, so TeamChat took the next slot, **Stack 7**.
    Update the master migration reference doc's port ledger table if it
    hasn't been updated there yet.
- **GitHub repo:** https://github.com/Aris1672/assistant24-Team (branch `main`)
- **GitHub App / Coolify source integration:** the app named "Aris1672" under
  Settings → GitHub Apps (self-authored, `http://168.222.202.222:8000`) is
  Coolify's integration — this is what the playbook calls "My-Git-Hub".
  Repository access is set to "All repositories", so no per-repo action was
  needed there.
- **Domain:** `team.assistant24info.ru` (+ `www` variant), DNS A record →
  `168.222.202.222`
- **HTTPS pattern: Pattern B** — Traefik terminates HTTPS directly via
  Let's Encrypt, no Kazakhstan proxy involved (TeamChat doesn't call
  Anthropic's API, so there's no reason to route through
  `audit.assistant24info.ru`). "Redirect HTTP to HTTPS" is **Enabled**.
- **Coolify app build pack:** Dockerfile (explicit) — this repo is a real
  Next.js app, not a Vercel-serverless `api/*.js` shape. It now runs via a
  custom `server.js` instead of plain `next start`/`npm start`, needed for
  the Realtime WebSocket proxy — see gotcha #9 below.
- **Internal port:** `3000`

### Environment variables (set in Coolify, Production + Preview)

| Variable | Value | Build Variable? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://team.assistant24info.ru/supabase` | Yes (must be, see below) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Stack 7's `ANON_KEY` | Yes (must be) |
| `SUPABASE_URL` | `http://77.222.47.140:8006` | No (runtime only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Stack 7's `SERVICE_ROLE_KEY` | No (runtime only — currently also ticked as Buildtime in Coolify, which is harmless but unnecessary; fine to untick) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | see "Push notifications" below | Yes (must be) |
| `VAPID_PUBLIC_KEY` | same value as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No (runtime only, read by `server.js`) |
| `VAPID_PRIVATE_KEY` | see "Push notifications" below | No (runtime only, secret) |
| `VAPID_SUBJECT` | `mailto:eskarpini.sales@gmail.com` (or any contact address) | No (runtime only) |

---

## Architecture decisions and hard-won gotchas

These are specific to this app's deployment and go beyond what the general
migration playbook covers — worth reading before touching auth or the
Supabase connection again.

### 1. Browser vs. server Supabase URLs are intentionally different

The self-hosted Supabase stack only serves plain HTTP
(`http://77.222.47.140:8006`). Once the app itself is served over HTTPS at
its own domain, a **browser** calling that `http://` URL directly gets
silently blocked as mixed content (no visible error — just requests that
hang forever). Sign-in, realtime, and file upload/download all call
Supabase **directly from the browser** via `@supabase/supabase-js`, so this
would have broken all of them.

**Fix implemented:** `next.config.ts` has a `rewrites()` rule proxying
`/supabase/:path*` to the real Supabase host. The browser is configured
with `NEXT_PUBLIC_SUPABASE_URL=https://team.assistant24info.ru/supabase`
(same-origin, HTTPS) and never sees the raw IP. Server-side code
(`server.ts`, `middleware.ts`, `admin.ts`) uses a separate `SUPABASE_URL`
env var to hit Supabase directly, since mixed-content rules don't apply to
server-to-server calls.

### 2. The auth middleware must exclude the `/supabase/*` proxy path

`src/middleware.ts`'s matcher explicitly excludes `supabase/` in addition to
the usual static-asset exclusions. Without this, the login-redirect logic
intercepted the browser's proxied Supabase API calls (e.g. the signup POST
request) and redirected them to `/login`, which returned a "Method Not
Allowed" response the Supabase client tried and failed to parse as JSON.
**If you ever see a "Method Not Allowed"/"is not valid JSON" error from any
Supabase call, check this matcher first.**

### 3. Browser and server Supabase clients need the SAME auth cookie name

`@supabase/ssr` derives the auth session's cookie name from the Supabase URL
you pass to `createBrowserClient`/`createServerClient` (roughly
`sb-<host-derived-ref>-auth-token`). Because the browser and server
intentionally use **different URLs** (see #1), they would otherwise compute
**different cookie names** — meaning a genuinely successful sign-in's cookie
is invisible to server-side session checks, causing an infinite redirect
back to `/login` even with correct credentials and a 200 response from the
token endpoint.

**Fix implemented:** `src/lib/supabase/cookie-name.ts` exports a single
fixed `AUTH_COOKIE_NAME` constant, passed as `cookieOptions: { name: ... }`
to **every** `createBrowserClient`/`createServerClient` call (`client.ts`,
`server.ts`, `middleware.ts`). **If you ever add a new place that creates a
Supabase server/browser client for auth purposes, it must also pass this
same `cookieOptions`,** or the session-recognition bug will resurface.

### 4. Docker build uses `npm install`, not `npm ci`

The committed `package-lock.json` can drift from `package.json` when
`npm install` is run locally on a different OS/npm version than whatever
generated the lockfile (this happened here — Windows-side `npm install`
picked up different platform-specific optional dependencies, e.g.
`@emnapi/*` packages used by native addons like `lightningcss`). `npm ci`
refuses to install at all when the lockfile doesn't exactly match;
`npm install` reconciles the drift instead. The Dockerfile's `deps` stage
uses `npm install` deliberately for this reason.

### 5. `git push` can silently no-op — always verify

Multiple deploy-debugging cycles during this app's setup traced back to the
same root cause: the local repo's `main` branch had no upstream tracking
configured (`git push` alone would fail with "no upstream branch", or in
one case a `git remote` had gone missing entirely), so commits were made
locally but never reached GitHub — Coolify kept redeploying a stale commit.
**After any `git push`, verify with `git log origin/main --oneline -3`** (or
check the commit SHA in Coolify's deployment log) that what you think you
pushed actually landed, rather than assuming success.

### 6. Coolify auto-deploy via GitHub App webhook

Coolify's GitHub integration is a **GitHub App** (not a classic per-repo
webhook) — the repo's own Settings → Webhooks page will always show empty,
that's normal. The real webhook lives on the GitHub App's own settings
(`github.com/settings/apps/<app>/hook_config`, owned by the account that
created it), pointed at
`http://168.222.202.222:8000/webhooks/source/github/events`. This was
confirmed correctly configured and working — auto-deploy fires on every
push to `main` once pushes actually land (see #5).

### 7. Mobile layout is a single-panel "app shell", not a squeezed sidebar

Below the `md` Tailwind breakpoint, `AppShell.tsx` shows either the
conversation list (`Sidebar.tsx`) or the open chat (`ChatView.tsx`), never
both side-by-side — driven by `usePathname()` checking for `/channel/*`.
`ChatView.tsx`'s header has a back arrow (`← ` link to `/`, hidden at `md`
and above) to return to the conversation list. At `md` and above both
panels show side-by-side as before. If a new top-level authenticated view
is ever added, it needs the same `isChannelOpen`-style pattern or it will
render squeezed on phones.

### 8. Mobile browsers can override an intentionally dark theme

A phone screenshot showed a white background instead of the app's dark
theme, even though every element had a dark Tailwind class. Root cause:
some mobile browsers apply their own forced dark/light-mode heuristics to
pages that don't explicitly declare their color scheme, and can override
*inherited* (not explicitly per-element) background colors on generic
container `div`s.

**Fix implemented:** `src/app/layout.tsx` exports `viewport = { colorScheme:
"dark", themeColor: "#0a0a0a" }`, and `bg-neutral-950` is set explicitly (not
just inherited) on `<html>`, `<body>`, `AppShell.tsx`'s outer wrapper and
`<main>`, and `ChatView.tsx`'s root container. **If a new top-level
container is ever added, give it an explicit `bg-neutral-950` too** rather
than relying on inheritance, to avoid this resurfacing on some devices.

### 9. Realtime WebSocket needs a custom server + a Docker network alias fix

New messages initially only appeared after a manual page refresh — the
Supabase Realtime subscription (`ChatView.tsx`, `Sidebar.tsx`) never actually
delivered live events. This had **two separate causes**, both now fixed:

**a) Next.js `rewrites()` cannot proxy WebSocket upgrades.** The `/supabase/*`
rewrite in `next.config.ts` only forwards ordinary HTTP request/response
calls (REST/Auth/Storage) — it silently does not forward the `Upgrade:
websocket` handshake Realtime needs, so the connection never even attempted
to reach Supabase. **Fix:** `server.js` is a custom server (replacing plain
`next start`) that listens for the raw HTTP `upgrade` event and proxies
`/supabase/realtime/*` directly to the Supabase host using `http-proxy`,
stripping the `/supabase` prefix so Envoy/Kong sees the path it expects
(`/realtime/v1/websocket`). Because of this custom server, `output:
"standalone"` was removed from `next.config.ts` (a standalone build's
generated `server.js` can't easily be extended with a custom `upgrade`
handler) — the Docker image ships full `node_modules` instead, which is a
non-issue for an internal tool. **`npm start` now runs `node server.js`, not
`next start`.**

**b) Stack 7's Realtime container wasn't reachable by its expected internal
DNS name.** Even after (a) was fixed, the self-hosted stack's `envoy`
gateway returned `503 no healthy upstream` for every Realtime request. Cause:
Envoy's static config (`/etc/envoy/cds.yaml` inside the `teamchat-supabase-envoy`
container) hardcodes the Realtime upstream's hostname as
`realtime-dev.supabase-realtime` — but that container was renamed to
`teamchat-realtime-dev.supabase-realtime` per this stack's container-naming
convention, so Docker's internal DNS no longer resolved the name Envoy was
looking for. Every other renamed service happened not to hit this same
DNS-based health check, which is why only Realtime broke. **Fix:** added a
Docker network alias so the container answers to both names — in
`~/supabase-teamchat/docker/docker-compose.yml`, the `realtime:` service now
has:
```yaml
    networks:
      default:
        aliases:
          - realtime-dev.supabase-realtime
```
This is permanent (survives `docker compose up -d`/restarts). **If any other
self-hosted Supabase container is ever renamed away from its stock name,
check whether Envoy's `cds.yaml` hardcodes that name too — the same
`no healthy upstream` symptom will recur for that service.** Diagnose with:
```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://<supabase-host>:<port>/realtime/v1/websocket?apikey=<ANON_KEY>&vsn=2.0.0"
```
run directly on the Supabase VPS — `101 Switching Protocols` means Realtime
itself is fine; `503 no healthy upstream` points at this DNS/alias issue.

### 10. Language switcher is a lightweight custom context, not a library

The app's text surface is small, so i18n is a hand-rolled
`LanguageProvider` (`src/lib/i18n/`) rather than a full library like
`next-intl`. `translations.ts` holds an `en`/`ru` dictionary keyed by
string constants; `LanguageProvider.tsx` exposes `locale`, `setLocale`, and
`t(key)` via React context, persists the choice to `localStorage`, and
falls back to detecting Russian from the browser's language on first visit
(`navigator.language`). The provider always renders `en` on the very first
render (both server and client) to avoid a hydration mismatch, then syncs
to the real preference immediately after mount — so there can be a
one-frame flash of English before the persisted/detected locale applies.
**Any new user-visible string must be added to both `en` and `ru` in
`translations.ts` and read via `useLanguage().t("key")`, or it will render
in English regardless of the selected language.** The switcher itself
(`LanguageSwitcher.tsx`) is a plain `<select>` and appears in the sidebar
header (for signed-in users) and on the login/signup pages.

### 11. File uploads use a random storage key, never the original file name

`@supabase/storage-js` builds its upload URL by plain string concatenation
(`_getFinalPath` in its source) — no `encodeURIComponent` anywhere. Combined
with this app's own `/supabase` proxy and the self-hosted stack's Envoy
gateway in front of storage-api, a file name with non-ASCII characters
(Cyrillic, etc.) or characters like spaces, `#`, `%`, `+`, parentheses
could silently fail to upload somewhere in that chain, even though
plain-ASCII names worked fine — confirmed in production with a
Cyrillic-named PDF that wouldn't attach.

**Fix implemented:** `src/lib/storage.ts`'s `safeStorageKey()` generates a
random ASCII-only id (+ a sanitized extension, or none if the extension
itself looks unsafe) used as the actual Storage object key, for both
message attachments (`ChatView.tsx`) and avatars (`AvatarUpload.tsx`, which
already used a fixed `avatar.<ext>` key but now sanitizes `<ext>` too). The
real, human-readable file name is unaffected — it's stored separately in
`attachments.file_name` / shown from that column, never used as the storage
key. **Any future code that uploads to Storage should go through
`safeStorageKey()` rather than using `file.name` directly, or this will
resurface.**

### 12. Large file uploads hang forever — it's Next's rewrite proxy, not a size/timeout limit

After #11 was fixed, uploading anything around ~10MB+ (a couple of zip
files, specifically) still didn't work — but differently: no error, the
upload request just sat at "pending" in the browser's Network tab
forever, 0 bytes transferred, never resolving. That symptom (hangs, rather
than a clean error) ruled out the things that usually explain "big files
fail": a `413`, a clean timeout response, a file-size-limit rejection.
Checked and ruled out, in order: `storage-api`'s `FILE_SIZE_LIMIT` (50MB,
nowhere close), and the self-hosted stack's Envoy gateway (this stack uses
**Envoy, not Kong**, despite what gotcha #11 used to say — see
`/etc/envoy/lds.yaml` inside the `teamchat-supabase-envoy` container). The
`/storage/v1/` route's Envoy timeout was raised from 30s to 300s as a
precaution (see below) but didn't fix it either — the request wasn't
timing out, it was never actually reaching Envoy with any real progress.

**Root cause:** Next.js's `rewrites()` mechanism for proxying to an
external URL (used for ordinary `/supabase/*` HTTP calls — see gotcha #1)
doesn't stream large request bodies cleanly; it stalls instead of
forwarding them. Small files/payloads never hit this because they're
proxied near-instantly either way.

**Fix implemented:** `server.js` (which already ran a proper streaming
reverse proxy via `http-proxy` for the Realtime WebSocket upgrade — see
gotcha #9) now intercepts **every** `/supabase/*` HTTP request too, before
Next's own request handler ever sees it, and proxies it with `http-proxy`
instead. `next.config.ts`'s `rewrites()` block is accordingly dead code in
production now — but it's kept and documented as such, because `next dev`
(local development) doesn't go through `server.js` at all and still needs
it. The proxy has a 10-minute timeout (generous for a slow large upload,
but finite — a genuinely dead upstream still eventually frees its socket)
and a proper error handler that returns a clean `502` instead of leaving
the browser hanging on a different kind of failure.

**Incidental change also made on the Supabase side, harmless to leave in
place:** `assistant_vps_3`'s `~/supabase-teamchat/docker/volumes/api/envoy/lds.template.yaml`
had the `/storage/v1/` route's `timeout` raised from `30s` to `300s`
(requires `docker compose restart api-gw` — that's the Compose *service*
name; the container itself is `teamchat-supabase-envoy` — to regenerate
`lds.yaml` from the template and apply it). This turned out not to be the
actual fix, but a more generous timeout on that route is still reasonable
for file uploads and doesn't hurt anything else.

---

## Database schema

`supabase/migrations/0001_init.sql` — already applied to Stack 7. Creates:

- `profiles` — one row per user, auto-populated via an `on_auth_user_created`
  trigger on signup
- `channels` / `channel_members` — group channels and 1:1 DMs
- `messages` — chat messages
- `attachments` — file metadata, backed by a private `attachments` Storage
  bucket (`public = false`, access via signed URLs only)
- Row Level Security policies scoping all of the above to channel membership
  (`is_channel_member()` helper function)
- `messages`, `attachments`, `channel_members` added to the
  `supabase_realtime` publication for live updates

`supabase/migrations/0002_avatars.sql` — **not yet applied to Stack 7, run
it before deploying the avatar-upload feature.** Adds a public `avatars`
Storage bucket (`public = true`, unlike `attachments` — avatars are small
and non-sensitive, so a plain `getPublicUrl()` is used instead of signed
URLs) with RLS scoping uploads/updates/deletes to `${user_id}/*` via the
object-path convention. `profiles.avatar_url` already existed in
`0001_init.sql` and is just populated once a user uploads a photo.

To apply or inspect either migration: Supabase Studio
(`http://77.222.47.140:8006`) → SQL Editor, or
`psql`/`docker exec teamchat-supabase-db psql -U postgres -d postgres`
directly on `assistant_vps_3`.

If the schema ever needs to change, add a new numbered migration file
(`0003_...sql`) rather than editing an existing one in place, and apply it
the same way.

### Changing a user's password directly (no email flow needed)

Since there's no SMTP/password-reset-email flow configured, an admin can
reset any user's password directly via Supabase Studio's SQL Editor
(`pgcrypto`'s `crypt()`/`gen_salt('bf')`, matching how GoTrue hashes
passwords):

```sql
update auth.users
set encrypted_password = crypt('the-new-password', gen_salt('bf'))
where email = 'person@example.com';
```

### Deleting a user account (no in-app UI for this yet)

There's no self-service "delete my account" button — an admin does it from
Supabase Studio's SQL Editor. **`profiles` cascades from `auth.users`, but
`messages.sender_id`, `attachments.uploader_id`, and `channels.created_by`
do not cascade from `profiles`** — deleting a user who's ever sent a
message, uploaded a file, or created a channel will fail with a
foreign-key violation unless those are cleared first. Two options:

- **Disable login, keep their message history for everyone else**
  (recommended for a team tool — this is the non-destructive option):
  ```sql
  update auth.users set banned_until = 'infinity' where email = 'person@example.com';
  -- optional: stop showing their real name on old messages
  update public.profiles set display_name = 'Former teammate', avatar_url = null
    where email = 'person@example.com';
  ```
- **Full erasure** (deletes their messages/attachments too — only do this if
  that's actually wanted, e.g. a GDPR-style request):
  ```sql
  do $$
  declare
    target_id uuid;
  begin
    select id into target_id from auth.users where email = 'person@example.com';
    if target_id is null then
      raise notice 'No user found with that email.';
      return;
    end if;

    delete from public.attachments where uploader_id = target_id;
    delete from public.messages where sender_id = target_id;
    delete from public.channels where created_by = target_id and is_dm = false;
    -- channels.created_by is nullable — null it instead of deleting DM
    -- channels, or the other member loses their side of the conversation too.
    update public.channels set created_by = null where created_by = target_id;
    -- Cascades: the profiles row and any remaining channel_members rows.
    delete from auth.users where id = target_id;

    raise notice 'Deleted user %', target_id;
  end $$;
  ```
  This doesn't delete their uploaded files from the `attachments`/`avatars`
  Storage buckets (orphaned objects, harmless) — remove those manually in
  Studio → Storage if it matters. It also leaves behind any DM channel
  where the *other* member never sent a message either — after a full
  erasure, run this once to clean up any now-empty DM shells:
  ```sql
  delete from public.channels
  where is_dm = true
  and id in (
    select channel_id from public.channel_members
    group by channel_id
    having count(*) = 1
  );
  ```

---

## Local development

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with either Stack 7's real values (see above) or a
# local/dev Supabase instance. For local dev over plain HTTP, pointing
# NEXT_PUBLIC_SUPABASE_URL straight at the raw Supabase URL is fine — the
# mixed-content proxy trick is only needed once served over HTTPS.
npm run dev
```

## Deploying changes

This app auto-deploys on push to `main` (Coolify webhook, see gotcha #6
above). Standard flow:

```bash
git add -A
git commit -m "..."
git push
# Verify it actually landed:
git log origin/main --oneline -3
```

Then check the deployment in Coolify to confirm it built the new commit SHA
(not a stale one) and succeeded. If `NEXT_PUBLIC_*` env vars ever change,
they must stay ticked as **Build Variables** in Coolify or the new values
won't reach the browser bundle (see the env var table above).

---

## How the code is organized

```
src/
  app/
    layout.tsx              — root layout: dark theme, wraps app in LanguageProvider
    login/, signup/         — auth pages (localized, include the language switcher)
    auth/callback/          — email-confirmation redirect handler
    (app)/                  — authenticated app shell
      layout.tsx            — loads current user + renders AppShell
      page.tsx              — empty state ("select a conversation")
      channel/[id]/         — a channel or DM thread
    api/new-dm/             — creates/reuses a 1:1 DM channel
    api/new-channel/        — creates a group channel
  components/
    AppShell.tsx            — mobile-responsive shell: sidebar OR chat, never both on phones
    Sidebar.tsx             — conversation list, unread badges, new-chat modal, language switcher
    ChatView.tsx            — message list, composer (arrow-icon send button), realtime subscription
    AttachmentLink.tsx      — signed download links for private files
    NewChatModal.tsx        — pick teammates to start a DM or group
    LanguageSwitcher.tsx    — EN/RU dropdown, used in Sidebar + login/signup pages
    Avatar.tsx               — round avatar: shows the uploaded photo, or colored initials if none
    AvatarUpload.tsx         — click-to-upload wrapper around Avatar (used in Sidebar's own-profile row)
    PushNotifications.tsx    — "Enable notifications" banner + subscribe flow (see Push notifications below)
    CircuitBackground.tsx    — animated chat-window background (see Circuit-board background below)
  lib/supabase/
    client.ts               — browser Supabase client (proxied URL)
    server.ts               — server-component Supabase client (direct URL)
    middleware.ts           — session-refresh/auth-redirect Supabase client
    admin.ts                — service_role client (bypasses RLS, server-only)
    cookie-name.ts          — shared AUTH_COOKIE_NAME (see gotcha #3)
  lib/i18n/
    translations.ts         — en/ru string dictionary (see gotcha #9)
    LanguageProvider.tsx    — context provider: locale, setLocale, t()
  lib/storage.ts            — safeStorageKey(): ASCII-only Storage object keys (see gotcha #11)
  lib/push.ts                — Web Push client helpers (VAPID key decoding, feature detection)
supabase/migrations/
  0001_init.sql            — full schema, RLS policies, attachments storage bucket
  0002_avatars.sql         — public avatars storage bucket + RLS (see Database schema above)
  0003_push_subscriptions.sql — Web Push subscriptions table + RLS (see Push notifications below)
public/
  manifest.webmanifest     — PWA manifest (Add to Home Screen), icon-*.png — see Push notifications
  sw.js                    — service worker: only handles push/notificationclick, no offline caching
server.js                  — custom Node server: proxies ALL /supabase/* HTTP + the Realtime WebSocket
                              upgrade (see gotchas #9 and #12), and runs the push-notification sender
Dockerfile                 — multi-stage build; ships full node_modules (no `output: "standalone"`, see gotcha #9)
next.config.ts             — the /supabase proxy rewrite; dead code in production, kept for `next dev` (gotcha #12)
```

## Notes on notifications

Ships **in-app** notifications (unread badges + a toast for messages in a
channel you're not currently viewing, via Supabase Realtime) and **Web
Push** notifications (see below) that arrive even when the app/tab is
closed, as long as it's been installed/granted at least once. Email
notifications aren't wired up — that would additionally need real SMTP
configured on the Supabase stack, which doesn't exist yet (see the
`ENABLE_EMAIL_AUTOCONFIRM` note above).

## Avatars

Users can set a profile photo by clicking their own avatar in the sidebar
header (top-left, next to the app name). Implementation:

- **Storage:** a public `avatars` Storage bucket (`supabase/migrations/0002_avatars.sql`,
  **must be applied to Stack 7 before this ships** — see Database schema
  above). Files are stored at `${user_id}/avatar.${ext}` and uploaded with
  `upsert: true`, so re-uploading overwrites the previous photo instead of
  accumulating orphaned files. RLS restricts insert/update/delete to the
  path's own `user_id` folder; select is public (avatars need to render for
  every teammate without minting a signed URL per image).
- **Client flow:** `AvatarUpload.tsx` uploads the file, calls
  `getPublicUrl()`, appends a `?v=<timestamp>` cache-busting query param, and
  writes the result straight to `profiles.avatar_url` — no server route
  needed, same pattern as the existing attachment upload in `ChatView.tsx`.
- **Display:** `Avatar.tsx` renders the photo if `avatar_url` is set, else a
  colored circle with the user's initials (color derived deterministically
  from their name, so it's stable across sessions). Used in the sidebar
  header, the conversation list, the new-chat picker, and next to incoming
  message bubbles in `ChatView.tsx`.
- Accepts PNG/JPEG/WebP/GIF, 5MB max, validated client-side before upload.

## Circuit-board background

The message area of `ChatView.tsx` has an animated "AI chip" circuit board
behind the bubbles (`CircuitBackground.tsx`): a glowing chip on the left with
thin circuit traces fanning out (28 on desktop, 13 on phones), each ending in
a glowing dot. Light pulses run along the traces at random — out from the
chip, or in from an end dot — and often turn round at the end and come back
("forth and back"); the end dot flashes when a pulse arrives, the chip when
one comes home. Sending a message fires a burst of pulses out from the chip;
receiving one fires a burst in towards it
(`meshRef.current?.pulse("right" | "left")`, called from `handleSend` and the
Realtime INSERT handler). It's a plain `<canvas>` — no library.

The artwork is drawn from code, not an image, so each trace is its own path a
pulse can follow and it stays sharp at any size. The layout comes from a fixed
random seed (`mulberry32(20261005)` in `buildTraces()`), so it looks the same
on every device and reload; change the seed for a different board. The static
artwork (chip + traces) is drawn once into an offscreen canvas on resize;
each frame only blits that and draws the few moving pulses.

It's built to cost almost nothing on a phone, since the app is used all day
as an installed PWA:

- **Hidden = stopped.** Drawing stops on `visibilitychange` → hidden (another
  app in front, screen off) and resumes when visible again.
- **Idle = frozen.** After 25 s with no touch/scroll/key/message no new pulses
  are spawned; once the last one finishes, drawing stops and the final frame
  stays on screen. Any interaction or message wakes it.
- **~30 fps cap**, max 9 pulses at once (5 on phones).
- **`prefers-reduced-motion`:** static artwork only, no pulses.

Tuning knobs: `IDLE_MS`, `FRAME_MS`, `MAX_BOUNCES`, `TAIL_PX` at the top of
`CircuitBackground.tsx`; trace counts per chip side and segment lengths in
`buildTraces()`; pulse speed and spawn rate in `spawnAmbient()` / `step()`;
trace/dot opacity in `drawBase()`. Keep an explicit background
(`bg-neutral-950`) on the wrapper in `ChatView` (see gotcha #8).

## Push notifications

Standard Web Push (VAPID), works for the site installed as a PWA on Android
(the "Add to Home Screen" shortcut the user already had) as well as in a
normal desktop browser tab. iOS Safari also supports this, but only once
the site is added to the Home Screen there — Safari does not allow web push
from an ordinary browser tab.

**One-time setup — already done on Stack 7 as of 2026-09-28 (migration
applied, VAPID env vars set in Coolify, redeployed, and verified working end
to end). Kept here for reference / if this ever needs to be re-run on a
fresh stack:**

1. Apply `supabase/migrations/0003_push_subscriptions.sql` (Studio → SQL
   Editor, same as the other migrations).
2. Generate a VAPID key pair once (`npx web-push generate-vapid-keys`, or
   `node -e "console.log(require('web-push').generateVAPIDKeys())"` from the
   repo, which already has `web-push` installed).
3. In Coolify, set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (**tick Build Variable**),
   `VAPID_PUBLIC_KEY` (same value, but do *not* tick Build Variable — it's
   only read server-side by `server.js`), `VAPID_PRIVATE_KEY` (secret,
   runtime only), and `VAPID_SUBJECT` (a `mailto:` contact address — some
   push services reject requests without one). See the env var table above.
4. Redeploy so the new Build Variable gets inlined into the browser bundle.

**How it works:**

- **Subscribing:** `PushNotifications.tsx` (rendered in the sidebar) shows
  an "Enable notifications" banner when `Notification.permission` is still
  `"default"` — permission can only be requested from a real click, so this
  can't happen silently on load. On click (or automatically on future
  visits once permission is already `"granted"`) it registers `public/sw.js`,
  subscribes via `PushManager` using `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and
  POSTs the subscription to `/api/push/subscribe`, which upserts it into
  `push_subscriptions` (RLS-scoped to the signed-in user; unique on
  `endpoint` so re-subscribing just refreshes the row).
- **Sending:** unlike everything else in this app, sending can't be
  triggered by RLS-scoped browser code — it has to run server-side and see
  every recipient's subscription rows. Rather than add a Postgres trigger
  (would need the `pg_net` extension) or a separate always-on worker,
  `server.js` — which is already the one long-lived Node process in this
  app (see gotcha #9) — opens a *second* Realtime subscription, this time
  with the service_role key, listening for `INSERT` on `messages`. On each
  new message it looks up the other channel members, their
  `push_subscriptions` rows, and calls `web-push`'s `sendNotification()` for
  each. A `404`/`410` response (subscription expired/revoked) deletes that
  row so future messages stop retrying it.
- **Receiving:** `public/sw.js` is a minimal service worker — it only
  handles the `push` event (shows a notification) and `notificationclick`
  (focuses an existing tab on that channel, or opens one). It does *not* do
  offline asset caching, so there's no cache-invalidation complexity to
  worry about on deploys.
- Every message currently notifies every other channel member's every
  registered device — there's no per-channel mute or "only when I'm not
  viewing it" suppression yet (that would need the server-side sender to
  know each recipient's currently-open channel, which it doesn't track).

## Possible next steps (not yet done)

- Message editing/deletion UI (the DB schema and RLS policies already
  support it — `edited_at` column, update/delete policies scoped to the
  sender — just no UI wired up yet)
- Channel renaming, leaving a channel, removing members
- Per-channel notification mute / "don't notify while viewing" suppression
- Message search
- More languages, if needed (add a new key to `translations.ts` and an
  option in `LanguageSwitcher.tsx`)
