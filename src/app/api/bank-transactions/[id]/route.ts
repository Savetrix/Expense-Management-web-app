// PATCH /api/bank-transactions/:id — record a decision on one line: exclude,
// restore, mark as transfer, match to a bill, or set vendor / GL / tax code.
// Body: { status?, matchedInvoiceId?, transferAccount?, transferAccountId?,
//         categoryId?, taxCodeId?, vendorId?, payee?, version }
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { decide, readPatch } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return fail(400, "Nothing to change.");
  const patch = readPatch(body);
  if (typeof patch === "string") return fail(400, patch);
  try {
    const result = await decide(ctx.db, {
      qbConnectionId: ctx.connection.id,
      id,
      userId: ctx.caller.userId,
      patch,
      expectedVersion: typeof body.version === "number" ? body.version : undefined,
      action: typeof body.action === "string" ? `bank.${body.action.replace(/[^a-z_]/g, "").slice(0, 40)}` : undefined,
    });
    if (!result.ok) return fail(result.status, result.error, result.current ? { current: result.current } : undefined);
    return json({ transaction: result.txn });
  } catch (error) {
    return errorResponse("decide", error);
  }
}
