"use client";

import Link from "next/link";

import { Wordmark } from "./primitives";
import { trackSignupClick } from "./pixel";

// Shared by the homepage and the blog. Section links are root-relative for the
// same reason as LandingNav's: a bare "#faq" would go nowhere on /blog.
// Client component only because of the sign-up click tracking.
export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            AI-assisted invoice scanning, QuickBooks sync and team management for
            accountants and small businesses.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] font-medium text-text-secondary">
          <Link href="/#how" className="transition-colors hover:text-trust-navy">How it works</Link>
          <Link href="/#capabilities" className="transition-colors hover:text-trust-navy">Capabilities</Link>
          <Link href="/#pricing" className="transition-colors hover:text-trust-navy">Pricing</Link>
          <Link href="/#faq" className="transition-colors hover:text-trust-navy">FAQ</Link>
          <Link href="/#about" className="transition-colors hover:text-trust-navy">About</Link>
          <Link href="/blog" className="transition-colors hover:text-trust-navy">Blog</Link>
          <Link href="/login" className="transition-colors hover:text-trust-navy">Log in</Link>
          <Link href="/register" onClick={trackSignupClick} className="font-semibold text-trust-navy">Start free</Link>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-[12.5px] text-text-secondary sm:px-8">
          <span>© {new Date().getFullYear()} Scantrix. All rights reserved.</span>
          {/* A plain anchor: the feed is an XML file, not a page to route to. */}
          <a href="/blog/rss.xml" className="transition-colors hover:text-trust-navy">RSS feed</a>
        </div>
      </div>
    </footer>
  );
}
