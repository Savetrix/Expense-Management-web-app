// GET /api/bank-accounts — the company's connected bank accounts.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { listAccountViews } from "@/lib/bankFeeds/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    return json({ accounts: await listAccountViews(ctx.db, ctx.connection.id), environment: ctx.config.plaidEnv });
  } catch (error) {
    return errorResponse("accounts", error);
  }
}
