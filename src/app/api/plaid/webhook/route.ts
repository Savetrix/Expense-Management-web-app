// POST /api/plaid/webhook — Plaid tells us a bank login has new transactions,
// broke, or was repaired.
//
// Plaid waits 10 seconds and retries for up to 24 hours, and may send the same
// webhook twice or out of order. So: verify, answer at once, and do the work in
// after(). Every action is idempotent — a sync with nothing new is a no-op, and
// setting a status twice changes nothing.
import { after } from "next/server";

import { readBankConfig } from "@/lib/bankFeeds/config";
import { readyDb } from "@/lib/bankFeeds/db";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemByPlaidId, logEvent, logWebhook, setItemStatus, setItemUpdateFlags } from "@/lib/bankFeeds/store";
import { syncItem } from "@/lib/bankFeeds/sync";
import { actionFor, verifyPlaidWebhook, type PlaidWebhook } from "@/lib/bankFeeds/webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const outcome = readBankConfig();
  // Not configured: a 503 makes Plaid retry, so nothing is lost while the
  // server is being set up.
  if (!outcome.ok) return Response.json({ error: "not configured" }, { status: 503 });
  const config = outcome.config;

  const raw = await request.text();
  const gateway = plaidGateway(config);
  const verified = await verifyPlaidWebhook(gateway, raw, request.headers.get("plaid-verification"));
  if (!verified.ok) {
    console.warn(`[bank] webhook refused: ${verified.reason}`);
    // 4xx is not retried by Plaid, which is right for a forged or stale call.
    return Response.json({ error: "unverified" }, { status: 401 });
  }

  let webhook: PlaidWebhook;
  try {
    webhook = JSON.parse(raw) as PlaidWebhook;
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  if (webhook.environment && webhook.environment !== config.plaidEnv) {
    return Response.json({ ok: true, ignored: "other environment" });
  }

  const action = actionFor(webhook);
  after(async () => {
    try {
      const db = await readyDb(config.mongoUri, config.mongoDbName);
      await logWebhook(db, {
        plaidItemId: webhook.item_id ?? null,
        webhookType: webhook.webhook_type ?? null,
        webhookCode: webhook.webhook_code ?? null,
        outcome: config.enabled ? action.kind : "disabled",
      });
      if (!config.enabled || action.kind === "ignore" || !webhook.item_id) return;
      const item = await getItemByPlaidId(db, webhook.item_id);
      if (!item) return;
      if (action.kind === "sync") {
        if (action.initialComplete || action.historicalComplete) {
          await setItemUpdateFlags(db, item._id, { initial: action.initialComplete, historical: action.historicalComplete });
        }
        await syncItem(db, gateway, config, item._id, "plaid");
      } else if (action.kind === "status") {
        await setItemStatus(db, item._id, action.status, action.code);
        await logEvent(db, { qbConnectionId: item.qbConnectionId, itemId: item._id, actor: "plaid", action: `bank.${action.status}`, detail: { code: action.code } });
        if (action.status === "active") await syncItem(db, gateway, config, item._id, "plaid");
      } else if (action.kind === "new_accounts") {
        await logEvent(db, { qbConnectionId: item.qbConnectionId, itemId: item._id, actor: "plaid", action: "bank.new_accounts_available" });
      }
    } catch (error) {
      console.error("[bank] webhook work failed", (error as Error).message);
    }
  });
  return Response.json({ ok: true });
}
