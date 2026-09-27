"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import type { Profile } from "@/lib/types";

export default function AppShell({
  currentUser,
  children,
}: {
  currentUser: Profile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChannelOpen = pathname?.startsWith("/channel/");

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* On phone widths, show either the conversation list OR the open
          chat, never both — the list is the "home" view, hidden once a
          channel is open. From md breakpoint up, both stay visible
          side-by-side as before. */}
      <div className={`${isChannelOpen ? "hidden" : "contents"} md:contents`}>
        <Sidebar currentUser={currentUser} />
      </div>
      <main
        className={`${isChannelOpen ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}
      >
        {children}
      </main>
    </div>
  );
}
