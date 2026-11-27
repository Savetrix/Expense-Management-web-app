// POST /api/suggestions/similar — Smart Suggestions, steps 3 and 4, for the
// invoice screen: a new vendor's bill → the accounts similar past items from
// any vendor went to, and when those are missing or below Medium, the AI's
// picks after them (bankFeeds/aiPick.ts; kept per invoice, Low, never filled).
// Body: { vendorName, lines: string[], invoiceId?, amount?, currency? }.
// Answer: { picks }. With Auto-classification Off, nothing is sent anywhere.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { openAiEmbedder } from "@/lib/bankFeeds/embeddings";
import { loadMemory } from "@/lib/bankFeeds/similarSync";
import { readAutoClassification } from "@/lib/bankFeeds/suggest";
import { aiPicksForInvoice, openAiPicker } from "@/lib/bankFeeds/aiPick";
import { topPicks } from "@/lib/suggestions/picks";
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
    const vector = embedder && memory.length > 0 ? (await embedder.embed([text]))[0] : undefined;
    const similar = vector ? similarPicks({ vector, out: true }, memory) : [];
    if (similar[0] && similar[0].confidence !== "low") return json({ picks: similar });
    // Step 4: nothing similar enough. A failure or a timeout just leaves the picks as they are.
    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.slice(0, 64) : null;
    const amount = typeof body?.amount === "number" && Number.isFinite(body.amount) ? body.amount : null;
    const currency = typeof body?.currency === "string" ? body.currency.slice(0, 8) : null;
    const ai = await aiPicksForInvoice(ctx.db, ctx.connection.id, openAiPicker(), { invoiceId, vendorName, lines, amount, currency, vector }).catch(() => []);
    return json({ picks: topPicks(similar, ai) });
  } catch (error) {
    return errorResponse("similar", error);
  }
}
