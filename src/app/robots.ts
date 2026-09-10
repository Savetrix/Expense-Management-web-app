import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

// Everything under (app) is either an authenticated view or a transient auth
// screen: it returns 200 with a shell a crawler cannot use, and indexing it
// would spend crawl budget on near-identical empty pages. Those routes already
// carry noindex from src/app/(app)/layout.tsx — this keeps them out of the
// fetch queue in the first place. /api is server-only.
//
// Disallow-listed by path prefix rather than by route-group name, because
// route groups do not appear in URLs.
const DISALLOWED = [
  "/api/",
  "/accounting-software",
  "/dashboard",
  "/forgot-password",
  "/gl-tax-codes",
  "/google-drive",
  "/invite/",
  "/invoices",
  "/login",
  "/paywall",
  "/plans",
  "/preferences",
  "/profile",
  "/quickbooks",
  "/register",
  "/subscription",
  "/team",
  "/vendors",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
