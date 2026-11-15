// POST /api/suggestions/similar/sync — Smart Suggestions, step 3: brings the
// company's meaning vectors in step with its memory (bank lines a person coded,
// its QuickBooks history, bills a person posted, and lines to review), then
// re-scores the lines to review. The bank page calls it when it opens and after
// an import. With Auto-classification Off nothing is sent to the embedder.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { openAiEmbedder } from "@/lib/bankFeeds/embeddings";
import { scantrixInvoices } from "@/lib/bankFeeds/ledger/backend";
import { syncVectors } from "@/lib/bankFeeds/similarSync";
import { refreshSuggestions } from "@/lib/bankFeeds/suggest";

export const runtime = "nodejs";
export const maxDuration = 300;

/** One sync per company every 30 seconds on this server. */
const MIN_GAP_MS = 30_000;
const lastRun = new Map<string, number>();

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const company = ctx.connection.id;
  if (Date.now() - (lastRun.get(company) ?? 0) < MIN_GAP_MS) return json({ skipped: "recent" });
  lastRun.set(company, Date.now());
  try {
    // Bills a person posted are memory too. If the list can't be read, the bill vectors stay as they were.
    const invoices = await scantrixInvoices(ctx.caller.accessToken, company).then(
      (all) => all.filter((i) => i.byPerson && i.billId && i.glAccountId),
      () => undefined,
    );
    const outcome = await syncVectors(ctx.db, company, openAiEmbedder(), { invoices });
    if (!outcome.skipped && outcome.embedded > 0) await refreshSuggestions(ctx.db, company);
    return json(outcome);
  } catch (error) {
    lastRun.delete(company);
    return errorResponse("similar sync", error);
  }
}
