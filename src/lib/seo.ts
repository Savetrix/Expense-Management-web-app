// Site-level SEO constants and the structured data emitted on the marketing
// route. Kept out of the components so the canonical host is defined exactly
// once and so every factual claim below can be traced to the code that
// implements it — each block cites the file it was read from.
//
// No browser-only calls in this file, so it is safe to import from a Server
// Component (which is the only place it is used).

import { SUPPORT_EMAIL } from "@/lib/legal";

/**
 * Canonical origin, no trailing slash. Follows the same env-with-fallback
 * pattern as src/lib/api.ts's BASE_URL: deployment can override, and the
 * known-good production value is the default so a missing env var can never
 * emit a canonical pointing at localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://scantrix.ai"
).replace(/\/$/, "");

export const SITE_NAME = "Scantrix";

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Renders a JSON-LD payload. `<` is escaped to its unicode form because
 * JSON.stringify does not sanitize strings for injection into a <script>
 * element — the escaping Next's own JSON-LD guide prescribes
 * (node_modules/next/dist/docs/01-app/02-guides/json-ld.md).
 */
export function jsonLdScriptProps(payload: unknown): {
  type: "application/ld+json";
  dangerouslySetInnerHTML: { __html: string };
} {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
    },
  };
}

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/**
 * Organization. "Founded in 2025" was stated in the About section of the
 * landing page before the October 2026 redesign; the support address comes
 * from src/lib/legal.ts.
 */
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl("/scantrix-icon.png"),
  foundingDate: "2025",
  description:
    "Scantrix reads supplier invoices, matches the vendor in QuickBooks Online and posts the bill, holding low-confidence documents in a review queue.",
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      availableLanguage: ["en"],
    },
  ],
};

/**
 * SoftwareApplication.
 *
 * `featureList` restates the capability tiles of the landing page as it was
 * before the October 2026 redesign, each of which was backed by a thunk in
 * src/store: scanInvoice / postInvoiceToQuickBooks
 * (invoice/invoiceApi.ts), getMyQBConnections + fetchQuickBooksVendors +
 * fetchQuickBooksAccounts + fetchQuickBooksTaxCodes (quickBooks/quickBooksApi.ts),
 * connectGoogleDrive (googleDrive/googleDriveApi.ts), enableInboundForwarding
 * (inboundEmail/inboundEmailApi.ts) and inviteQBMember (quickBooks/quickBooksApi.ts).
 *
 * There is deliberately no `offers` block. The only price stated anywhere in
 * the codebase is the trial's "$0 for 14 days"; Standard and Enterprise read
 * "Monthly or yearly billing" and the page defers to the app ("Current prices
 * are shown in the app when you start your trial" — Pricing.tsx).
 * Emitting a price we cannot read from the code would be inventing one.
 */
export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Accounts payable automation",
  operatingSystem: "Web browser",
  browserRequirements: "Requires JavaScript. Requires a modern web browser.",
  publisher: { "@id": ORGANIZATION_ID },
  description:
    "Accounts payable software that reads supplier invoices, matches each one to the right vendor in QuickBooks Online and posts it as a bill, holding anything low-confidence in a review queue.",
  featureList: [
    "Extracts vendor, invoice number, dates, line items, totals and currency from PDFs and photos",
    "Posts confident invoices to QuickBooks Online as bills",
    "Matches each invoice to an existing QuickBooks vendor",
    "Connects multiple QuickBooks companies and switches between them",
    "Review queue for low-confidence and failed invoices, with the reason",
    "Per-company email forwarding address for supplier invoices",
    "Pulls invoices from Google Drive",
    "Syncs the QuickBooks chart of accounts and tax codes",
    "Built-in assistant that reads and updates invoices and vendors on request",
    "Unlimited team members on every plan",
  ],
};

/**
 * FAQ, rendered on /faq (src/app/faq/page.tsx). Google requires FAQPage
 * answers to be visible on the page that carries the JSON-LD, which is why
 * faqPageJsonLd is emitted there and nowhere else. Every answer states only
 * what the code implements; the source is noted above each one that was
 * checked against it.
 *
 * `key` is a stable handle for links (src/lib/faq.ts). The URL fragment is
 * derived from the question, so rewording a question moves its anchor and
 * every link follows.
 */
