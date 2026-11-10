// PUT /api/bank-accounts/named-mapping — which bank or card account in
// QuickBooks/Xero an imported (CSV) account, or a hand-typed transfer
// account, posts to. Body: { accountLabel, ledgerAccountId, ledgerAccountName }.
// An empty ledgerAccountId removes the mapping.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { listNamedAccounts, setNamedMapping } from "@/lib/bankFeeds/ledgerMappings";
import { logEvent } from "@/lib/bankFeeds/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PUT(request: Request) {
  const ctx = await bankContext(request, "post");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const label = typeof body?.accountLabel === "string" ? body.accountLabel.trim().slice(0, 200) : "";
  const ledgerId = typeof body?.ledgerAccountId === "string" ? body.ledgerAccountId.trim().slice(0, 64) : "";
  const ledgerName = typeof body?.ledgerAccountName === "string" ? body.ledgerAccountName.trim().slice(0, 200) : "";
  if (!label) return fail(400, "Say which account this is.");
  try {
    await setNamedMapping(ctx.db, { qbConnectionId: ctx.connection.id, accountLabel: label, ledger: ledgerId ? { id: ledgerId, name: ledgerName || ledgerId } : null, userId: ctx.caller.userId });
    await logEvent(ctx.db, { qbConnectionId: ctx.connection.id, actor: ctx.caller.userId, action: "bank.mapping_saved", detail: { accountLabel: label, ledgerId, ledgerName } });
    return json({ named: await listNamedAccounts(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("named mapping", error);
  }
}
