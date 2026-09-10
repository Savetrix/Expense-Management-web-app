import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { Providers } from "../providers";
import { AuthGate } from "@/components/auth/AuthGate";

// Everything behind this layout is the signed-in product (plus the transient
// auth screens AuthGate lists as public). It exists so that Providers and
// AuthGate — both client components that render nothing until the browser has
// rehydrated — stop sitting above the marketing route at "/". While they did,
// every route in the app, "/" included, served an empty <body> to crawlers and
// link-preview bots, which do not run JS. Route groups don't affect URLs, so
// every path under here is unchanged.
//
// AuthGate itself is untouched: it still wraps exactly the same set of routes
// it did before, including the 404 (see ../not-found.tsx, which re-applies
// this same pair so its documented DESIGN_ASSUMPTIONS.md D4.2 behavior holds).

// Geist Mono is only ever rendered inside the signed-in product (currently
// EmailForwardingPanel's diagnostics rows). Declaring it here instead of the
// root layout keeps its woff2 out of the marketing page's preload list, where
// it was being fetched on every visit and never used. The CSS variable still
// reaches globals.css's --font-mono by inheritance from the wrapper below.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Nothing under this layout should ever reach a search index: these routes
// either redirect to /login or render a per-account view. Declared here once
// rather than on 20-odd individual pages.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${geistMono.variable} flex min-h-full flex-1 flex-col`}>
      <Providers>
        <AuthGate>{children}</AuthGate>
      </Providers>
    </div>
  );
}
