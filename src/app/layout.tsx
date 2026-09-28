import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";

export const metadata: Metadata = {
  title: "TeamChat",
  description: "Exchange files and messages with your team",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TeamChat",
  },
};

// Tells the browser this page is intentionally dark, so mobile browsers
// with their own "force dark/light mode" heuristics don't try to relayer
// or invert colors on top of our own dark theme (a common cause of a
// self-styled dark page showing unexpected white patches on some Android
// browsers). Also sets native form-control/scrollbar colors to match.
export const viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full min-h-full bg-neutral-950 antialiased">
      <body className="h-full min-h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
