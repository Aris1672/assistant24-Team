-- Web Push subscriptions
-- One row per browser/device that has granted notification permission and
-- registered a service worker push subscription. A user can have several
-- (phone + laptop, etc.) — uniqueness is on `endpoint`, which is unique per
-- browser install by construction (it's a per-device push-service URL).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Users manage only their own subscriptions from the client (used when
-- registering/unregistering a device). The server-side push sender in
-- server.js uses the service_role key and bypasses RLS entirely, since it
-- needs to read every recipient's subscriptions to deliver a new message.
create policy "Users can view their own push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can add their own push subscriptions"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can remove their own push subscriptions"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());
