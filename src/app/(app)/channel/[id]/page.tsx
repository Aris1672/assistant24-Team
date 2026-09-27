import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatView from "@/components/ChatView";
import type { Profile } from "@/lib/types";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("id", id)
    .single();

  if (!channel) notFound();

  const { data: memberRows } = await supabase
    .from("channel_members")
    .select("profiles(*)")
    .eq("channel_id", id);

  const members = (memberRows ?? [])
    .map((r) => (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles))
    .filter(Boolean) as Profile[];

  const { data: messages } = await supabase
    .from("messages")
    .select("*, sender:profiles(*), attachments(*)")
    .eq("channel_id", id)
    .order("created_at", { ascending: true });

  // Mark as read
  await supabase
    .from("channel_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", id)
    .eq("user_id", user.id);

  return (
    <ChatView
      channel={channel}
      members={members}
      initialMessages={messages ?? []}
      currentUserId={user.id}
    />
  );
}
