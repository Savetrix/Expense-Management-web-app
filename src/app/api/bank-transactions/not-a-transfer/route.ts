// POST /api/bank-transactions/not-a-transfer — { ids: [a, b] }: "Not this" on a
// suggested transfer. Both lines go back to the list and are never paired again.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { refuseTransferPair } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]) : [];
  if (ids.length !== 2 || !ids.every((x) => typeof x === "string")) return fail(400, "Pick the two lines of the pair.");
  try {
    const ok = await refuseTransferPair(ctx.db, { qbConnectionId: ctx.connection.id, ids: ids as [string, string], userId: ctx.caller.userId });
    return ok ? json({ ok: true }) : fail(404, "Those lines aren't here any more.");
  } catch (error) {
    return errorResponse("not a transfer", error);
  }
}
