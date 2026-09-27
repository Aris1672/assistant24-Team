# TeamChat

A team messaging + file-sharing web app: direct messages, group channels, file
attachments, live in-app notifications, a mobile-responsive layout, and a
language switcher (English/Russian). Built with Next.js (App Router) and
self-hosted Supabase (Postgres + Auth + Storage + Realtime), deployed on
self-hosted Coolify.

**Status: live in production** at https://team.assistant24info.ru — sign-up,
sign-in, messaging, file sharing, mobile layout, dark theme, and the
language switcher all verified working end-to-end in a real browser as of
2026-09-27.

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
  Next.js app with its own `next start` entry point (not a Vercel-serverless
  `api/*.js` shape), so it needed only a standard Dockerfile, no
  `server.js` shim.
- **Internal port:** `3000`

### Environment variables (set in Coolify, Production + Preview)

| Variable | Value | Build Variable? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://team.assistant24info.ru/supabase` | Yes (must be, see below) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Stack 7's `ANON_KEY` | Yes (must be) |
| `SUPABASE_URL` | `http://77.222.47.140:8006` | No (runtime only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Stack 7's `SERVICE_ROLE_KEY` | No (runtime only — currently also ticked as Buildtime in Coolify, which is harmless but unnecessary; fine to untick) |

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

### 9. Language switcher is a lightweight custom context, not a library

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

To re-apply or inspect: Supabase Studio (`http://77.222.47.140:8006`) → SQL
Editor, or `psql`/`docker exec teamchat-supabase-db psql -U postgres -d postgres`
directly on `assistant_vps_3`.

If the schema ever needs to change, add a new numbered migration file
(`0002_...sql`) rather than editing `0001_init.sql` in place, and apply it
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
  lib/supabase/
    client.ts               — browser Supabase client (proxied URL)
    server.ts               — server-component Supabase client (direct URL)
    middleware.ts           — session-refresh/auth-redirect Supabase client
    admin.ts                — service_role client (bypasses RLS, server-only)
    cookie-name.ts          — shared AUTH_COOKIE_NAME (see gotcha #3)
  lib/i18n/
    translations.ts         — en/ru string dictionary (see gotcha #9)
    LanguageProvider.tsx    — context provider: locale, setLocale, t()
supabase/migrations/
  0001_init.sql            — full schema, RLS policies, storage bucket
Dockerfile                 — multi-stage build, `output: "standalone"`
next.config.ts             — standalone output + the /supabase proxy rewrite
```

## Notes on notifications

V1 ships **in-app** notifications: unread badges per conversation and a toast
when a message arrives for a channel you're not currently viewing, both
powered by Supabase Realtime. Browser push / email notifications aren't
wired up yet — if you want those later, the natural extension point is a
Postgres trigger or Edge Function on `messages` insert that calls a push
provider (e.g. Web Push, or Supabase's upcoming push integration). Note that
email delivery specifically would also need real SMTP configured on the
Supabase stack, which doesn't exist yet (see the `ENABLE_EMAIL_AUTOCONFIRM`
note above).

## Possible next steps (not yet done)

- Message editing/deletion UI (the DB schema and RLS policies already
  support it — `edited_at` column, update/delete policies scoped to the
  sender — just no UI wired up yet)
- Channel renaming, leaving a channel, removing members
- Push/email notifications (see above)
- Avatars (`profiles.avatar_url` column exists, unused)
- Message search
- More languages, if needed (add a new key to `translations.ts` and an
  option in `LanguageSwitcher.tsx`)
