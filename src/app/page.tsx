import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/LandingPage";
import {
  faqPageJsonLd,
  jsonLdScriptProps,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo";

// The public marketing page, and currently the only indexable route on the
// site. It sits outside the (app) route group, so unlike every other page it
// renders to real HTML on the server — no Providers, no AuthGate, nothing that
// waits for the browser. See src/app/(app)/layout.tsx for why that split
// exists.
export const metadata: Metadata = {
  title: "QuickBooks Invoice Scanning & AP Automation | Scantrix",
  description:
    "Scantrix reads every supplier invoice, matches the vendor in QuickBooks Online and posts the bill — so your team only reviews the exceptions. Free 14-day trial, no credit card.",
  alternates: { canonical: "/" },
  keywords: [
    "QuickBooks invoice scanning",
    "accounts payable automation",
    "invoice OCR QuickBooks",
    "bill entry automation",
    "AP automation for accountants",
  ],
};

export default function RootPage() {
  return (
    <>
      {/* Structured data. Emitted from the server component rather than the
          client tree so it is present in the initial HTML, which is the only
          form crawlers parse it in. Payloads and their sourcing: @/lib/seo. */}
      <script {...jsonLdScriptProps(organizationJsonLd)} />
      <script {...jsonLdScriptProps(softwareApplicationJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
      <LandingPage />
    </>
  );
}
