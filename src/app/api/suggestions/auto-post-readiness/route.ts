// GET /api/suggestions/auto-post-readiness — what the auto-post lock needs from
// the bank side: when a person first coded a bank line for this company, and
// how many days of coding unlock auto-post (lib/suggestions/autoPostLock.ts).
// The invoice side (first posted bill) is read in the browser, which already
// holds the company's invoices.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { autoPostUnlockDays } from "@/lib/suggestions/autoPostLock";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    const [first] = await ctx.db.txns
      .find({ qbConnectionId: ctx.connection.id, decidedAt: { $ne: null }, decidedBy: { $nin: [null, "autopilot", "system"] } }, { projection: { decidedAt: 1 } })
      .sort({ decidedAt: 1 })
      .limit(1)
      .toArray();
    return json({ requiredDays: autoPostUnlockDays(), firstBankDecisionAt: first?.decidedAt ? first.decidedAt.toISOString() : null });
  } catch (error) {
    return errorResponse("auto-post readiness", error);
  }
}
