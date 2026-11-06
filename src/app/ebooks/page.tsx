import type { Metadata } from "next";

import { BlogCta } from "@/components/blog/BlogCta";
import { EbookCard } from "@/components/ebooks/EbookCard";
import { SectionLabel } from "@/components/landing/primitives";
import { EBOOKS } from "@/content/ebooks";
import { breadcrumbJsonLd, jsonLdScriptProps } from "@/lib/seo";

const DESCRIPTION =
  "In-depth guides on invoice capture, accounts payable and month-end close for accountants and bookkeepers, from the Scantrix team.";

// Kept out of search results until at least one e-book has a real PDF, so
// placeholder cards are never indexed.
const hasPublishedEbook = EBOOKS.some((book) => book.file);

export const metadata: Metadata = {
  title: "E-books for Accountants & Bookkeepers | Scantrix",
  description: DESCRIPTION,
  alternates: { canonical: "/ebooks" },
  robots: hasPublishedEbook ? undefined : { index: false, follow: true },
  openGraph: {
    type: "website",
    url: "/ebooks",
    title: "Scantrix E-books",
    description: DESCRIPTION,
  },
};

export default function EbooksPage() {
  return (
    <>
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "E-books", path: "/ebooks" },
          ]),
        )}
      />

      <div className="relative overflow-hidden border-b border-border bg-[color:var(--lp-soft)]">
        <div className="lp-dotgrid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <header className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <SectionLabel>E-books</SectionLabel>
          <h1 className="mt-4 max-w-3xl text-[clamp(2.1rem,5vw,3.4rem)] font-bold leading-[1.05] tracking-[-0.03em] text-trust-navy">
            Guides for the people who keep the books.
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-text-secondary">
            Practical reading on invoice capture, accounts payable and month-end close, written for
            accountants and bookkeepers.
          </p>
        </header>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
        {EBOOKS.length === 0 ? (
          <p className="text-[16px] text-text-secondary">New e-books are on their way.</p>
        ) : (
          // Three columns only once there are three cards to fill them.
          <div className={`grid gap-5 md:grid-cols-2 ${EBOOKS.length >= 3 ? "lg:grid-cols-3" : ""}`}>
            {EBOOKS.map((book) => (
              <EbookCard key={book.slug} book={book} />
            ))}
          </div>
        )}

        <div className="mt-16">
          <BlogCta />
        </div>
      </div>
    </>
  );
}
