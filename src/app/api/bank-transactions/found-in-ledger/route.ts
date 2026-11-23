// POST /api/bank-transactions/found-in-ledger — finds lines in To review that
// someone already entered straight into QuickBooks/Xero, and moves each one
// that surely matches to Matched (foundInLedger.ts). The bank page calls it on
// load and every few minutes. Answer: { checked, linked, possible } or { skipped }.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { findInLedger } from "@/lib/bankFeeds/foundInLedger";
import { adapterFor, ledgerErrorResponse } from "@/lib/bankFeeds/ledger";
import { getLedgerContext } from "@/lib/bankFeeds/ledger/backend";
import { LedgerError } from "@/lib/bankFeeds/ledger/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** At most one check per company every 15 seconds on this server, however many tabs are open. */
const MIN_GAP_MS = 15_000;
const lastRun = new Map<string, number>();

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const company = ctx.connection.id;
  const now = Date.now();
  if (now - (lastRun.get(company) ?? 0) < MIN_GAP_MS) return json({ skipped: true });
  lastRun.set(company, now);
  try {
    const ledger = await getLedgerContext(ctx.caller.accessToken, company);
    const outcome = await findInLedger(ctx.db, { ctx: ledger, adapter: adapterFor(ledger.provider) }, { qbConnectionId: company, userId: ctx.caller.userId });
    return json(outcome);
  } catch (error) {
    // Let the next page load try again rather than wait after a failure.
    lastRun.delete(company);
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("found in ledger", error);
  }
}
