// GET /api/suggestion-settings — the company's Smart Suggestions settings:
//   { autoClassification: "off" | "suggest" | "fill", canChange }.
// PUT /api/suggestion-settings — { autoClassification }. Owner or Admin only.
//   Applied to the lines to review at once: Off clears every suggestion,
//   Suggest only takes back what Scantrix filled in by itself.
import { can } from "@/lib/bankFeeds/door";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { setAutoClassification } from "@/lib/bankFeeds/rules";
import { readAutoClassification } from "@/lib/bankFeeds/suggest";
import { AUTO_CLASSIFICATION_MODES, type AutoClassification } from "@/lib/suggestions/match";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    const autoClassification = await readAutoClassification(ctx.db, ctx.connection.id);
    return json({ autoClassification, canChange: can(ctx.connection.role, "configure") });
  } catch (error) {
    return errorResponse("settings", error);
  }
}

export async function PUT(request: Request) {
  const ctx = await bankContext(request, "configure");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const mode = body?.autoClassification as AutoClassification;
  if (!AUTO_CLASSIFICATION_MODES.includes(mode)) return fail(400, "Pick Off, Suggest only or Fill in when sure.");
  try {
    const autoClassification = await setAutoClassification(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, mode });
    return json({ autoClassification, canChange: true });
  } catch (error) {
    return errorResponse("settings update", error);
  }
}
