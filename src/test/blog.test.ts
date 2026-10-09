// The blog's content rules, rendering safety, and link integrity.
//
// These run on every `npm test`, so a new post that breaks a rule, links to a
// page that doesn't exist, or makes a product claim the code doesn't support is
// caught before review rather than after it is indexed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";

import { POST_SOURCES } from "../content/blog";
import {
  formatPostDate,
  getAllPosts,
  getFeaturedPost,
  getRelatedPosts,
  renderMarkdown,
  slugifyHeading,
  validatePostSource,
  type BlogPostSource,
} from "../lib/blog";

const CONTENT_DIR = join(process.cwd(), "src/content/blog");

const validSource = (overrides: Partial<BlogPostSource> = {}): BlogPostSource => ({
  slug: "a-valid-post",
  title: "A perfectly valid post title",
  description: "A description that is comfortably long enough to pass the fifty character minimum.",
  publishedAt: "2026-09-30",
  category: "QuickBooks",
  tags: ["Testing"],
  author: "Scantrix Team",
  body: "## Section\n\n" + "word ".repeat(320),
  ...overrides,
});

describe("blog content", () => {
  it("every registered post passes validation", () => {
    for (const source of POST_SOURCES) {
      assert.deepEqual(validatePostSource(source), [], `problems in ${source.slug}`);
    }
  });

  it("registers every post file, and each file is named after its slug", () => {
    const files = readdirSync(CONTENT_DIR)
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .map((file) => basename(file, ".ts"))
      .sort();
    const registered = POST_SOURCES.map((source) => source.slug).sort();
    assert.deepEqual(registered, files, "a post file exists that is not in src/content/blog/index.ts, or vice versa");
  });

  it("has unique slugs, titles and meta descriptions", () => {
    for (const field of ["slug", "title", "description"] as const) {
      const values = POST_SOURCES.map((source) => source[field]);
      assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
    }
  });

  it("loads published posts newest first", () => {
    const posts = getAllPosts();
    assert.ok(posts.length > 0);
    for (let i = 1; i < posts.length; i += 1) {
      assert.ok(posts[i - 1].publishedAt >= posts[i].publishedAt, "posts out of date order");
    }
    for (const post of posts) {
      assert.ok(post.headings.length > 0, `${post.slug} has no ## sections for the table of contents`);
      assert.ok(post.readingMinutes >= 1);
    }
  });

  it("every internal link resolves to a real page or homepage section", () => {
    const slugs = new Set(getAllPosts().map((post) => post.slug));
    // Section ids read from the homepage source, so renaming a section there
    // fails this test instead of silently breaking links in old posts.
    const landing = readFileSync(join(process.cwd(), "src/components/landing/LandingPage.tsx"), "utf8");
    const sections = new Set([...landing.matchAll(/<section id="([a-z-]+)"/g)].map((m) => m[1]));
    const pages = new Set(["/", "/blog", "/register", "/login"]);

    for (const post of getAllPosts()) {
      for (const [, href] of post.html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        if (href.startsWith("#")) {
          assert.ok(post.headings.some((h) => `#${h.id}` === href) || post.html.includes(`id="${href.slice(1)}"`),
            `${post.slug}: in-page link ${href} has no target`);
          continue;
        }
        const [path, hash] = href.split("#");
        if (path.startsWith("/blog/")) {
          assert.ok(slugs.has(path.slice("/blog/".length)), `${post.slug}: links to missing post ${href}`);
        } else {
          assert.ok(pages.has(path), `${post.slug}: links to unknown page ${href}`);
        }
        if (hash && path === "/") {
          assert.ok(sections.has(hash), `${post.slug}: links to missing homepage section #${hash}`);
        }
      }
    }
  });

  // SEO-AUDIT.md §3 records three product claims the code does not support:
  // catching duplicate invoices, merging duplicate vendors, and an assistant
  // that finds duplicates. Posts may discuss duplicates as a problem, with
  // manual controls, but no sentence may attribute that ability to Scantrix.
  it("never attributes duplicate detection or vendor merging to Scantrix", () => {
    for (const source of POST_SOURCES) {
      const sentences = source.body.split(/(?<=[.!?])\s+|\n+/);
      for (const sentence of sentences) {
        if (!/scantrix/i.test(sentence)) continue;
        assert.ok(!/duplicat|merg(e|ing)/i.test(sentence), `${source.slug}: unsupported claim — "${sentence.trim()}"`);
      }
    }
  });
});

