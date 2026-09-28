-- Avatar uploads
-- Adds a public 'avatars' Storage bucket. profiles.avatar_url already exists
-- (from 0001_init.sql) and just gets populated once a user uploads one.
--
-- Object path convention: `${user_id}/${filename}` — mirrors the
-- `attachments` bucket's `${channel_id}/...` convention so ownership can be
-- checked from the path alone.
--
-- Unlike `attachments`, this bucket is public: avatars are small, non
-- sensitive, and need to render for every teammate without minting a signed
-- URL per image, so a plain public URL (`getPublicUrl`) is fine here.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can replace their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
