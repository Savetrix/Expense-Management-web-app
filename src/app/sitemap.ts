import type { MetadataRoute } from "next";

import { getAllPosts } from "@/lib/blog";
import { absoluteUrl } from "@/lib/seo";

// Only genuinely indexable URLs belong here. Listing a noindex page in a
// sitemap asks a crawler to fetch something it is then told to drop, which is
// how a sitemap loses the crawler's trust. The homepage, the blog index and
// every published post; drafts never appear (getAllPosts excludes them).
//
// Post dates are the post's own publish/update date, never the build time: a
// lastModified that changes on every deploy teaches crawlers to ignore it.
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const changed = (post: (typeof posts)[number]) => post.updatedAt ?? post.publishedAt;
  // The index changes whenever any post does, including a revision to an old one.
  const lastBlogChange = posts.map(changed).sort().at(-1);

  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...(lastBlogChange
      ? [
          {
            url: absoluteUrl("/blog"),
            lastModified: new Date(`${lastBlogChange}T00:00:00Z`),
            changeFrequency: "weekly" as const,
            priority: 0.8,
          },
        ]
      : []),
    ...posts.map((post) => ({
      url: absoluteUrl(post.href),
      lastModified: new Date(`${changed(post)}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
