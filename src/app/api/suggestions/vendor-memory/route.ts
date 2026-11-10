// GET /api/suggestions/vendor-memory?vendorId= — Smart Suggestions, step 2:
// what this company's people coded a vendor's bank lines to, for the invoice
// screen's 2nd and 3rd picks. The invoice side of the memory (bills a person
// posted) is already in the browser. Answer: { votes: MemoryVote[] }.
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { readAutoClassification, vendorMemory } from "@/lib/bankFeeds/suggest";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  const vendorId = new URL(request.url).searchParams.get("vendorId")?.trim() ?? "";
  if (!vendorId || vendorId.length > 64) return fail(400, "Say which vendor.");
  try {
    // Off: no suggestions anywhere, so nothing to read.
    if ((await readAutoClassification(ctx.db, ctx.connection.id)) === "off") return json({ votes: [] });
    return json({ votes: await vendorMemory(ctx.db, ctx.connection.id, vendorId) });
  } catch (error) {
    return errorResponse("vendor memory", error);
  }
}
