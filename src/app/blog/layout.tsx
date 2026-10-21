import type { Metadata } from "next";

import "@/components/landing/lp2.css";
import { LP2_FONTS } from "@/components/landing/fonts";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

// The blog is marketing, not product: it sits outside the (app) route group,
// like "/", so it renders to real HTML on the server with no Providers, no
// AuthGate and nothing that waits for the browser. `lp-root` scopes the blog's
// design tokens (src/app/globals.css) to this subtree.
//
// The header and footer are the homepage's. Each sits in its own `.lp2
// lp2-chrome` wrapper, which carries the landing tokens and fonts without
// putting the blog prose under the landing stylesheet; the wrapper is
// display:contents, so the header's position:sticky still spans the page and
// needs no top padding on <main>.
export const metadata: Metadata = {
  alternates: {
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Scantrix Blog" }] },
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-root lp-blog flex min-h-screen flex-col">
      <div className={`lp2 lp2-chrome ${LP2_FONTS}`}>
        <SiteHeader />
      </div>
      <main className="flex-1">{children}</main>
      <div className={`lp2 lp2-chrome ${LP2_FONTS}`}>
        <SiteFooter />
      </div>
    </div>
  );
}
