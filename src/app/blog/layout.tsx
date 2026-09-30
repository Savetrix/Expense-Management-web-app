import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";

// The blog is marketing, not product: it sits outside the (app) route group,
// like "/", so it renders to real HTML on the server with no Providers, no
// AuthGate and nothing that waits for the browser. `lp-root` scopes the landing
// page's design tokens (src/app/globals.css) to this subtree.
export const metadata: Metadata = {
  alternates: {
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Scantrix Blog" }] },
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-root lp-blog flex min-h-screen flex-col">
      <LandingNav />
      {/* pt-16 clears the fixed 64px nav. */}
      <main className="flex-1 pt-16">{children}</main>
      <LandingFooter />
    </div>
  );
}
