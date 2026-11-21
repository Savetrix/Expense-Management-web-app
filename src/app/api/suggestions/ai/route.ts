// POST /api/suggestions/ai — Smart Suggestions, step 4, for one bank line that
// is opened without a suggestion (bankFeeds/aiPick.ts): asks the AI once, saves
// the answer on the line and re-scores it. Body: { lineId }. A line with an
// answer that still holds is not asked again. With Auto-classification Off
// nothing is sent. Answer: { changed } (true: reload the line).
import { openAiPicker, runAiPicks } from "@/lib/bankFeeds/aiPick";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { refreshSuggestions } from "@/lib/bankFeeds/suggest";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const lineId = typeof body?.lineId === "string" ? body.lineId.slice(0, 100) : "";
  if (!lineId) return fail(400, "Say which line.");
  try {
    const company = ctx.connection.id;
    const outcome = await runAiPicks(ctx.db, company, openAiPicker(), { lineIds: [lineId], maxCalls: 1, refresh: (keys) => refreshSuggestions(ctx.db, company, keys) });
    return json({ changed: outcome.keys.length > 0, skipped: outcome.skipped ?? null });
  } catch (error) {
    return errorResponse("ai pick", error);
  }
}
