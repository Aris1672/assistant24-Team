import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar currentUser={profile ?? { id: user.id, email: user.email!, display_name: user.email!, avatar_url: null }} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
