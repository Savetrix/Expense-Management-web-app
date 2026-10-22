// POST /api/plaid/webhook — Plaid tells us a bank login has new transactions,
// broke, or was repaired.
//
// Plaid waits 10 seconds and retries for up to 24 hours, and may send the same
// webhook twice or out of order. So: verify, answer at once, and do the work in
// after(). Every action is idempotent — a sync with nothing new is a no-op, and
// setting a status twice changes nothing.
import { after } from "next/server";

import { readBankConfig } from "@/lib/bankFeeds/config";
import { openDb } from "@/lib/bankFeeds/db";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemByPlaidId, logEvent, setItemStatus } from "@/lib/bankFeeds/store";
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

  const db = openDb(config.databaseUrl);
  const action = actionFor(webhook);
  after(async () => {
    try {
      await db.query("INSERT INTO bank_webhook_log (plaid_item_id, webhook_type, webhook_code, outcome) VALUES ($1, $2, $3, $4)", [
        webhook.item_id ?? null,
        webhook.webhook_type,
        webhook.webhook_code,
        config.enabled ? action.kind : "disabled",
      ]);
      if (!config.enabled || action.kind === "ignore" || !webhook.item_id) return;
      const item = await getItemByPlaidId(db, webhook.item_id);
      if (!item) return;
      if (action.kind === "sync") {
        if (action.initialComplete || action.historicalComplete) {
          await db.query(
            `UPDATE bank_items SET initial_update_complete = initial_update_complete OR $2,
                    historical_update_complete = historical_update_complete OR $3, updated_at = now() WHERE id = $1`,
            [item.id, Boolean(action.initialComplete), Boolean(action.historicalComplete)],
          );
        }
        await syncItem(db, gateway, config, item.id, "plaid");
      } else if (action.kind === "status") {
        await setItemStatus(db, item.id, action.status, action.code);
        await logEvent(db, { qbConnectionId: item.qb_connection_id, itemId: item.id, actor: "plaid", action: `bank.${action.status}`, detail: { code: action.code } });
        if (action.status === "active") await syncItem(db, gateway, config, item.id, "plaid");
      } else if (action.kind === "new_accounts") {
        await logEvent(db, { qbConnectionId: item.qb_connection_id, itemId: item.id, actor: "plaid", action: "bank.new_accounts_available" });
      }
    } catch (error) {
      console.error("[bank] webhook work failed", (error as Error).message);
    }
  });
  return Response.json({ ok: true });
}
