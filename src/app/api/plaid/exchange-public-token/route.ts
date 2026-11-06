// POST /api/plaid/exchange-public-token — Plaid Link finished. Exchanges the
// one-time public token for the item's access token (sealed into the database,
// never returned), saves the accounts and starts the first sync.
//
// Body: { publicToken, institution: { id, name }, accounts: [{ mask }] } — the
// onSuccess metadata, used only to refuse a duplicate before it is created.
import { after } from "next/server";

import { connectItem, findDuplicateItem } from "@/lib/bankFeeds/connect";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { listAccountViews } from "@/lib/bankFeeds/store";
import { syncItem } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "connect");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const publicToken = typeof body?.publicToken === "string" ? body.publicToken.trim() : "";
  if (!publicToken) return fail(400, "Missing the token from Plaid.");

  const institution = (body?.institution ?? {}) as { id?: unknown; name?: unknown };
  const accounts = Array.isArray(body?.accounts) ? (body.accounts as { mask?: unknown }[]) : [];
  const meta = {
    institutionId: typeof institution.id === "string" ? institution.id : null,
    institutionName: typeof institution.name === "string" ? institution.name : null,
    accountMasks: accounts.map((a) => (typeof a.mask === "string" ? a.mask : "")).filter(Boolean),
  };

  try {
    const duplicate = await findDuplicateItem(ctx.db, ctx.connection.id, meta);
    if (duplicate) {
      return fail(409, `${duplicate.institutionName} is already connected to ${ctx.connection.name}.`, { reason: "duplicate" });
    }
    const gateway = plaidGateway(ctx.config);
    const item = await connectItem(ctx.db, gateway, ctx.config, {
      qbConnectionId: ctx.connection.id,
      userId: ctx.caller.userId,
      publicToken,
      meta,
    });
    // Plaid sends SYNC_UPDATES_AVAILABLE only after the first sync call, so
    // make it now — after the response, so the user is not kept waiting.
    after(() => syncItem(ctx.db, gateway, ctx.config, item._id, ctx.caller.userId).catch((e) => console.error("[bank] first sync failed", e?.message)));
    return json({ accounts: await listAccountViews(ctx.db, ctx.connection.id) }, 201);
  } catch (error) {
    return errorResponse("exchange", error);
  }
}
