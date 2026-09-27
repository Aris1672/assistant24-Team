import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TeamChat",
  description: "Exchange files and messages with your team",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full min-h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans">
        {children}
      </body>
    </html>
  );
}
