// SERVER-ONLY. Pull a bank login's new, changed and removed transactions from
// Plaid (/transactions/sync) into bank_transactions.
//
// Rules (plaid.com/docs/transactions/sync-migration/ and research notes):
//   * One sync at a time per item: a lease row in bank_items. A webhook that
//     lands while a sync runs only sets sync_requested_at, and the running sync
//     goes round once more before releasing the lease.
//   * Pages are applied as they arrive, with upserts keyed by Plaid's id, so a
//     restart re-applies harmlessly. The cursor is saved only after the LAST
//     page; on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION the loop restarts
//     from the cursor it began with.
//   * Pending transactions are skipped. A pending charge can change amount or
//     never post, and nothing should be coded against it. When it posts, Plaid
//     sends it again as a new posted transaction.
//   * Only Plaid-fact columns are written. The user's decision, Scantrix's
//     suggestion and the posting state are never touched by a sync.
import type { Transaction } from "plaid";

import { openSecret } from "@/lib/inboundEmail/secretBox";

import type { BankFeedsConfig } from "./config";
import type { Db } from "./db";
import { mapPlaidTransaction } from "./plaidMap";
import { PlaidCallError, type PlaidGateway } from "./plaid";
import { logEvent, setItemStatus, upsertAccounts, type ItemRow } from "./store";

const LEASE_SECONDS = 120;
const MAX_RESTARTS = 3;
const MAX_ROUNDS = 3;

export type SyncOutcome =
  | { status: "synced"; added: number; modified: number; removed: number }
  | { status: "busy" }
  | { status: "login_required"; code: string }
  | { status: "gone" }
  | { status: "failed"; code: string };

/** AAD binds a sealed token to its item, so a token cannot be replayed under another row. */
export function tokenAad(plaidItemId: string): string {
  return `bank-item:${plaidItemId}`;
}

export function openAccessToken(config: BankFeedsConfig, item: Pick<ItemRow, "sealed_access_token" | "plaid_item_id">): string | null {
  return openSecret(item.sealed_access_token, config.tokenEncryptionKey, tokenAad(item.plaid_item_id));
}

async function takeLease(db: Db, itemId: string): Promise<ItemRow | null> {
  const rows = await db.query<ItemRow>(
    `UPDATE bank_items
        SET sync_lease_until = now() + make_interval(secs => $2), sync_requested_at = NULL, updated_at = now()
      WHERE id = $1 AND removed_at IS NULL AND (sync_lease_until IS NULL OR sync_lease_until < now())
      RETURNING *`,
    [itemId, LEASE_SECONDS],
  );
  if (rows.length === 1) return rows[0];
  await db.query("UPDATE bank_items SET sync_requested_at = now() WHERE id = $1 AND removed_at IS NULL", [itemId]);
  return null;
}

async function releaseLease(db: Db, itemId: string): Promise<boolean> {
  const [row] = await db.query<{ again: boolean }>(
    `UPDATE bank_items SET sync_lease_until = NULL, updated_at = now() WHERE id = $1
     RETURNING sync_requested_at IS NOT NULL AS again`,
    [itemId],
  );
  return Boolean(row?.again);
}

function accountLabel(institution: string, name: string, mask: string | null): string {
  return `${institution} ${name}${mask ? ` ••${mask}` : ""}`.trim();
}

