import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getThemePreference } from "@/lib/theme";

// Inter — the standard, neutral typeface for professional SaaS/enterprise
// products (Linear, Notion, Stripe-adjacent tools), chosen deliberately
// over the previous Geist default for a more established, less
// "default-template" feel.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ask Evon",
  description: "Role-based enterprise AI knowledge assistant",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved server-side from the user's account (lib/theme.ts) — light by
  // default, dark only when a logged-in user has actually chosen it. Applied
  // directly to the initial HTML so there's no flash of the wrong theme and
  // no dependency on OS/browser prefers-color-scheme (see the @custom-variant
  // in globals.css).
  const theme = await getThemePreference();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased ${theme === "DARK" ? "dark" : ""}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
