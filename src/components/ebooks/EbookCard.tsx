import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";

import type { Ebook } from "@/content/ebooks";

// One e-book in the /ebooks grid, styled like the blog's PostCard.
//   - With a `body`, the whole card opens the in-site reading page and the PDF is
//     a separate download button (a stretched link plus a raised button, so there
//     is no anchor nested inside another).
//   - With only a `file`, the whole card is the download.
//   - With neither, it shows "Coming soon" so nothing ever links to a missing file.
export function EbookCard({ book }: { book: Ebook }) {
  const readable = Boolean(book.body);

  // A wide 8:3 banner that fills the card's width. SVGs skip the image optimizer
  // (they're already vector, and it refuses them by default).
  const cover = book.cover ? (
    <Image
      src={book.cover}
      alt={`Cover of ${book.title}`}
      fill
      sizes="(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw"
      unoptimized={book.cover.endsWith(".svg")}
      className="object-cover"
    />
  ) : (
    // Generated banner, used until a real cover image is supplied.
    <div
      aria-hidden
      className="absolute inset-0 flex flex-col justify-between p-6 text-white"
      style={{ background: "linear-gradient(155deg, var(--lp-navy) 0%, var(--lp-navy-950) 80%)" }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--lp-teal)]">
        Scantrix
      </span>
      <span className="max-w-[80%] text-[22px] font-semibold leading-tight tracking-[-0.01em]">{book.title}</span>
      <span className="h-[3px] w-8 rounded-full bg-[color:var(--lp-teal)]" />
    </div>
  );

  const heading = (
    <h2 className="mt-3 text-[17.5px] font-bold leading-snug tracking-[-0.01em] text-trust-navy group-hover:text-[color:var(--lp-teal-700)]">
      {readable ? (
        // The stretched ::after makes the whole card the link target.
        <Link
          href={`/ebooks/${book.slug}`}
          className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[color:var(--lp-teal)]"
        >
          {book.title}
        </Link>
      ) : (
        book.title
      )}
    </h2>
  );

  const content = (
    <>
      <div className="relative aspect-[8/3] overflow-hidden rounded-xl bg-[color:var(--lp-navy-950)]">{cover}</div>
      <span className="mt-5 w-fit rounded-pill bg-[color:var(--lp-teal-050)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--lp-teal-700)]">
        {book.meta}
      </span>
      {heading}
      <p className="mt-2 flex-1 text-[14px] leading-relaxed text-text-secondary">{book.description}</p>
    </>
  );

  const base = "group relative flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm";
  const hover =
    "transition-all hover:-translate-y-0.5 hover:border-[color:var(--lp-teal)] hover:shadow-md";

  if (readable) {
    return (
      <article className={`${base} ${hover}`}>
        {content}
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[color:var(--lp-teal-700)]">
            Read online
            <ArrowRight size={16} strokeWidth={2.25} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
          </span>
          {book.file && (
            <a
              href={book.file}
              download={`${book.slug}.pdf`}
              aria-label={`Download ${book.title} as a PDF`}
              className="relative z-10 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-trust-navy transition-colors hover:border-[color:var(--lp-teal)] hover:bg-[color:var(--lp-teal-050)]"
            >
              <Download size={14} strokeWidth={2.25} aria-hidden />
              PDF
            </a>
          )}
        </div>
      </article>
    );
  }

  if (book.file) {
    return (
      <a
        href={book.file}
        download={`${book.slug}.pdf`}
        className={`${base} ${hover} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)]`}
      >
        {content}
        <div className="mt-5 flex items-center justify-between gap-3 text-[14px] font-semibold text-[color:var(--lp-teal-700)]">
          Download PDF
          <Download size={16} strokeWidth={2.25} aria-hidden className="shrink-0" />
        </div>
      </a>
    );
  }

  return (
    <article className={base}>
      {content}
      <div className="mt-5 text-[14px] font-semibold text-text-secondary">Coming soon</div>
    </article>
  );
}
