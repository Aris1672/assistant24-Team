import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates a group channel with the current user plus any chosen member ids.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, memberIds } = await request.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Channel name is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .insert({ name, is_dm: false, created_by: user.id })
    .select()
    .single();

  if (channelError || !channel) {
    return NextResponse.json({ error: channelError?.message }, { status: 500 });
  }

  const uniqueMemberIds = Array.from(
    new Set([user.id, ...((memberIds as string[]) ?? [])])
  );

  const { error: membersError } = await admin.from("channel_members").insert(
    uniqueMemberIds.map((id) => ({ channel_id: channel.id, user_id: id }))
  );

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json({ channelId: channel.id });
}
