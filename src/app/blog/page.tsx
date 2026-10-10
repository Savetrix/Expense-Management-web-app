import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BlogCta } from "@/components/blog/BlogCta";
import { CategoryChip, PostCard, PostMeta } from "@/components/blog/PostCard";
import { SectionLabel } from "@/components/landing/primitives";
import { getAllPosts, getFeaturedPost, toSummary } from "@/lib/blog";
import {
  BLOG_DESCRIPTION,
  blogJsonLd,
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from "@/lib/seo";

export const metadata: Metadata = {
  title: "Accounts Payable & QuickBooks Guides | Scantrix Blog",
  description: BLOG_DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Scantrix Blog" }] },
  },
  openGraph: {
    type: "website",
    url: "/blog",
    title: "Scantrix Blog",
    description: BLOG_DESCRIPTION,
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const featured = getFeaturedPost();
  const rest = posts.filter((post) => post.slug !== featured?.slug);

  return (
    <>
      <script {...jsonLdScriptProps(blogJsonLd(posts))} />
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
          ]),
        )}
      />

      <div className="relative overflow-hidden border-b border-border bg-[color:var(--lp-soft)]">
        <div className="lp-dotgrid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <header className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <SectionLabel>Blog</SectionLabel>
          <h1 className="mt-4 max-w-3xl text-[clamp(2.1rem,5vw,3.4rem)] font-bold leading-[1.05] tracking-[-0.03em] text-trust-navy">
            Guides for faster, cleaner accounts payable.
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-text-secondary">
            Practical advice on bill entry, month-end and QuickBooks Online for
            accountants and finance teams, useful whether or not you use Scantrix.
          </p>
        </header>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
        {posts.length === 0 ? (
          <p className="text-[16px] text-text-secondary">New articles are on their way.</p>
        ) : (
          <>
            {featured && (
              <Link
                href={featured.href}
                className="group grid gap-6 rounded-3xl border border-border bg-surface p-7 shadow-sm transition-all hover:border-[color:var(--lp-teal)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                      Featured
                    </span>
                    <CategoryChip category={featured.category} />
                  </div>
                  <h2 className="mt-4 text-[clamp(1.6rem,3.2vw,2.3rem)] font-bold leading-[1.12] tracking-[-0.02em] text-trust-navy group-hover:text-[color:var(--lp-teal-700)]">
                    {featured.title}
                  </h2>
                  <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-text-secondary">
                    {featured.description}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <PostMeta post={featured} />
                    <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[color:var(--lp-teal-700)]">
                      Read the guide
                      <ArrowRight size={16} strokeWidth={2.25} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
                {/* What the guide covers, straight from its own sections. */}
                {featured.headings.length > 0 && (
                  <div className="rounded-2xl border border-border bg-[color:var(--lp-soft)] p-6">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                      In this guide
                    </p>
                    <ul className="mt-3 flex flex-col gap-2.5">
                      {featured.headings.slice(0, 6).map((heading) => (
                        <li key={heading.id} className="flex gap-2.5 text-[14px] leading-snug text-trust-navy">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lp-teal)]" aria-hidden />
                          {heading.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Link>
            )}

            {rest.length > 0 && (
              <section aria-labelledby="latest-heading" className="mt-14">
                <h2 id="latest-heading" className="text-[13px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Latest articles
                </h2>
                {/* Three columns only once there are three cards to fill them; two
                    cards in a three-column grid leave an empty slot. */}
                <div className={`mt-6 grid gap-5 md:grid-cols-2 ${rest.length >= 3 ? "lg:grid-cols-3" : ""}`}>
                  {rest.map((post) => (
                    <PostCard key={post.slug} post={toSummary(post)} headingLevel="h3" />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <div className="mt-16">
          <BlogCta />
        </div>
      </div>
    </>
  );
}
