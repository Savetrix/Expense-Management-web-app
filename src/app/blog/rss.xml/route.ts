import { getAllPosts } from "@/lib/blog";
import { BLOG_DESCRIPTION, BLOG_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";

// RSS 2.0 feed at /blog/rss.xml, generated once at build time.
//
// RSS still matters for this audience: feed readers, LinkedIn and newsletter
// tools, and Slack's /feed all subscribe to it, and it is a second path for
// search engines to discover new posts beyond the sitemap.
export const dynamic = "force-static";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC 822, which RSS requires. Posts carry calendar dates, so midnight UTC. */
const rfc822 = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

export function GET() {
  const posts = getAllPosts();
  const feedUrl = absoluteUrl("/blog/rss.xml");
  const lastBuild = posts[0] ? rfc822(posts[0].updatedAt ?? posts[0].publishedAt) : new Date().toUTCString();

  const items = posts
    .map((post) => {
      const link = absoluteUrl(post.href);
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${rfc822(post.publishedAt)}</pubDate>
      <description>${escapeXml(post.description)}</description>
      <category>${escapeXml(post.category)}</category>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(BLOG_NAME)}</title>
    <link>${escapeXml(`${SITE_URL}/blog`)}</link>
    <description>${escapeXml(BLOG_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
