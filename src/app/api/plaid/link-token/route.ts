// POST /api/plaid/link-token — a short-lived token the browser opens Plaid Link
// with. Body `{ accountId }` asks for update mode instead: the bank login behind
// that account needs the user to sign in again.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemForAccount } from "@/lib/bankFeeds/store";
import { openAccessToken } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "connect");
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(request)) ?? {};
  try {
    let accessToken: string | undefined;
    if (typeof body.accountId === "string") {
      const found = await getItemForAccount(ctx.db, ctx.connection.id, body.accountId);
      if (!found) return fail(404, "That bank account isn't connected any more.");
      accessToken = openAccessToken(ctx.config, found.item) ?? undefined;
      if (!accessToken) return fail(409, "Reconnect this bank from scratch: its saved access could not be opened.");
    }
    const { linkToken, expiration } = await plaidGateway(ctx.config).createLinkToken({
      clientUserId: ctx.caller.userId,
      webhook: ctx.config.webhookUrl,
      accessToken,
      daysRequested: ctx.config.historyDays,
    });
    return json({ linkToken, expiration, mode: accessToken ? "update" : "connect", environment: ctx.config.plaidEnv });
  } catch (error) {
    return errorResponse("link-token", error);
  }
}