/** Upserts posted transactions for this item in one statement. Returns rows written. */
async function applyTransactions(db: Db, item: ItemRow, txns: Transaction[]): Promise<number> {
  const posted = txns.filter((t) => !t.pending).map(mapPlaidTransaction);
  if (posted.length === 0) return 0;
  const col = <K extends keyof (typeof posted)[number]>(k: K) => posted.map((p) => p[k]);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO bank_transactions (
        qb_connection_id, account_id, account_label, source, plaid_transaction_id, date, authorized_date, description,
        merchant_name, merchant_entity_id, counterparty_name, counterparty_type, logo_url, website, amount_cents, currency,
        category_primary, category_detailed, category_confidence, payment_channel, check_number)
     SELECT $1, a.id, $2 || ' ' || a.name || coalesce(' ••' || a.mask, ''), 'plaid', v.tid, v.date::date, v.adate::date, v.descr,
            v.merchant, v.merchant_id, v.cp_name, v.cp_type, v.logo, v.web, v.cents, v.currency,
            v.cat_p, v.cat_d, v.cat_c, v.channel, v.check_no
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
                   $12::text[], $13::text[], $14::bigint[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[], $20::text[])
         AS v(tid, paid, date, adate, descr, merchant, merchant_id, cp_name, cp_type, logo, web, cents, currency, cat_p, cat_d, cat_c, channel, check_no)
       JOIN bank_accounts a ON a.plaid_account_id = v.paid AND a.item_id = $21 AND a.removed_at IS NULL
     ON CONFLICT (plaid_transaction_id) DO UPDATE SET
        date = EXCLUDED.date, authorized_date = EXCLUDED.authorized_date, description = EXCLUDED.description,
        merchant_name = EXCLUDED.merchant_name, merchant_entity_id = EXCLUDED.merchant_entity_id,
        counterparty_name = EXCLUDED.counterparty_name, counterparty_type = EXCLUDED.counterparty_type,
        logo_url = EXCLUDED.logo_url, website = EXCLUDED.website, amount_cents = EXCLUDED.amount_cents,
        currency = EXCLUDED.currency, category_primary = EXCLUDED.category_primary,
        category_detailed = EXCLUDED.category_detailed, category_confidence = EXCLUDED.category_confidence,
        payment_channel = EXCLUDED.payment_channel, check_number = EXCLUDED.check_number,
        removed_at = NULL, updated_at = now()
     RETURNING id`,
    [
      item.qb_connection_id,
      item.institution_name,
      col("plaidTransactionId"),
      col("plaidAccountId"),
      col("date"),
      col("authorizedDate"),
      col("description"),
      col("merchantName"),
      col("merchantEntityId"),
      col("counterpartyName"),
      col("counterpartyType"),
      col("logoUrl"),
      col("website"),
      col("amountCents"),
      col("currency"),
      col("categoryPrimary"),
      col("categoryDetailed"),
      col("categoryConfidence"),
      col("paymentChannel"),
      col("checkNumber"),
      item.id,
    ],
  );
  return rows.length;
}

async function applyRemoved(db: Db, item: ItemRow, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.query<{ id: string }>(
    `UPDATE bank_transactions SET removed_at = now(), updated_at = now()
      WHERE plaid_transaction_id = ANY($1::text[]) AND qb_connection_id = $2 AND removed_at IS NULL
      RETURNING id`,
    [ids, item.qb_connection_id],
  );
  return rows.length;
}

/** One full pass: all pages from the saved cursor to has_more=false. */
async function syncPass(db: Db, gateway: PlaidGateway, item: ItemRow, accessToken: string) {
  const startCursor = item.sync_cursor;
  for (let attempt = 0; ; attempt += 1) {
    let cursor = startCursor;
    let added = 0;
    let modified = 0;
    let removed = 0;
    try {
      for (;;) {
        const page = await gateway.syncTransactions(accessToken, cursor);
        if (page.accounts.length > 0) await upsertAccounts(db, item, page.accounts);
        added += await applyTransactions(db, item, page.added);
        modified += await applyTransactions(db, item, page.modified);
        removed += await applyRemoved(db, item, page.removed.map((r) => r.transaction_id));
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      await db.query(
        `UPDATE bank_items SET sync_cursor = $2, last_synced_at = now(), last_sync_error = NULL,
                status = CASE WHEN status IN ('login_required', 'error') THEN 'active' ELSE status END,
                error_code = NULL, updated_at = now()
          WHERE id = $1`,
        [item.id, cursor],
      );
      return { added, modified, removed };
    } catch (error) {
      if (error instanceof PlaidCallError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < MAX_RESTARTS) continue;
      throw error;
    }
  }
}

export async function syncItem(db: Db, gateway: PlaidGateway, config: BankFeedsConfig, itemId: string, actor = "system"): Promise<SyncOutcome> {
  let item = await takeLease(db, itemId);
  if (!item) return { status: "busy" };
  const accessToken = openAccessToken(config, item);
  if (!accessToken) {
    await releaseLease(db, itemId);
    await setItemStatus(db, itemId, "error", "TOKEN_UNREADABLE");
    return { status: "failed", code: "TOKEN_UNREADABLE" };
  }

  const totals = { added: 0, modified: 0, removed: 0 };
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const pass = await syncPass(db, gateway, item, accessToken);
      totals.added += pass.added;
      totals.modified += pass.modified;
      totals.removed += pass.removed;
      const again = await releaseLease(db, itemId);
      if (!again) break;
      const next = await takeLease(db, itemId);
      if (!next) break;
      item = next;
    }
  } catch (error) {
    await releaseLease(db, itemId);
    if (error instanceof PlaidCallError) {
      if (error.needsRelogin) {
        await setItemStatus(db, itemId, error.code === "PENDING_DISCONNECT" ? "pending_disconnect" : "login_required", error.code);
        await logEvent(db, { qbConnectionId: item.qb_connection_id, itemId, actor, action: "sync.login_required", detail: { code: error.code } });
        return { status: "login_required", code: error.code };
      }
      if (error.itemGone) {
        await setItemStatus(db, itemId, "revoked", error.code);
        return { status: "gone" };
      }
      await db.query("UPDATE bank_items SET last_sync_error = $2, updated_at = now() WHERE id = $1", [itemId, error.code]);
      return { status: "failed", code: error.code };
    }
    throw error;
  }

  if (totals.added + totals.modified + totals.removed > 0) {
    await logEvent(db, { qbConnectionId: item.qb_connection_id, itemId, actor, action: "sync", detail: totals });
  }
  return { status: "synced", ...totals };
}

export { accountLabel };
