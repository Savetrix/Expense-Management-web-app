// /api/suggestions/history — Smart Suggestions learns from the company's own
// coding in QuickBooks/Xero over the last 12 months (lib/bankFeeds/history.ts).
//   GET   { learnFromHistory, canChange, status, payees: { total, matched } }
//   POST  { force? } reads the books when the last read is over a day old (or
//         force), then re-scores the bank lines. The bank and Autopilot pages
//         call it when they open. Needs a role that may post (the token route).
//   PUT   { learnFromHistory } Owner or Admin. Off removes everything read.
import { can } from "@/lib/bankFeeds/door";
import { HISTORY_REFRESH_MS, importHistory, payeeMatchStats, readHistoryStatus, readLearnFromHistory, removeHistory } from "@/lib/bankFeeds/history";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { adapterFor, ledgerErrorResponse } from "@/lib/bankFeeds/ledger";
import { getLedgerContext, scantrixBillIds, vendorExternalIds } from "@/lib/bankFeeds/ledger/backend";
import { LedgerError } from "@/lib/bankFeeds/ledger/types";
import { logEvent } from "@/lib/bankFeeds/store";
import { refreshSuggestions } from "@/lib/bankFeeds/suggest";

export const runtime = "nodejs";
// Twelve months of a busy company's books take a while to read.
export const maxDuration = 300;

/** One read per company at a time on this server. */
const running = new Set<string>();

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    const [learnFromHistory, status, payees] = await Promise.all([
      readLearnFromHistory(ctx.db, ctx.connection.id),
      readHistoryStatus(ctx.db, ctx.connection.id),
      payeeMatchStats(ctx.db, ctx.connection.id),
    ]);
    return json({ learnFromHistory, canChange: can(ctx.connection.role, "configure"), status, running: running.has(ctx.connection.id), payees });
  } catch (error) {
    return errorResponse("history", error);
  }
}

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const company = ctx.connection.id;
  const body = await readJson(request);
  try {
    if (!(await readLearnFromHistory(ctx.db, company))) return json({ imported: false, reason: "off" });
    const last = await readHistoryStatus(ctx.db, company);
    const fresh = last && last.outcome !== "error" && Date.now() - new Date(last.at).getTime() < HISTORY_REFRESH_MS;
    if ((fresh && body?.force !== true) || running.has(company)) return json({ imported: false, reason: running.has(company) ? "running" : "fresh", status: last });
    running.add(company);
    try {
      const ledger = await getLedgerContext(ctx.caller.accessToken, company);
      const adapter = adapterFor(ledger.provider);
      const [vendorIds, billIds] = adapter.historyBetween
        ? await Promise.all([vendorExternalIds(ctx.caller.accessToken, company), scantrixBillIds(ctx.caller.accessToken, company)])
        : [new Map<string, string>(), new Set<string>()];
      const status = await importHistory(ctx.db, { qbConnectionId: company, userId: ctx.caller.userId, ledger: { ctx: ledger, adapter }, vendorIds, scantrixBillIds: billIds });
      if (status.outcome === "done") await refreshSuggestions(ctx.db, company);
      return json({ imported: status.outcome === "done", status });
    } finally {
      running.delete(company);
    }
  } catch (error) {
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("history import", error);
  }
}

export async function PUT(request: Request) {
  const ctx = await bankContext(request, "configure");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (typeof body?.learnFromHistory !== "boolean") return fail(400, "Say whether to learn from the books.");
  const company = ctx.connection.id;
  try {
    const before = await readLearnFromHistory(ctx.db, company);
    await ctx.db.suggestionSettings.updateOne(
      { _id: company },
      { $set: { learnFromHistory: body.learnFromHistory, updatedBy: ctx.caller.userId, updatedAt: new Date() } },
      { upsert: true },
    );
    if (before !== body.learnFromHistory) {
      await logEvent(ctx.db, { qbConnectionId: company, actor: ctx.caller.userId, action: "suggestion.settings_changed", detail: { before: { learnFromHistory: before }, after: { learnFromHistory: body.learnFromHistory } } });
      if (!body.learnFromHistory) {
        await removeHistory(ctx.db, company);
        await refreshSuggestions(ctx.db, company);
      }
    }
    return json({ learnFromHistory: body.learnFromHistory });
  } catch (error) {
    return errorResponse("history setting", error);
  }
}
