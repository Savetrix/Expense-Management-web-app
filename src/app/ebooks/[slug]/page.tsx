import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Download, List } from "lucide-react";

import { BlogCta } from "@/components/blog/BlogCta";
import { EBOOKS, type Ebook } from "@/content/ebooks";
import { renderMarkdown } from "@/lib/blog";
import { breadcrumbJsonLd, jsonLdScriptProps } from "@/lib/seo";

// Only e-books with in-site text get a page; any other slug is a real 404.
export const dynamicParams = false;

const readable = () => EBOOKS.filter((book): book is Ebook & { body: string } => Boolean(book.body));

export function generateStaticParams() {
  return readable().map((book) => ({ slug: book.slug }));
}

type Props = { params: Promise<{ slug: string }> };

const findBook = (slug: string) => readable().find((book) => book.slug === slug) ?? null;

const WORDS_PER_MINUTE = 230;
const readingMinutes = (markdown: string) =>
  Math.max(1, Math.ceil(markdown.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = findBook(slug);
  if (!book) return {};
  const path = `/ebooks/${book.slug}`;
  return {
    title: `${book.title} | Scantrix E-books`,
    description: book.description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: book.title, description: book.description },
    twitter: { card: "summary_large_image", title: book.title, description: book.description },
  };
}

function DownloadButton({ book, className = "" }: { book: Ebook; className?: string }) {
  if (!book.file) return null;
  return (
    <a
      href={book.file}
      download={`${book.slug}.pdf`}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--lp-navy)] px-6 text-[15px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 ${className}`}
    >
      <Download size={17} strokeWidth={2.25} aria-hidden />
      Download PDF
    </a>
  );
}

function TableOfContents({ headings, idPrefix }: { headings: { id: string; text: string }[]; idPrefix: string }) {
  return (
    <ol className="flex flex-col gap-1 border-l border-border">
      {headings.map((heading) => (
        <li key={`${idPrefix}-${heading.id}`}>
          <a
            href={`#${heading.id}`}
            className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-[13.5px] leading-snug text-text-secondary transition-colors hover:border-[color:var(--lp-teal)] hover:text-trust-navy"
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

export default async function EbookPage({ params }: Props) {
  const { slug } = await params;
  const book = findBook(slug);
  if (!book) notFound();

  const { html, headings } = renderMarkdown(book.body);
  const minutes = readingMinutes(book.body);
  const path = `/ebooks/${book.slug}`;

  return (
    <>
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "E-books", path: "/ebooks" },
            { name: book.title, path },
          ]),
        )}
      />

      <article>
        <header className="border-b border-border bg-[color:var(--lp-soft)]">
          <div className="mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pb-14 sm:pt-12">
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text-secondary">
                <li>
                  <Link href="/" className="hover:text-trust-navy">Home</Link>
                </li>
                <li aria-hidden><ChevronRight size={14} /></li>
                <li>
                  <Link href="/ebooks" className="hover:text-trust-navy">E-books</Link>
                </li>
                <li aria-hidden><ChevronRight size={14} /></li>
                <li aria-current="page" className="max-w-[16rem] truncate text-trust-navy sm:max-w-md">
                  {book.title}
                </li>
              </ol>
            </nav>

            <div className="mt-8 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_27rem] lg:gap-14">
              <div className="max-w-3xl">
                <span className="w-fit rounded-pill bg-[color:var(--lp-teal-050)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--lp-teal-700)]">
                  {book.meta}
                </span>
                <h1 className="mt-4 text-[clamp(2rem,4.6vw,3.1rem)] font-bold leading-[1.08] tracking-[-0.025em] text-trust-navy">
                  {book.title}
                </h1>
                <p className="mt-5 text-[18px] leading-relaxed text-text-secondary">{book.description}</p>
                <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium text-text-secondary">
                  <span className="text-trust-navy">Scantrix Team</span>
                  {book.publishedLabel && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{book.publishedLabel}</span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <span>{minutes} min read</span>
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href="#content"
                    className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-surface px-6 text-[15px] font-semibold text-trust-navy transition-colors hover:border-[color:var(--lp-teal)] hover:bg-[color:var(--lp-teal-050)]"
                  >
                    Start reading
                  </a>
                  <DownloadButton book={book} />
                </div>
              </div>
              {book.cover && (
                <div className="relative hidden aspect-[8/3] overflow-hidden rounded-2xl border border-border bg-[color:var(--lp-navy-950)] shadow-sm lg:block">
                  <Image
                    src={book.cover}
                    alt={`Cover of ${book.title}`}
                    fill
                    priority
                    sizes="432px"
                    unoptimized={book.cover.endsWith(".svg")}
                    className="object-cover"
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <div
          id="content"
          className="mx-auto grid max-w-6xl scroll-mt-20 gap-12 px-5 py-12 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-16"
        >
          <div className="min-w-0">
            {headings.length > 1 && (
              // <details> needs no JavaScript, so the contents work for every
              // reader and crawler, not just once the page has hydrated.
              <details className="mb-10 rounded-2xl border border-border bg-surface p-5 lg:hidden">
                <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-trust-navy">
                  <List size={16} aria-hidden /> Contents
                </summary>
                <div className="mt-4">
                  <TableOfContents headings={headings} idPrefix="mobile" />
                </div>
              </details>
            )}

            <div className="lp-prose" dangerouslySetInnerHTML={{ __html: html }} />

            {book.file && (
              <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-border bg-[color:var(--lp-soft)] p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[16px] font-bold text-trust-navy">Prefer to read offline?</p>
                  <p className="mt-1 text-[14px] text-text-secondary">Download this guide as a PDF.</p>
                </div>
                <DownloadButton book={book} />
              </div>
            )}

            <div className="mt-12">
              <BlogCta />
            </div>
          </div>

          <aside className="hidden lg:block" aria-label="Contents">
            <div className="sticky top-24 flex flex-col gap-8">
              {headings.length > 1 && (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-secondary">Contents</p>
                  <div className="mt-4">
                    <TableOfContents headings={headings} idPrefix="desktop" />
                  </div>
                </div>
              )}
              {book.file && <DownloadButton book={book} className="w-full" />}
            </div>
          </aside>
        </div>
      </article>
    </>
  );
}
