// POST /api/suggestions/similar — Smart Suggestions, step 3, for the invoice
// screen: a new vendor's bill → the accounts similar past items from any
// vendor went to. Body: { vendorName, lines: string[] }. Answer: { picks }.
// With Auto-classification Off, nothing is sent to the embedder.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { openAiEmbedder } from "@/lib/bankFeeds/embeddings";
import { loadMemory } from "@/lib/bankFeeds/similarSync";
import { readAutoClassification } from "@/lib/bankFeeds/suggest";
import { invoiceText, similarPicks } from "@/lib/suggestions/similar";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const vendorName = typeof body?.vendorName === "string" ? body.vendorName.slice(0, 200) : "";
  const lines = Array.isArray(body?.lines) ? body.lines.filter((l): l is string => typeof l === "string").map((l) => l.slice(0, 300)).slice(0, 5) : [];
  const text = invoiceText({ vendorName, lines });
  if (!text) return fail(400, "Send the vendor name or line descriptions.");
  try {
    if ((await readAutoClassification(ctx.db, ctx.connection.id)) === "off") return json({ picks: [] });
    const embedder = openAiEmbedder();
    const memory = await loadMemory(ctx.db, ctx.connection.id);
    if (!embedder || memory.length === 0) return json({ picks: [] });
    const [vector] = await embedder.embed([text]);
    return json({ picks: similarPicks({ vector, out: true }, memory) });
  } catch (error) {
    return errorResponse("similar", error);
  }
}
