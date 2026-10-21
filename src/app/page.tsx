import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/LandingPage";
import { jsonLdScriptProps, organizationJsonLd, softwareApplicationJsonLd } from "@/lib/seo";

// The public marketing page. It sits outside the (app) route group, so unlike
// the product pages it renders to real HTML on the server — no Providers, no
// AuthGate, nothing that waits for the browser. See src/app/(app)/layout.tsx
// for why that split exists. The FAQ structured data lives on /faq, the page
// that shows the answers.
export const metadata: Metadata = {
  title: "ScanTrix · Accounts payable automation for QuickBooks and Xero",
  description:
    "ScanTrix reads every supplier invoice, matches the vendor in QuickBooks Online or Xero and posts the bill — so your team only reviews the exceptions. Free 14-day trial, no credit card.",
  alternates: {
    canonical: "/",
    // Lets feed readers discover the blog from the homepage.
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Scantrix Blog" }] },
  },
  keywords: [
    "QuickBooks invoice scanning",
    "Xero invoice scanning",
    "accounts payable automation",
    "invoice OCR QuickBooks",
    "bill entry automation",
    "AP automation for accountants",
  ],
};

export default function RootPage() {
  return (
    <>
      {/* Structured data. Emitted from the server component so it is present
          in the initial HTML, which is the only form crawlers parse it in.
          Payloads and their sourcing: @/lib/seo. */}
      <script {...jsonLdScriptProps(organizationJsonLd)} />
      <script {...jsonLdScriptProps(softwareApplicationJsonLd)} />
      <LandingPage />
    </>
  );
}
