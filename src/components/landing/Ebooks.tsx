import Image from "next/image";

import { EBOOKS } from "@/content/ebooks";

// E-books band, between Integrations and Pricing. Reads src/content/ebooks.ts;
// renders nothing when that list is empty. A Server Component: no client JS.
export function Ebooks() {
  if (EBOOKS.length === 0) return null;

  return (
    <section className="eb" id="ebooks">
      <div className="wrap">
        <div className="sec-top">
          <p className="eyebrow">E-books</p>
          <h2 className="h2">
            Guides for the people who keep the books
            <i className="pd">.</i>
          </h2>
          <p className="eb-sub">
            Practical reading on invoice capture, accounts payable and month-end close, written for accountants and bookkeepers.
          </p>
        </div>
        <div className="eb-grid">
          {EBOOKS.map((book) => (
            <article className="eb-card" key={book.slug}>
              <div className="eb-stage" aria-hidden={book.cover ? undefined : true}>
                {book.cover ? (
                  <Image
                    className="eb-img"
                    src={book.cover}
                    alt={`Cover of ${book.title}`}
                    width={300}
                    height={400}
                  />
                ) : (
                  <div className="eb-book">
                    <span className="eb-book-brand">ScanTrix</span>
                    <span className="eb-book-title">{book.title}</span>
                    <span className="eb-book-rule" />
                  </div>
                )}
              </div>
              <p className="eb-meta">{book.meta}</p>
              <h3 className="eb-title">{book.title}</h3>
              <p className="eb-desc">{book.description}</p>
              {book.file ? (
                <a className="gbtn eb-cta" href={book.file} download={`${book.slug}.pdf`}>
                  Download PDF
                </a>
              ) : (
                <span className="eb-soon">Coming soon</span>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
