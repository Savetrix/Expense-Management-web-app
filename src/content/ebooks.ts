// The /ebooks page (src/app/ebooks/page.tsx) and each e-book's reading page
// (src/app/ebooks/[slug]/page.tsx) read this list.
//
// To publish an e-book:
//   1. Put the PDF in public/ebooks/ and, optionally, a cover image in
//      public/ebooks/covers/ (a wide 8:3 banner, e.g. 1600x600; SVG works).
//   2. Fill in `file` (e.g. "/ebooks/ap-automation-guide.pdf") and, if you have
//      one, `cover`. An entry with no `file` shows a "Coming soon" label instead
//      of a download link, so nothing on the page ever 404s.
//   3. To make it readable on the site, put the text as Markdown in
//      src/content/ebooks-text/<slug>.ts (export `body`) and set `body` here.
//      With a `body` the card opens a reading page at /ebooks/<slug>, with the
//      PDF as a separate download button; without one it just downloads.
//   4. The /ebooks page stays out of search results (noindex) until at least
//      one entry has a `file`.
import { body as aiInvoiceProcessingBody } from "./ebooks-text/ai-invoice-processing-for-accountants";
import { body as duplicateInvoicesBody } from "./ebooks-text/duplicate-invoices-guide";

export interface Ebook {
  /** Unique, URL-safe. Used as the React key and the download filename. */
  slug: string;
  title: string;
  /** One or two sentences. */
  description: string;
  /** Short label shown above the title, e.g. "Guide · 24 pages". */
  meta: string;
  /** Public path to the PDF. Omit while the e-book isn't ready. */
  file?: string;
  /** Public path to a wide banner image (8:3, e.g. 1600x600; SVG or a raster). Omit to use the generated cover. */
  cover?: string;
  /** Markdown text for the in-site reading page. No H1; chapters start at "##". */
  body?: string;
  /** Shown on the reading page, e.g. "October 2026". */
  publishedLabel?: string;
}

export const EBOOKS: readonly Ebook[] = [
  {
    slug: "ai-invoice-processing-for-accountants",
    title: "AI Invoice Processing for Accountants",
    description:
      "How to automate accounts payable in QuickBooks Online and Xero without giving up control of the books: confidence scores, approvals, a 10-question buying checklist and a 30-day rollout plan.",
    meta: "Guide · 14 pages",
    file: "/ebooks/ai-invoice-processing-for-accountants.pdf",
    cover: "/ebooks/covers/ai-invoice-processing-for-accountants.svg",
    body: aiInvoiceProcessingBody,
    publishedLabel: "October 2026",
  },
  {
    slug: "duplicate-invoices-guide",
    title: "Duplicate Invoices",
    description:
      "How duplicate invoices happen, what they cost, and how to stop them before they reach the books: ten common causes, an audit method and a five-layer prevention system for QuickBooks Online and Xero.",
    meta: "Guide · 21 pages",
    file: "/ebooks/duplicate-invoices-guide.pdf",
    cover: "/ebooks/covers/duplicate-invoices-guide.svg",
    body: duplicateInvoicesBody,
    publishedLabel: "October 2026",
  },
];
