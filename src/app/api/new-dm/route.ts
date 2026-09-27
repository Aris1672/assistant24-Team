import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates (or reuses) a 1:1 DM channel between the current user and another user.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { otherUserId } = await request.json();
  if (!otherUserId || otherUserId === user.id) {
    return NextResponse.json({ error: "Invalid target user" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look for an existing DM channel containing exactly these two members.
  const { data: existing } = await admin
    .from("channel_members")
    .select("channel_id, channels!inner(is_dm)")
    .eq("user_id", user.id)
    .eq("channels.is_dm", true);

  if (existing) {
    for (const row of existing) {
      const { data: members } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", row.channel_id);
      const ids = (members ?? []).map((m) => m.user_id).sort();
      if (ids.length === 2 && ids.includes(otherUserId) && ids.includes(user.id)) {
        return NextResponse.json({ channelId: row.channel_id });
      }
    }
  }

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .insert({ is_dm: true, created_by: user.id })
    .select()
    .single();

  if (channelError || !channel) {
    return NextResponse.json({ error: channelError?.message }, { status: 500 });
  }

  const { error: membersError } = await admin.from("channel_members").insert([
    { channel_id: channel.id, user_id: user.id },
    { channel_id: channel.id, user_id: otherUserId },
  ]);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json({ channelId: channel.id });
}
