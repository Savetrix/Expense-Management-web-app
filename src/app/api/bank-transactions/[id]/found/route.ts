// /api/bank-transactions/:id/found — a line already entered in QuickBooks/Xero.
//   POST { key }  a person picks which of the entries Scantrix found is this line
//   DELETE        "Not this": the line goes back to To review (foundInLedger.ts)
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { linkFoundEntry, unlinkFoundEntry } from "@/lib/bankFeeds/foundInLedger";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = await readJson(request);
  const key = typeof body?.key === "string" ? body.key.slice(0, 200) : "";
  if (!key) return fail(400, "Pick the entry that is this line.");
  try {
    const result = await linkFoundEntry(ctx.db, { qbConnectionId: ctx.connection.id, id, key, userId: ctx.caller.userId, provider: ctx.connection.providerId });
    if (!result.ok) return fail(result.status, result.error);
    return json({ transaction: result.txn });
  } catch (error) {
    return errorResponse("link found", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const result = await unlinkFoundEntry(ctx.db, { qbConnectionId: ctx.connection.id, id, userId: ctx.caller.userId });
    if (!result.ok) return fail(result.status, result.error);
    return json({ transaction: result.txn });
  } catch (error) {
    return errorResponse("unlink found", error);
  }
}