describe("blog validation", () => {
  const problems = (overrides: Partial<BlogPostSource>) => validatePostSource(validSource(overrides));

  it("accepts a valid post", () => {
    assert.deepEqual(problems({}), []);
  });

  it("rejects malformed slugs", () => {
    for (const slug of ["Has-Caps", "trailing-", "double--hyphen", "spa ce", ""]) {
      assert.ok(problems({ slug }).length > 0, `accepted slug "${slug}"`);
    }
  });

  it("rejects impossible and out-of-order dates", () => {
    assert.ok(problems({ publishedAt: "2026-02-31" }).length > 0, "accepted Feb 31");
    assert.ok(problems({ publishedAt: "30/09/2026" }).length > 0);
    assert.ok(problems({ updatedAt: "2026-09-01" }).length > 0, "accepted update before publish");
  });

  it("rejects descriptions search results would truncate or that are too thin", () => {
    assert.ok(problems({ description: "Too short." }).length > 0);
    assert.ok(problems({ description: "x".repeat(161) }).length > 0);
  });

  it("rejects an H1 in the body, images without alt text, and thin content", () => {
    assert.ok(problems({ body: "# Second title\n\n" + "word ".repeat(320) }).length > 0);
    assert.ok(problems({ body: "![](/x.png)\n\n" + "word ".repeat(320) }).length > 0);
    assert.ok(problems({ body: "## Short\n\nOnly a few words." }).length > 0);
  });

  it("rejects an unknown category and missing tags", () => {
    assert.ok(problems({ category: "Gossip" as BlogPostSource["category"] }).length > 0);
    assert.ok(problems({ tags: [] }).length > 0);
  });
});

describe("blog rendering", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const { html } = renderMarkdown('Hello <script>alert("x")</script> <img src=x onerror=alert(1)>');
    assert.ok(!html.includes("<script"), "script tag rendered");
    assert.ok(!html.includes("<img src=x"), "raw img rendered");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("opens external links safely and keeps internal links in the tab", () => {
    const { html } = renderMarkdown("[out](https://example.com) and [in](/blog/x)");
    assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">out<\/a>/);
    assert.match(html, /<a href="\/blog\/x">in<\/a>/);
  });

  it("gives every heading a unique id and collects ## headings for the contents", () => {
    const { html, headings } = renderMarkdown("## Step one\n\ntext\n\n## Step one\n\n### Detail\n\n## Q&A: tax **codes**");
    assert.deepEqual(headings.map((h) => h.id), ["step-one", "step-one-2", "q-a-tax-codes"]);
    assert.deepEqual(headings.map((h) => h.text), ["Step one", "Step one", "Q&A: tax codes"]);
    assert.match(html, /<h3 id="detail">/);
  });

  it("does not leak heading ids between documents", () => {
    renderMarkdown("## Same");
    assert.deepEqual(renderMarkdown("## Same").headings.map((h) => h.id), ["same"]);
  });

  it("wraps tables so they scroll instead of widening the page", () => {
    const { html } = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    assert.match(html, /<div class="lp-prose-table"><table>/);
    assert.match(html, /<\/table><\/div>/);
  });

  it("slugifies headings to ASCII", () => {
    assert.equal(slugifyHeading("Café & crème: 100% sure"), "cafe-creme-100-sure");
    assert.equal(slugifyHeading("!!!"), "section");
  });

  it("formats dates as calendar dates regardless of time zone", () => {
    assert.equal(formatPostDate("2026-09-30"), "September 30, 2026");
    assert.equal(formatPostDate("2026-01-01"), "January 1, 2026");
  });
});

describe("blog navigation", () => {
  it("features a pinned post", () => {
    const featured = getFeaturedPost();
    assert.ok(featured);
    const pinned = getAllPosts().find((post) => post.featured);
    if (pinned) assert.equal(featured.slug, pinned.slug);
  });

  it("suggests related posts other than the current one", () => {
    for (const post of getAllPosts()) {
      const related = getRelatedPosts(post.slug, 2);
      assert.ok(!related.some((item) => item.slug === post.slug));
      assert.ok(related.length <= 2);
    }
  });
});
