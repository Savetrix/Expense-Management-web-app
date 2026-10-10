import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { BlogPostSummary } from "@/lib/blog";

export function CategoryChip({ category }: { category: string }) {
  return (
    <span className="w-fit rounded-pill bg-[color:var(--lp-teal-050)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--lp-teal-700)]">
      {category}
    </span>
  );
}

export function PostMeta({ post }: { post: Pick<BlogPostSummary, "publishedAt" | "publishedLabel" | "readingMinutes"> }) {
  return (
    <span className="text-[12.5px] font-medium text-text-secondary">
      <time dateTime={post.publishedAt}>{post.publishedLabel}</time> · {post.readingMinutes} min read
    </span>
  );
}

/**
 * One post in a grid. The whole card is the link, with the title as its
 * accessible name, so there is exactly one tab stop per post.
 */
export function PostCard({ post, headingLevel = "h2" }: { post: BlogPostSummary; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <Link
      href={post.href}
      className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[color:var(--lp-teal)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)]"
    >
      <CategoryChip category={post.category} />
      <Heading className="mt-4 text-[17.5px] font-bold leading-snug tracking-[-0.01em] text-trust-navy group-hover:text-[color:var(--lp-teal-700)]">
        {post.title}
      </Heading>
      <p className="mt-2 line-clamp-3 flex-1 text-[14px] leading-relaxed text-text-secondary">
        {post.description}
      </p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <PostMeta post={post} />
        <ArrowRight
          size={16}
          strokeWidth={2.25}
          aria-hidden
          className="shrink-0 text-[color:var(--lp-teal-700)] transition-transform group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}
