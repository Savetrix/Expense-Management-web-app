// GET /api/suggestion-settings — the company's Smart Suggestions settings:
//   { autoClassification: "off" | "suggest" | "fill", features, canChange }.
// PUT /api/suggestion-settings — { autoClassification?, features? }. Owner or Admin only.
//   features: { aiPrefill, receiptWarning, autoMatch, transferSuggestions } (each on unless false).
//   Applied to the lines to review at once: Off clears every suggestion,
//   Suggest only takes back what ScanTrix filled in by itself.
import { can } from "@/lib/bankFeeds/door";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { readFeatures, setAutoClassification, setFeatures } from "@/lib/bankFeeds/settings";
import { readAutoClassification } from "@/lib/bankFeeds/suggest";
import { AUTO_CLASSIFICATION_MODES, type AutoClassification } from "@/lib/suggestions/match";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    const [autoClassification, features] = await Promise.all([readAutoClassification(ctx.db, ctx.connection.id), readFeatures(ctx.db, ctx.connection.id)]);
    return json({ autoClassification, features, canChange: can(ctx.connection.role, "configure") });
  } catch (error) {
    return errorResponse("settings", error);
  }
}

export async function PUT(request: Request) {
  const ctx = await bankContext(request, "configure");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const mode = body?.autoClassification as AutoClassification | undefined;
  if (mode !== undefined && !AUTO_CLASSIFICATION_MODES.includes(mode)) return fail(400, "Pick Off, Suggest only or Fill in when sure.");
  const wanted = body?.features && typeof body.features === "object" ? (body.features as Record<string, unknown>) : null;
  if (mode === undefined && !wanted) return fail(400, "Nothing to change.");
  try {
    const autoClassification = mode
      ? await setAutoClassification(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, mode })
      : await readAutoClassification(ctx.db, ctx.connection.id);
    const features = wanted ? await setFeatures(ctx.db, { qbConnectionId: ctx.connection.id, userId: ctx.caller.userId, features: wanted }) : await readFeatures(ctx.db, ctx.connection.id);
    return json({ autoClassification, features, canChange: true });
  } catch (error) {
    return errorResponse("settings update", error);
  }
}
