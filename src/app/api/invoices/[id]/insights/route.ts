// GET /api/invoices/:id/insights — the period the invoice covers (and whether
// it looks like a prepayment) and the bank line that paid it.
import { errorResponse, fail, json, storeContext } from "@/lib/bankFeeds/http";
import { bankInsight, fetchInvoice, periodInsight } from "@/lib/bankFeeds/invoiceInsights";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await storeContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const found = await fetchInvoice(ctx.caller.accessToken, ctx.connection.id, id);
  if (!found.ok) {
    return found.status === 401
      ? fail(401, "Your session has expired. Sign in again.")
      : found.status === 404
        ? fail(404, "Invoice not found.")
        : fail(503, "Scantrix couldn't read this invoice just now.");
  }
  try {
    const [period, bank] = await Promise.all([
      periodInsight(ctx.db, ctx.connection.id, found.invoice),
      ctx.bankFeedsOn ? bankInsight(ctx.db, ctx.connection.id, found.invoice) : Promise.resolve(null),
    ]);
    return json({ ...period, bank });
  } catch (error) {
    return errorResponse("invoice-insights", error);
  }
}
