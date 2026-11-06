// PUT    /api/suggestion-rules/:id — change a rule: { match, label, glAccountId, taxCodeId? }.
//   Picking an active account again fixes a broken rule.
// DELETE /api/suggestion-rules/:id — remove it; lines it filled in go back to
//   what the payee's history suggests, or to blank.
import { goneAccountCheck } from "@/lib/bankFeeds/accountCheck";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { GONE_ACCOUNT, deleteRule, readRule, updateRule } from "@/lib/bankFeeds/rules";

export const runtime = "nodejs";
export const maxDuration = 30;

const GONE = "That rule isn't here any more.";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return fail(400, "Nothing to save.");
  const input = readRule(body);
  if (typeof input === "string") return fail(400, input);
  try {
    const isGone = await goneAccountCheck(ctx.caller.accessToken, ctx.connection.id);
    if (isGone?.(input.glAccountId)) return fail(400, GONE_ACCOUNT);
    const saved = await updateRule(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, id, input });
    return saved ? json(saved) : fail(404, GONE);
  } catch (error) {
    return errorResponse("rule update", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const removed = await deleteRule(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, id });
    return removed ? json({ ok: true }) : fail(404, GONE);
  } catch (error) {
    return errorResponse("rule delete", error);
  }
}
