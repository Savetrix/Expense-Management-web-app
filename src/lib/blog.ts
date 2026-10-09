// The blog: post registry, validation, and Markdown rendering.
//
// ── WHERE POSTS LIVE ─────────────────────────────────────────────────────────
// One TypeScript file per post in src/content/blog, registered in that folder's
// index.ts. Each file exports its metadata alongside a Markdown `body`.
//
// Why TypeScript modules rather than .md files read with `fs`:
//   * Metadata is type-checked. A post missing its date or using a category
//     that does not exist fails `tsc`, not a reader.
//   * Nothing touches the filesystem at request time. Every blog route is
//     prerendered, but a module import also keeps working in any runtime (the
//     Open Graph image route included) without relying on file tracing to
//     copy a content folder into the serverless bundle.
//   * The Markdown itself stays plain Markdown — writers never see JSX.
//
// ── TRUST MODEL ──────────────────────────────────────────────────────────────
// Posts are authored in this repository and reviewed like code, but the
// renderer still escapes raw HTML instead of passing it through. A pasted
// snippet from an email or a CMS can therefore never inject markup or script
// into a page that search engines and prospects read.
//
// Server-only in practice: the landing page (a client component) receives
// plain summaries as props and imports nothing from here but types.
import { Marked, type Tokens } from "marked";

import { POST_SOURCES } from "@/content/blog";

export const BLOG_CATEGORIES = ["QuickBooks", "Accounts payable", "Workflow"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/** What a post file declares. */
export interface BlogPostSource {
  /** URL segment: lowercase words joined by single hyphens. Never change once published. */
  slug: string;
  /** The H1 and the basis of the <title>. At most 70 characters. */
  title: string;
  /** Meta description and card excerpt. 50–160 characters so search results don't truncate it. */
  description: string;
  /** YYYY-MM-DD, interpreted as a calendar date (UTC). */
  publishedAt: string;
  /** YYYY-MM-DD. Set only for a substantive revision; drives dateModified and the sitemap. */
  updatedAt?: string;
  category: BlogCategory;
  /** 1–6 short topical tags. Used for keywords and the feed, not for tag pages. */
  tags: string[];
  author: string;
  /** Pin to the top of the blog index. The newest featured post wins. */
  featured?: boolean;
  /** Hidden everywhere except `next dev`, so a post can be previewed before it ships. */
  draft?: boolean;
  /** Markdown. No H1 (the title is the H1); start sections at `##`. */
  body: string;
}

export interface BlogHeading {
  id: string;
  text: string;
}

/** The serialisable card shape — safe to pass to client components. */
export interface BlogPostSummary {
  slug: string;
  href: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string | null;
  /** Pre-formatted on the server, so client components never need the formatter. */
  publishedLabel: string;
  category: BlogCategory;
  readingMinutes: number;
}

export interface BlogPost extends BlogPostSummary {
  tags: string[];
  author: string;
  featured: boolean;
  html: string;
  /** The `##` sections, in order — the table of contents. */
  headings: BlogHeading[];
  wordCount: number;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORDS_PER_MINUTE = 230;
/** Below this a page is thin content, which search engines discount site-wide. */
const MIN_WORDS = 300;

// ==============================
// VALIDATION
// ==============================

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Rejects 2026-02-31, which Date would silently roll into March.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Every rule a post must satisfy, as human-readable problems.
 *
 * Exported for the test suite, and enforced at load time too: a post that
 * breaks one of these fails the build instead of shipping half-broken.
 */
export function validatePostSource(post: BlogPostSource): string[] {
  const problems: string[] = [];
  const where = `blog post "${post.slug || "(no slug)"}"`;

  if (!SLUG_PATTERN.test(post.slug)) {
    problems.push(`${where}: slug must be lowercase words joined by single hyphens`);
  }
  const title = post.title?.trim() ?? "";
  if (title.length < 10 || title.length > 70) {
    problems.push(`${where}: title must be 10–70 characters (is ${title.length})`);
  }
  const description = post.description?.trim() ?? "";
  if (description.length < 50 || description.length > 160) {
    problems.push(`${where}: description must be 50–160 characters (is ${description.length})`);
  }
  if (!isRealDate(post.publishedAt)) {
    problems.push(`${where}: publishedAt must be a real YYYY-MM-DD date`);
  }
  if (post.updatedAt !== undefined) {
    if (!isRealDate(post.updatedAt)) {
      problems.push(`${where}: updatedAt must be a real YYYY-MM-DD date`);
    } else if (post.updatedAt < post.publishedAt) {
      problems.push(`${where}: updatedAt is earlier than publishedAt`);
    }
  }
  if (!(BLOG_CATEGORIES as readonly string[]).includes(post.category)) {
    problems.push(`${where}: unknown category "${post.category}"`);
  }
  if (!Array.isArray(post.tags) || post.tags.length < 1 || post.tags.length > 6) {
    problems.push(`${where}: needs 1–6 tags`);
  } else if (post.tags.some((tag) => !tag.trim())) {
    problems.push(`${where}: tags must not be empty`);
  }
  if (!post.author?.trim()) problems.push(`${where}: author is required`);

  const body = post.body ?? "";
  if (/^#\s/m.test(body)) {
    problems.push(`${where}: body must not contain an H1 ("# ") — the title is the page's H1`);
  }
  if (/!\[\s*\]\(/.test(body)) {
    problems.push(`${where}: every image needs alt text`);
  }
  const words = countWords(body);
  if (words < MIN_WORDS) {
    problems.push(`${where}: body is ${words} words; at least ${MIN_WORDS} are required`);
  }
  return problems;
}

// ==============================
// RENDERING
// ==============================

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Heading text → URL fragment. ASCII only, so links survive copy-paste anywhere. */
export function slugifyHeading(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&[a-z]+;/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function countWords(markdown: string): number {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|~-]+/g, " ");
  return text.split(/\s+/).filter(Boolean).length;
}

const isExternal = (href: string) => /^https?:\/\//i.test(href);

/**
 * Markdown → HTML, collecting the `##` headings for the table of contents.
 *
 * A fresh Marked instance per call: heading ids are de-duplicated per document,
 * and a shared instance would leak that state from one post into the next.
 */
export function renderMarkdown(markdown: string): { html: string; headings: BlogHeading[] } {
  const headings: BlogHeading[] = [];
  const usedIds = new Map<string, number>();

  const uniqueId = (base: string) => {
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens, this.parser.textRenderer);
        const id = uniqueId(slugifyHeading(text));
        if (depth === 2) headings.push({ id, text });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        // External links open in a new tab and pass no referrer or window
        // handle; internal ones stay in the tab so the visitor's path through
        // the site is a normal navigation.
        const external = isExternal(href)
          ? ' target="_blank" rel="noopener noreferrer"'
          : "";
        return `<a href="${escapeHtml(href)}"${titleAttr}${external}>${label}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy" decoding="async" />`;
      },
      // Raw HTML — block or inline — is shown as text, never interpreted.
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
    },
  });

  const html = (marked.parse(markdown) as string)
    // Wide tables scroll inside their own box instead of widening the page.
    .replace(/<table>/g, '<div class="lp-prose-table"><table>')
    .replace(/<\/table>/g, "</table></div>");

  return { html, headings };
}

