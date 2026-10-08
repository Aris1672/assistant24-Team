-- 0004: message replies.
--
-- A reply stores the id of the message it answers. This is deliberately a
-- plain uuid column with NO foreign key: if the original is later deleted
-- (messages can be deleted for everyone), the reply keeps its pointer and the
-- UI shows "Message deleted" in the quote — consistently, also after a page
-- reload. With `on delete set null` the quote would silently vanish on reload
-- instead. The UI only ever looks the id up among the messages of the same
-- channel, so a stale or foreign id is harmless.
--
-- No new RLS policies are needed: the existing insert/select policies on
-- public.messages already cover the new column. The table is already in the
-- supabase_realtime publication, so reply_to_id arrives in INSERT events.

alter table public.messages
  add column if not exists reply_to_id uuid;
