// POST /api/bank-transactions/bulk — the same decision on many lines ("Exclude
// selected", "Accept all strong matches"). Body: { items: [{ id, ...patch }] }.
// Each line is decided on its own; one refusal does not undo the others.
import { after } from "next/server";

import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { payeeKeyOf, refreshSuggestions } from "@/lib/bankFeeds/suggest";
import { decide, readPatch, type BankTransactionView } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ITEMS = 500;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const items = Array.isArray(body?.items) ? (body.items as Record<string, unknown>[]) : null;
  if (!items || items.length === 0) return fail(400, "Nothing to change.");
  if (items.length > MAX_ITEMS) return fail(400, `At most ${MAX_ITEMS} lines at a time.`);
  try {
    const updated: BankTransactionView[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id : "";
      const patch = readPatch(item);
      if (!id || typeof patch === "string") {
        failed.push({ id, error: typeof patch === "string" ? patch : "Missing id." });
        continue;
      }
      const result = await decide(ctx.db, { qbConnectionId: ctx.connection.id, id, userId: ctx.caller.userId, patch, action: "bulk_decision" });
      if (result.ok) updated.push(result.txn);
      else failed.push({ id, error: result.error });
    }
    if (updated.length > 0) {
      after(async () => {
        const keys = new Set<string>();
        for (const t of updated) {
          const key = await payeeKeyOf(ctx.db, ctx.connection.id, t.id);
          if (key) keys.add(key);
        }
        if (keys.size > 0) await refreshSuggestions(ctx.db, ctx.connection.id, [...keys]).catch((e) => console.error("[bank] suggestions", e?.message));
      });
    }
    return json({ updated, failed });
  } catch (error) {
    return errorResponse("bulk", error);
  }
}
