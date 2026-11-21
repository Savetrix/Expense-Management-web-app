// GET /api/paperwork/team — who can be asked for receipts: everyone on the
// company's team, pending invites marked (paperwork.ts teamMembers).
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { teamMembers } from "@/lib/bankFeeds/paperwork";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  try {
    const team = await teamMembers(ctx.caller.accessToken, ctx.connection.id).catch(() => null);
    if (!team) return fail(503, "ScanTrix couldn't load the team just now. Try again.");
    return json({ members: team.filter((m) => m.userId !== ctx.caller.userId) });
  } catch (error) {
    return errorResponse("paperwork team", error);
  }
}
