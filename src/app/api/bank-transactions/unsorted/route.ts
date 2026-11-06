// GET /api/bank-transactions/unsorted?to=YYYY-MM-DD — how many bank lines up to
// a period end are not in the books yet: still to review, or posted in
// Scantrix but not yet sent to the accounting software. Period close's
// "Clear the bank" step is done only when both are zero.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { unsortedCounts } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    return json(await unsortedCounts(ctx.db, ctx.connection.id, new URL(request.url).searchParams.get("to")));
  } catch (error) {
    return errorResponse("unsorted", error);
  }
}
