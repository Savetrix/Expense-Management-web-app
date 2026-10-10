import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, List } from "lucide-react";

import { BlogCta } from "@/components/blog/BlogCta";
import { CategoryChip, PostCard } from "@/components/blog/PostCard";
import { SignupLink } from "@/components/blog/SignupLink";
import {
  formatPostDate,
  getAllPosts,
  getPostBySlug,
  getRelatedPosts,
  toSummary,
  type BlogHeading,
} from "@/lib/blog";
import {
  absoluteUrl,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  jsonLdScriptProps,
  organizationJsonLd,
} from "@/lib/seo";

// Every post is prerendered at build time, and a slug that was not generated
// is a real 404 — never an on-demand render of a page that cannot exist.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} | Scantrix Blog`,
    description: post.description,
    keywords: post.tags,
    alternates: {
      canonical: post.href,
      // Restated: a page's `alternates` replaces the layout's wholesale, so
      // omitting this would drop the feed link from every article.
      types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Scantrix Blog" }] },
    },
    authors: [{ name: post.author }],
    openGraph: {
      type: "article",
      url: post.href,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      section: post.category,
      tags: post.tags,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

function TableOfContents({ headings, idPrefix }: { headings: BlogHeading[]; idPrefix: string }) {
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

/** Plain share URLs: no widgets, no third-party script, nothing that tracks readers. */
function ShareLinks({ title, url }: { title: string; url: string }) {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const links = [
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { label: "X", href: `https://x.com/intent/post?url=${encodedUrl}&text=${encodedTitle}` },
    { label: "Email", href: `mailto:?subject=${encodedTitle}&body=${encodedUrl}` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[13px] font-semibold text-text-secondary">Share</span>
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          {...(link.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-trust-navy transition-colors hover:border-[color:var(--lp-teal)] hover:bg-[color:var(--lp-teal-050)]"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const related = getRelatedPosts(post.slug, 2);
  const url = absoluteUrl(post.href);

  return (
    <>
      <script {...jsonLdScriptProps(organizationJsonLd)} />
      <script {...jsonLdScriptProps(blogPostingJsonLd(post))} />
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.title, path: post.href },
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
                  <Link href="/blog" className="hover:text-trust-navy">Blog</Link>
                </li>
                <li aria-hidden><ChevronRight size={14} /></li>
                <li aria-current="page" className="max-w-[16rem] truncate text-trust-navy sm:max-w-md">
                  {post.title}
                </li>
              </ol>
            </nav>

            <div className="mt-8 max-w-3xl">
              <CategoryChip category={post.category} />
              <h1 className="mt-4 text-[clamp(2rem,4.6vw,3.1rem)] font-bold leading-[1.08] tracking-[-0.025em] text-trust-navy">
                {post.title}
              </h1>
              <p className="mt-5 text-[18px] leading-relaxed text-text-secondary">{post.description}</p>
              <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium text-text-secondary">
                <span className="text-trust-navy">{post.author}</span>
                <span aria-hidden>·</span>
                <time dateTime={post.publishedAt}>{post.publishedLabel}</time>
                {post.updatedAt && post.updatedAt !== post.publishedAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      Updated <time dateTime={post.updatedAt}>{formatPostDate(post.updatedAt)}</time>
                    </span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>{post.readingMinutes} min read</span>
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-12 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-16">
          <div className="min-w-0">
            {post.headings.length > 1 && (
              // <details> needs no JavaScript, so the contents work for every
              // reader and crawler, not just once the page has hydrated.
              <details className="mb-10 rounded-2xl border border-border bg-surface p-5 lg:hidden">
                <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-trust-navy">
                  <List size={16} aria-hidden /> On this page
                </summary>
                <div className="mt-4">
                  <TableOfContents headings={post.headings} idPrefix="mobile" />
                </div>
              </details>
            )}

            <div className="lp-prose" dangerouslySetInnerHTML={{ __html: post.html }} />

            <div className="mt-12 border-t border-border pt-8">
              <ShareLinks title={post.title} url={url} />
            </div>

            <div className="mt-12">
              <BlogCta />
            </div>
          </div>

          <aside className="hidden lg:block" aria-label="On this page">
            <div className="sticky top-24 flex flex-col gap-8">
              {post.headings.length > 1 && (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                    On this page
                  </p>
                  <div className="mt-4">
                    <TableOfContents headings={post.headings} idPrefix="desktop" />
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-border bg-[color:var(--lp-soft)] p-5">
                <p className="text-[14.5px] font-bold leading-snug text-trust-navy">
                  Post bills to QuickBooks without the typing.
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                  14-day free trial. No credit card.
                </p>
                <SignupLink className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-[color:var(--lp-navy)] text-[14px] font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-md">
                  Start free
                </SignupLink>
              </div>
            </div>
          </aside>
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="border-t border-border bg-[color:var(--lp-soft)]">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
            <div className="flex items-end justify-between gap-4">
              <h2 id="related-heading" className="text-[clamp(1.4rem,2.6vw,1.8rem)] font-bold tracking-[-0.02em] text-trust-navy">
                Keep reading
              </h2>
              <Link href="/blog" className="text-[14px] font-semibold text-[color:var(--lp-teal-700)] hover:text-trust-navy">
                All articles
              </Link>
            </div>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {related.map((item) => (
                <PostCard key={item.slug} post={toSummary(item)} headingLevel="h3" />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
