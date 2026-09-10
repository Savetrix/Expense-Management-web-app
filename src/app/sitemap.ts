import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

// Only genuinely indexable URLs belong here. Listing a noindex page in a
// sitemap asks a crawler to fetch something it is then told to drop, which is
// how a sitemap loses the crawler's trust — so this is deliberately one entry.
// It grows as the marketing pages in SEO-AUDIT.md's open-questions list are
// signed off and built.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
