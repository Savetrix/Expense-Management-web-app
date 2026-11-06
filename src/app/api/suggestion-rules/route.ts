// GET  /api/suggestion-rules — the company's rules for Smart Suggestions, newest first.
//   ?check=1 (the Rules tab) first checks each rule's GL account against
//   QuickBooks/Xero and marks the ones whose account is gone as broken.
// POST /api/suggestion-rules — "Always code like this": { match, label, glAccountId, taxCodeId? }.
//   Lines to review that the rule matches are filled in straight away; the
//   answer says how many ({ rule, filled, autoClassification }). A person
//   still presses Post.
import { goneAccountCheck } from "@/lib/bankFeeds/accountCheck";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { GONE_ACCOUNT, createRule, listRules, markBrokenRules, readRule } from "@/lib/bankFeeds/rules";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    if (new URL(request.url).searchParams.get("check") === "1") {
      const isGone = await goneAccountCheck(ctx.caller.accessToken, ctx.connection.id);
      if (isGone) await markBrokenRules(ctx.db, { qbConnectionId: ctx.connection.id, isGone });
    }
    return json({ rules: await listRules(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("rules", error);
  }
}

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (!body) return fail(400, "Nothing to save.");
  const input = readRule(body);
  if (typeof input === "string") return fail(400, input);
  try {
    const isGone = await goneAccountCheck(ctx.caller.accessToken, ctx.connection.id);
    if (isGone?.(input.glAccountId)) return fail(400, GONE_ACCOUNT);
    return json(await createRule(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, input }), 201);
  } catch (error) {
    return errorResponse("rule create", error);
  }
}
