// GET /api/bank-events?transactionId=&limit= — the bank feed's audit trail for
// the company: who changed what, from where (web, Plaid, Autopilot, system),
// with before/after where it applies. Newest first. For the Audit Trail page.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number(q.get("limit")) || 100));
  const transactionId = q.get("transactionId");
  try {
    const rows = await ctx.db.events
      .find({ qbConnectionId: ctx.connection.id, ...(transactionId ? { transactionId } : {}) }, { projection: { _id: 0, qbConnectionId: 0 } })
      .sort({ at: -1 })
      .limit(limit)
      .toArray();
    return json({ events: rows.map((e) => ({ ...e, at: e.at.toISOString() })) });
  } catch (error) {
    return errorResponse("events", error);
  }
}
