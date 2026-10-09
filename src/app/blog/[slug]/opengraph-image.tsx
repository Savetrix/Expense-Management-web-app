import { ImageResponse } from "next/og";

import { getAllPosts, getPostBySlug } from "@/lib/blog";

// Per-post share card, so a guide pasted into LinkedIn or Slack shows its own
// title rather than the homepage's. Same palette and satori constraints as
// src/app/opengraph-image.tsx: every multi-child element needs display:flex,
// and only the system font stack is used so the build stays offline-safe.
//
// Prerendered alongside the page for every generated slug.

export const alt = "Scantrix Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

const NAVY = "#1f3a5f";
const NAVY_DEEP = "#132741";
const TEAL = "#1fb6aa";

export default async function PostOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const title = post?.title ?? "Scantrix Blog";
  // Long titles step down a size instead of overflowing the card.
  const titleSize = title.length > 52 ? 58 : 66;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: `linear-gradient(165deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: TEAL, display: "flex" }} />
            <div style={{ fontSize: 34, fontWeight: 700, color: "#ffffff" }}>Scantrix Blog</div>
          </div>
          {post && (
            <div
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                border: "2px solid rgba(255,255,255,0.18)",
                color: TEAL,
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              {post.category}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: titleSize,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.025em",
            color: "#ffffff",
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: TEAL, display: "flex" }} />
          <div style={{ fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
            {post ? `${post.readingMinutes} min read · scantrix.ai/blog` : "scantrix.ai/blog"}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