export const FAQ_ITEMS: { key: string; question: string; answer: string }[] = [
  {
    // Xero posting: src/lib/accountingProvider.ts (PROVIDERS.xero).
    key: "auto-post",
    question: "Does ScanTrix post invoices to QuickBooks or Xero automatically?",
    answer:
      "Yes. An invoice ScanTrix reads confidently is posted to QuickBooks Online or Xero as a bill without a manual step. Anything it is unsure about, or that fails, is held in a review queue with the reason attached rather than posted quietly.",
  },
  {
    // Drives are storage, not a source: src/store/useStorageDrive.ts.
    key: "intake",
    question: "How do invoices get into ScanTrix?",
    answer:
      "Three ways: forward the email to the address for that company, upload a PDF or photo in the web app, or snap the paper invoice with the ScanTrix mobile app. All three land in the same queue and follow the same reading, vendor-matching and review rules.",
  },
  {
    // Providers: src/lib/accountingProvider.ts. Coming soon:
    // COMING_SOON in src/components/v2/accounting/AccountingSoftwaresContentV2.tsx.
    key: "software",
    question: "Which accounting software does ScanTrix connect to?",
    answer:
      "QuickBooks Online and Xero. Posted invoices can also be copied to a connected Google Drive or OneDrive. Sage, FreshBooks and Zoho Books are listed in the app as coming soon.",
  },
  {
    // Forwarding addresses are tied to a QuickBooks connection
    // (alias.qbConnectionId); not yet confirmed for Xero, so this stays QuickBooks.
    key: "multi-company",
    question: "Can ScanTrix handle more than one QuickBooks company?",
    answer:
      "Yes. You can connect several QuickBooks companies and switch between them, and each company gets its own forwarding address — the address decides which set of books an emailed invoice belongs to, so nobody picks from a dropdown at the moment of forwarding.",
  },
  {
    // aliasAuthorizedSenders (src/lib/inboundEmail/pipeline.ts),
    // MAX_ADDITIONAL_SENDERS (src/app/api/inbound/aliases/[id]/route.ts),
    // evaluateEmailAuthentication (src/lib/inboundEmail/authorization.ts).
    key: "senders",
    question: "Who can send invoices to my ScanTrix address?",
    answer:
      "You, and up to 10 more email addresses you add in the forwarding settings. Your account email is approved when you turn forwarding on. Mail from any other address is discarded without a reply, and every accepted message must also pass the email-authentication checks its domain publishes.",
  },
  {
    key: "security",
    question: "Is email forwarding safe to give to a supplier?",
    answer:
      "Forwarding accepts mail only from senders you have listed; anything else is discarded without a reply. Each message is checked against the anti-spoofing records its own domain publishes, attachments are verified against their actual leading bytes rather than their filename and are virus-scanned before download, and links in the message body are never opened. Forwarding never posts a bill on its own.",
  },
  {
    key: "trial",
    question: "Is there a free trial, and does it need a card?",
    answer:
      "Every plan starts with a 14-day free trial and no credit card is required to begin it.",
  },
  {
    key: "team",
    question: "Can my whole team use one account?",
    answer:
      "Yes. Every plan includes unlimited team members, who can scan, review and post against the same connected books.",
  },
];

export const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE_URL}/faq#faq`,
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

// ==============================
// BLOG
// ==============================
//
// BreadcrumbList became valid with the blog: /blog and /blog/<slug> are the
// site's first real hierarchy below "/". It is still deliberately NOT emitted on
// the homepage, where a one-item trail pointing at itself is not a hierarchy
// and Google discards it.

export const BLOG_NAME = "Scantrix Blog";
export const BLOG_DESCRIPTION =
  "Practical guides to accounts payable, bill entry and QuickBooks Online for accountants and finance teams.";

/** Breadcrumb trail, root first. Paths are site-relative. */
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

interface BlogPostingInput {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string | null;
  category: string;
  tags: string[];
  wordCount: number;
}

const BLOG_ID = `${SITE_URL}/blog#blog`;

/**
 * BlogPosting. The author is the Organization rather than an invented person:
 * posts are written as "Scantrix Team", and a named author with no real
 * profile behind it is exactly the kind of signal Google's quality raters are
 * told to distrust.
 */
export function blogPostingJsonLd(post: BlogPostingInput) {
  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: post.title,
    description: post.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: absoluteUrl(`/blog/${post.slug}/opengraph-image`),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    articleSection: post.category,
    keywords: post.tags.join(", "),
    wordCount: post.wordCount,
    inLanguage: "en",
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": BLOG_ID },
  };
}

/** Blog, listing its posts. Organization is repeated so the @id references resolve on this page. */
export function blogJsonLd(posts: BlogPostingInput[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      // Inside a @graph the context is inherited; undefined drops it on stringify.
      { ...organizationJsonLd, "@context": undefined },
      {
        "@type": "Blog",
        "@id": BLOG_ID,
        name: BLOG_NAME,
        description: BLOG_DESCRIPTION,
        url: absoluteUrl("/blog"),
        inLanguage: "en",
        publisher: { "@id": ORGANIZATION_ID },
        blogPost: posts.map((post) => ({
          "@type": "BlogPosting",
          "@id": `${absoluteUrl(`/blog/${post.slug}`)}#article`,
          headline: post.title,
          url: absoluteUrl(`/blog/${post.slug}`),
          datePublished: post.publishedAt,
          dateModified: post.updatedAt ?? post.publishedAt,
        })),
      },
    ],
  };
}
