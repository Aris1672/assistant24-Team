-- TeamChat initial schema
-- Run this against your self-hosted Supabase Postgres (via SQL editor, psql, or `supabase db push`).

-- 1. Profiles ---------------------------------------------------------------
-- One row per auth.users, holding public-facing profile info.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Channels -----------------------------------------------------------
-- A channel is either a group channel or a 1:1 DM (is_dm = true, exactly 2 members).
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text,                     -- null for DMs
  is_dm boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.channels enable row level security;

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.channel_members enable row level security;

-- Helper: is the current user a member of a given channel?
create or replace function public.is_channel_member(target_channel_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = auth.uid()
  );
$$;

create policy "Members can view their channels"
  on public.channels for select
  to authenticated
  using (public.is_channel_member(id));

create policy "Authenticated users can create channels"
  on public.channels for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Members can view channel membership"
  on public.channel_members for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "Users can add channel members when creating a channel"
  on public.channel_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.channels c
      where c.id = channel_id and c.created_by = auth.uid()
    )
  );

create policy "Members can update their own membership row"
  on public.channel_members for update
  to authenticated
  using (user_id = auth.uid());

create policy "Members can leave a channel"
  on public.channel_members for delete
  to authenticated
  using (user_id = auth.uid());

-- 3. Messages -------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

alter table public.messages enable row level security;

create policy "Members can read messages in their channels"
  on public.messages for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "Members can send messages in their channels"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_channel_member(channel_id)
  );

create policy "Senders can edit their own messages"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid());

create policy "Senders can delete their own messages"
  on public.messages for delete
  to authenticated
  using (sender_id = auth.uid());

-- 4. Attachments ------------------------------------------------------------
-- Metadata for files stored in the 'attachments' Storage bucket.
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id),
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table public.attachments enable row level security;

create policy "Members can view attachments in their channels"
  on public.attachments for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "Members can add attachments in their channels"
  on public.attachments for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and public.is_channel_member(channel_id)
  );

create policy "Uploaders can delete their own attachments"
  on public.attachments for delete
  to authenticated
  using (uploader_id = auth.uid());

-- 5. Realtime -----------------------------------------------------------
-- Make sure inserts/updates on messages stream to subscribed clients.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.attachments;
alter publication supabase_realtime add table public.channel_members;

-- 6. Storage bucket -------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Storage RLS: object path convention is `${channel_id}/${message_id}/${filename}`
create policy "Members can read files in their channels"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member((storage.foldername(name))[1]::uuid)
  );

create policy "Members can upload files in their channels"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_channel_member((storage.foldername(name))[1]::uuid)
  );

create policy "Uploaders can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and owner = auth.uid()
  );
