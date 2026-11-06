// GET /api/bank-transactions?status=&accountId=&from=&to=&invoiceId=
// The company's bank lines (Plaid and CSV), newest first.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { listTransactions, type TxnStatus } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams;
  try {
    const transactions = await listTransactions(ctx.db, ctx.connection.id, {
      status: (q.get("status") as TxnStatus) || undefined,
      accountId: q.get("accountId") || undefined,
      from: q.get("from") || undefined,
      to: q.get("to") || undefined,
      invoiceId: q.get("invoiceId") || undefined,
    });
    return json({ transactions });
  } catch (error) {
    return errorResponse("transactions", error);
  }
}
