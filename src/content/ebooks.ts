// The /ebooks page (src/app/ebooks/page.tsx) reads this list.
//
// To publish an e-book:
//   1. Put the PDF in public/ebooks/ and, optionally, a cover image in
//      public/ebooks/covers/ (portrait, roughly 3:4).
//   2. Fill in `file` (e.g. "/ebooks/ap-automation-guide.pdf") and, if you have
//      one, `cover`. An entry with no `file` shows a "Coming soon" label instead
//      of a download link, so nothing on the page ever 404s.
//   3. The page stays out of search results (noindex) until at least one entry
//      has a `file`.
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
  /** Public path to a portrait cover image. Omit to use the generated cover. */
  cover?: string;
}

export const EBOOKS: readonly Ebook[] = [
  {
    slug: "ai-invoice-processing-for-accountants",
    title: "AI Invoice Processing for Accountants",
    description:
      "How to automate accounts payable in QuickBooks Online and Xero without giving up control of the books: confidence scores, approvals, a 10-question buying checklist and a 30-day rollout plan.",
    meta: "Guide · 14 pages",
    file: "/ebooks/ai-invoice-processing-for-accountants.pdf",
    cover: "/ebooks/covers/ai-invoice-processing-for-accountants.jpg",
  },
];
