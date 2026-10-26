// The e-book PDF, handed out only to visitors who have given their details.
//
// The PDFs live in private/ebooks/, outside public/, so there is no URL that
// serves one without passing through here. A visitor without the access cookie
// is sent to the reading page with the sign-up form already open.
export const runtime = "nodejs";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { EBOOKS } from "@/content/ebooks";
import { hasEbookAccess } from "@/lib/ebookLeads/access";

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  // The slug is only ever compared against our own list, never used to build a
  // path. The filename comes from that list, so nothing a visitor sends can
  // reach the filesystem.
  const ebook = EBOOKS.find((book) => book.slug === slug);
  if (!ebook?.file) return new Response("Not found", { status: 404 });

  if (!(await hasEbookAccess())) {
    return Response.redirect(new URL(`/ebooks/${ebook.slug}?gate=download`, request.url), 307);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "private", "ebooks", ebook.file));
  } catch {
    console.log(`[ebook-download] file missing for ${ebook.slug}`);
    return new Response("This e-book is temporarily unavailable.", { status: 500 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ebook.slug}.pdf"`,
      "Content-Length": String(bytes.length),
      // Per-visitor and gated: never let a shared cache hand it to someone else.
      "Cache-Control": "private, no-store",
    },
  });
}
