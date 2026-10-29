// PUT /api/bank-accounts/:id/mapping — which bank or credit-card account in
// QuickBooks/Xero this bank account posts to. Body: { ledgerAccountId, ledgerAccountName }.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { listAccountViews, logEvent, setAccountMapping } from "@/lib/bankFeeds/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "post");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = await readJson(request);
  const ledgerId = typeof body?.ledgerAccountId === "string" ? body.ledgerAccountId.trim() : "";
  const ledgerName = typeof body?.ledgerAccountName === "string" ? body.ledgerAccountName.trim().slice(0, 200) : "";
  try {
    const ok = await setAccountMapping(ctx.db, ctx.connection.id, id, ledgerId ? { id: ledgerId, name: ledgerName || ledgerId } : null);
    if (!ok) return fail(404, "That bank account isn't connected.");
    await logEvent(ctx.db, { qbConnectionId: ctx.connection.id, actor: ctx.caller.userId, action: "bank.mapping_saved", detail: { accountId: id, ledgerId, ledgerName } });
    return json({ accounts: await listAccountViews(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("mapping", error);
  }
}
