// POST /api/bank-transactions/post — send decided lines to QuickBooks/Xero.
// Body: { ids: string[] } (at most 100). Each line is sent once (posting.ts);
// one refusal doesn't stop the others, except when the connection itself is
// the problem (reconnect, permission, not set up).
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { ledgerErrorResponse, postingServices } from "@/lib/bankFeeds/ledger";
import { LedgerError } from "@/lib/bankFeeds/ledger/types";
import { MAX_POST_BATCH, postLines } from "@/lib/bankFeeds/posting";

export const runtime = "nodejs";
// Lines go one at a time (provider rate limits), so a full batch takes a while.
export const maxDuration = 300;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "post", { requireLiveConnection: true });
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : [];
  if (ids.length === 0) return fail(400, "Pick the lines to send.");
  if (ids.length > MAX_POST_BATCH) return fail(400, `At most ${MAX_POST_BATCH} lines at a time.`);
  try {
    const services = await postingServices(ctx.caller.accessToken, ctx.connection.id);
    const results = await postLines(ctx.db, services, { qbConnectionId: ctx.connection.id, ids, userId: ctx.caller.userId });
    return json({ provider: services.ledger.provider, results });
  } catch (error) {
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("post", error);
  }
}
