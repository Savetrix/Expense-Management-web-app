// GET /api/bank-accounts — the company's connected bank accounts, plus the
// accounts known only by name (CSV imports, hand-typed transfer accounts).
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { listNamedAccounts } from "@/lib/bankFeeds/ledgerMappings";
import { listAccountViews } from "@/lib/bankFeeds/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    const [accounts, named] = await Promise.all([listAccountViews(ctx.db, ctx.connection.id), listNamedAccounts(ctx.db, ctx.connection.id)]);
    return json({ accounts, named, environment: ctx.config.plaidEnv });
  } catch (error) {
    return errorResponse("accounts", error);
  }
}
