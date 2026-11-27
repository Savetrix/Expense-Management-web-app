// POST /api/suggestions/similar/sync — Smart Suggestions, step 3: brings the
// company's meaning vectors in step with its memory (bank lines a person coded,
// its QuickBooks history, bills a person posted, and lines to review), then
// re-scores the lines to review. Then step 4 (bankFeeds/aiPick.ts) for new
// lines steps 2 and 3 have nothing for; a saved answer is reused, so this asks
// the AI only about lines it hasn't seen. The bank page calls it when it opens
// and after an import. With Auto-classification Off nothing is sent anywhere.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { openAiEmbedder } from "@/lib/bankFeeds/embeddings";
import { scantrixInvoices } from "@/lib/bankFeeds/ledger/backend";
import { chartFor, readLists, vendorsFor } from "@/lib/bankFeeds/companyLists";
import { syncChanged, syncVectors } from "@/lib/bankFeeds/similarSync";
import { openAiLabeller } from "@/lib/bankFeeds/shopKind";
import { refreshSuggestions, scoredUnderOldRules } from "@/lib/bankFeeds/suggest";
import { openAiPicker, runAiPicks } from "@/lib/bankFeeds/aiPick";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One sync per company every 30 seconds on this server, except right after an
 * import (?after=import): that one always runs, after any sync already running
 * for the company, so the new lines get steps 3 and 4.
 */
const MIN_GAP_MS = 30_000;
const lastRun = new Map<string, number>();
const running = new Map<string, Promise<unknown>>();

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const company = ctx.connection.id;
  const afterImport = new URL(request.url).searchParams.get("after") === "import";
  if (!afterImport && Date.now() - (lastRun.get(company) ?? 0) < MIN_GAP_MS) return json({ skipped: "recent" });
  lastRun.set(company, Date.now());
  const before = running.get(company);
  if (before) await before.catch(() => null);
  const run = sync(ctx, company);
  running.set(company, run);
  try {
    return await run;
  } finally {
    if (running.get(company) === run) running.delete(company);
  }
}

async function sync(ctx: Exclude<Awaited<ReturnType<typeof bankContext>>, Response>, company: string): Promise<Response> {
  try {
    // Bills a person posted are memory too. If the list can't be read, the bill vectors stay as they were.
    const invoices = await scantrixInvoices(ctx.caller.accessToken, company).then(
      (all) => all.filter((i) => i.byPerson && i.billId && i.glAccountId),
      () => undefined,
    );
    // The chart (which accounts are Bank) and vendors' saved tax codes, read at
    // most once a day: suggestions are checked against them.
    const before = await readLists(ctx.db, company);
    await Promise.all([chartFor(ctx.db, ctx.caller.accessToken, company), vendorsFor(ctx.db, ctx.caller.accessToken, company)]);
    const listsAfter = await readLists(ctx.db, company);
    const listsChanged = String(before?.vendorsAt) !== String(listsAfter?.vendorsAt) || String(before?.chartAt) !== String(listsAfter?.chartAt);
    const outcome = await syncVectors(ctx.db, company, openAiEmbedder(), { invoices, labeller: openAiLabeller() });
    // Also when lines were scored under older rules (a release since): they are corrected on the next page open.
    const oldRules = await scoredUnderOldRules(ctx.db, company);
    if (syncChanged(outcome) || listsChanged || oldRules) await refreshSuggestions(ctx.db, company);
    // Step 4 for what is still empty (or weak) after steps 2 and 3.
    const ai = await runAiPicks(ctx.db, company, openAiPicker(), { refresh: (keys) => refreshSuggestions(ctx.db, company, keys) }).catch((e) => {
      console.error("[bank] step 4", e?.message);
      return null;
    });
    // New lists and new AI picks change suggestions too: counted as a change, so the page reloads its lines.
    return json({ ...outcome, recoded: outcome.recoded + (listsChanged || oldRules ? 1 : 0) + (ai?.keys.length ?? 0), ai });
  } catch (error) {
    lastRun.delete(company);
    return errorResponse("similar sync", error);
  }
}