// ==============================
// REGISTRY
// ==============================

// Drafts are visible in `next dev` only — never in a build, a test, or production.
const SHOW_DRAFTS = process.env.NODE_ENV === "development";

function toPost(source: BlogPostSource): BlogPost {
  const { html, headings } = renderMarkdown(source.body);
  const wordCount = countWords(source.body);
  return {
    slug: source.slug,
    href: `/blog/${source.slug}`,
    title: source.title.trim(),
    description: source.description.trim(),
    publishedAt: source.publishedAt,
    updatedAt: source.updatedAt ?? null,
    publishedLabel: formatPostDate(source.publishedAt),
    category: source.category,
    readingMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
    tags: source.tags.map((tag) => tag.trim()),
    author: source.author.trim(),
    featured: Boolean(source.featured),
    html,
    headings,
    wordCount,
  };
}

let cache: BlogPost[] | null = null;

/**
 * Every published post, newest first.
 *
 * Throws on any invalid post or duplicate slug. That is deliberate: this runs
 * during `next build`, so a broken post stops the deploy rather than going
 * live with a missing date or a truncated description.
 */
export function getAllPosts(): BlogPost[] {
  if (cache) return cache;

  const problems = POST_SOURCES.flatMap(validatePostSource);
  const seen = new Set<string>();
  for (const source of POST_SOURCES) {
    if (seen.has(source.slug)) problems.push(`duplicate blog slug "${source.slug}"`);
    seen.add(source.slug);
  }
  if (problems.length > 0) {
    throw new Error(`Invalid blog content:\n  - ${problems.join("\n  - ")}`);
  }

  cache = POST_SOURCES.filter((source) => SHOW_DRAFTS || !source.draft)
    .map(toPost)
    // Newest first; posts sharing a date keep their order in the registry.
    .map((post, index) => ({ post, index }))
    .sort((a, b) =>
      a.post.publishedAt === b.post.publishedAt
        ? a.index - b.index
        : b.post.publishedAt.localeCompare(a.post.publishedAt),
    )
    .map(({ post }) => post);
  return cache;
}

export function getPostBySlug(slug: string): BlogPost | null {
  return getAllPosts().find((post) => post.slug === slug) ?? null;
}

/** The post pinned to the top of the index: the newest featured one, else the newest. */
export function getFeaturedPost(): BlogPost | null {
  const posts = getAllPosts();
  return posts.find((post) => post.featured) ?? posts[0] ?? null;
}

/** Same category first, then the most recent of the rest. */
export function getRelatedPosts(slug: string, limit = 2): BlogPost[] {
  const posts = getAllPosts().filter((post) => post.slug !== slug);
  const current = getPostBySlug(slug);
  if (!current) return posts.slice(0, limit);
  const sameCategory = posts.filter((post) => post.category === current.category);
  const others = posts.filter((post) => post.category !== current.category);
  return [...sameCategory, ...others].slice(0, limit);
}

export function toSummary(post: BlogPost): BlogPostSummary {
  return {
    slug: post.slug,
    href: post.href,
    title: post.title,
    description: post.description,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    publishedLabel: post.publishedLabel,
    category: post.category,
    readingMinutes: post.readingMinutes,
  };
}

export function getLatestPostSummaries(limit = 3): BlogPostSummary[] {
  return getAllPosts().slice(0, limit).map(toSummary);
}

/**
 * "September 30, 2026". Formatted in UTC because the date is a calendar date:
 * formatting it in the reader's zone would show the day before for anyone west
 * of Greenwich, and a server/client zone difference would break hydration.
 */
export function formatPostDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}
