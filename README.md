# TeamChat

A team messaging + file-sharing web app: direct messages, group channels, file
attachments, and live in-app notifications for new messages. Built with
Next.js (App Router) and Supabase (Postgres + Auth + Storage + Realtime).

## Stack

- **Next.js 16** (TypeScript, App Router, Tailwind CSS)
- **Supabase** — self-hosted: Postgres database, Auth, Storage (file uploads),
  Realtime (live message delivery)
- Deploy target: **Coolify** (self-hosted PaaS)

## 1. Set up the database

1. Point the Supabase CLI or SQL editor at your self-hosted Supabase's
   Postgres instance.
2. Run the migration in `supabase/migrations/0001_init.sql`. It creates:
   - `profiles` — one row per user, auto-populated on signup
   - `channels` / `channel_members` — group channels and 1:1 DMs
   - `messages` — chat messages
   - `attachments` — file metadata, backed by a private `attachments` Storage
     bucket
   - Row Level Security policies so users only ever see channels they belong
     to
   - Adds `messages`, `attachments`, `channel_members` to the
     `supabase_realtime` publication so the UI gets live updates

   ```bash
   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
   ```

   or paste its contents into the Supabase Studio SQL editor.

3. In Supabase Auth settings, you can leave "Confirm email" on or off
   depending on whether you want new teammates to verify their email before
   they can sign in.

## 2. Configure environment variables

Copy `.env.example` to `.env.local` (for local dev) and fill in your
self-hosted Supabase details:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The URL the **browser** calls. In production behind HTTPS, this must be a same-origin path (e.g. `https://your-app-domain/supabase`) proxied via the `rewrites()` rule in `next.config.ts` — pointing the browser at a plain `http://` Supabase address directly will get silently blocked as mixed content once the app itself is served over HTTPS. For local dev over plain HTTP, the raw Supabase URL is fine. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project's `anon` / `public` key |
| `SUPABASE_URL` | Server-only. The Supabase stack's real address (e.g. `http://<vps-ip>:<port>`) — used by server components, middleware, and the admin client, which can hit it directly since mixed-content rules only apply to the browser. Optional: falls back to `NEXT_PUBLIC_SUPABASE_URL` if omitted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project's `service_role` key (server-only, never expose to the browser) |

If you point `NEXT_PUBLIC_SUPABASE_URL` at a same-origin proxy path, update the `SUPABASE_UPSTREAM` constant at the top of `next.config.ts` to match your actual Supabase host/port first.

## 3. Run locally

```bash
npm install
npm run dev
```

Visit http://localhost:3000, sign up a couple of test accounts, and start
messaging.

## 4. Deploy on Coolify

1. Push this repo to a Git remote Coolify can reach (GitHub/GitLab/self-hosted
   Git).
2. In Coolify, create a new **Application** from that repo.
   - Build pack: **Nextjs** (Nixpacks) — Coolify auto-detects `next build` /
     `next start`.
   - Port: `3000`.
3. Add the same three environment variables from step 2 in the Coolify app's
   **Environment Variables** panel (mark `SUPABASE_SERVICE_ROLE_KEY` as a
   secret).
4. Make sure your self-hosted Supabase's API URL is reachable from the
   internet (or from Coolify's network) at the URL you set in
   `NEXT_PUBLIC_SUPABASE_URL` — the browser calls it directly.
5. Deploy. Coolify will build and run `next start` behind its own reverse
   proxy/SSL.

## How it's organized

```
src/
  app/
    login/, signup/        — auth pages
    auth/callback/         — email-confirmation redirect handler
    (app)/                 — authenticated app shell
      layout.tsx           — loads current user + renders the sidebar
      page.tsx             — empty state ("select a conversation")
      channel/[id]/        — a channel or DM thread
    api/new-dm/            — creates/reuses a 1:1 DM channel
    api/new-channel/       — creates a group channel
  components/
    Sidebar.tsx            — conversation list, unread badges, new-chat modal
    ChatView.tsx           — message list, composer, realtime subscription
    AttachmentLink.tsx     — signed download links for private files
    NewChatModal.tsx       — pick teammates to start a DM or group
  lib/supabase/            — browser/server/admin/middleware Supabase clients
supabase/migrations/
  0001_init.sql            — full schema, RLS policies, storage bucket
```

## Notes on notifications

V1 ships **in-app** notifications: unread badges per conversation and a toast
when a message arrives for a channel you're not currently viewing, both
powered by Supabase Realtime. Browser push / email notifications aren't
wired up yet — if you want those later, the natural extension point is a
Postgres trigger or Edge Function on `messages` insert that calls a push
provider (e.g. Web Push, or Supabase's upcoming push integration).

