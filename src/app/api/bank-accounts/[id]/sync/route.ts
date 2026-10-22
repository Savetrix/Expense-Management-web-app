// POST /api/bank-accounts/:id/sync — "Sync now". Syncs the bank login behind
// the account and answers with what changed. Plaid refreshes banks 1–4 times a
// day on its own; this asks Plaid for whatever it already has.
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemForAccount, listAccountViews } from "@/lib/bankFeeds/store";
import { syncItem } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const found = await getItemForAccount(ctx.db, ctx.connection.id, id);
    if (!found) return fail(404, "That bank account isn't connected.");
    const outcome = await syncItem(ctx.db, plaidGateway(ctx.config), ctx.config, found.item.id, ctx.caller.userId);
    return json({ outcome, accounts: await listAccountViews(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("sync", error);
  }
}
