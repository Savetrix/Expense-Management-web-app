// PUT /api/invoices/:id/prepayment — the user's answer to "Prepayment
// detected". Body: { dismissed: boolean } ("Not a prepayment" / undo).
import { errorResponse, fail, json, readJson, storeContext } from "@/lib/bankFeeds/http";
import { fetchInvoice, setPrepaymentDismissed } from "@/lib/bankFeeds/invoiceInsights";
import { logEvent } from "@/lib/bankFeeds/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await storeContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = await readJson(request);
  if (typeof body?.dismissed !== "boolean") return fail(400, "Say whether this is a prepayment.");
  // Only invoices the caller can see.
  const found = await fetchInvoice(ctx.caller.accessToken, ctx.connection.id, id);
  if (!found.ok) return fail(found.status === 401 ? 401 : found.status === 404 ? 404 : 503, found.status === 404 ? "Invoice not found." : "Couldn't read this invoice just now.");
  try {
    await setPrepaymentDismissed(ctx.db, ctx.connection.id, id, ctx.caller.userId, body.dismissed);
    await logEvent(ctx.db, { qbConnectionId: ctx.connection.id, actor: ctx.caller.userId, action: body.dismissed ? "invoice.not_prepayment" : "invoice.prepayment_restored", detail: { invoiceId: id } });
    return json({ dismissed: body.dismissed });
  } catch (error) {
    return errorResponse("prepayment", error);
  }
}
