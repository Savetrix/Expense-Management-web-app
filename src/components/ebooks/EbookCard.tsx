import Image from "next/image";
import { Download } from "lucide-react";

import type { Ebook } from "@/content/ebooks";

// One e-book in the /ebooks grid. Styled like the blog's PostCard. A card with
// a PDF is a download link; one without shows "Coming soon" instead, so the page
// never links to a file that isn't there.
export function EbookCard({ book }: { book: Ebook }) {
  // A wide banner: the cover fills the card's full width at a short height, so
  // it shows the top of the (portrait) cover, anchored to its top edge.
  const cover = book.cover ? (
    <Image
      src={book.cover}
      alt={`Cover of ${book.title}`}
      fill
      sizes="(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw"
      className="object-cover object-top"
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

  const body = (
    <>
      <div className="relative h-56 overflow-hidden rounded-xl bg-[color:var(--lp-navy-950)]">{cover}</div>
      <span className="mt-5 w-fit rounded-pill bg-[color:var(--lp-teal-050)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--lp-teal-700)]">
        {book.meta}
      </span>
      <h2 className="mt-3 text-[17.5px] font-bold leading-snug tracking-[-0.01em] text-trust-navy group-hover:text-[color:var(--lp-teal-700)]">
        {book.title}
      </h2>
      <p className="mt-2 flex-1 text-[14px] leading-relaxed text-text-secondary">{book.description}</p>
      <div className="mt-5 flex items-center justify-between gap-3 text-[14px] font-semibold">
        {book.file ? (
          <>
            <span className="text-[color:var(--lp-teal-700)]">Download PDF</span>
            <Download size={16} strokeWidth={2.25} aria-hidden className="shrink-0 text-[color:var(--lp-teal-700)]" />
          </>
        ) : (
          <span className="text-text-secondary">Coming soon</span>
        )}
      </div>
    </>
  );

  const base = "flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm";

  return book.file ? (
    <a
      href={book.file}
      download={`${book.slug}.pdf`}
      className={`group ${base} transition-all hover:-translate-y-0.5 hover:border-[color:var(--lp-teal)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)]`}
    >
      {body}
    </a>
  ) : (
    <article className={`group ${base}`}>{body}</article>
  );
}
