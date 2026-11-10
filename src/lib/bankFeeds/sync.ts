// SERVER-ONLY. Pull a bank login's new, changed and removed transactions from
// Plaid (/transactions/sync) into bank_transactions.
//
// Rules (plaid.com/docs/transactions/sync-migration/ and research notes):
//   * One sync at a time per item: a lease on the item document, taken with an
//     atomic findOneAndUpdate. A webhook that lands while a sync runs only sets
//     syncRequestedAt, and the running sync goes round once more.
//   * Pages are applied as they arrive, with upserts keyed by Plaid's id, so a
//     restart re-applies harmlessly. The cursor is saved only after the LAST
//     page; on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION the loop restarts
//     from the cursor it began with.
//   * Pending transactions are skipped. A pending charge can change amount or
//     never post, and nothing should be coded against it. When it posts, Plaid
//     sends it again as a new posted transaction.
//   * Only Plaid-fact fields are written ($set); the user's decision, the
//     suggestion and the posting state are written only when a row is first
//     created ($setOnInsert), so a sync can never overwrite them.
import { randomUUID } from "node:crypto";

import type { Transaction } from "plaid";

import { openSecret } from "@/lib/inboundEmail/secretBox";

import type { BankFeedsConfig } from "./config";
import type { Db } from "./db";
import { mapPlaidTransaction } from "./plaidMap";
import { PlaidCallError, type PlaidGateway } from "./plaid";
import type { ItemDoc, TxnDoc } from "./schema";
import { logEvent, setItemStatus, upsertAccounts } from "./store";
import { refreshSuggestions } from "./suggest";

const LEASE_MS = 120_000;
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

export function openAccessToken(config: BankFeedsConfig, item: Pick<ItemDoc, "sealedAccessToken" | "plaidItemId">): string | null {
  return openSecret(item.sealedAccessToken, config.tokenEncryptionKey, tokenAad(item.plaidItemId));
}

async function takeLease(db: Db, itemId: string): Promise<ItemDoc | null> {
  const now = new Date();
  const item = await db.items.findOneAndUpdate(
    { _id: itemId, removedAt: null, $or: [{ syncLeaseUntil: null }, { syncLeaseUntil: { $lt: now } }] },
    { $set: { syncLeaseUntil: new Date(now.getTime() + LEASE_MS), syncRequestedAt: null, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (item) return item;
  await db.items.updateOne({ _id: itemId, removedAt: null }, { $set: { syncRequestedAt: now } });
  return null;
}

/** Releases the lease; true when a request arrived meanwhile and another round is due. */
async function releaseLease(db: Db, itemId: string): Promise<boolean> {
  const item = await db.items.findOneAndUpdate({ _id: itemId }, { $set: { syncLeaseUntil: null, updatedAt: new Date() } }, { returnDocument: "after" });
  return Boolean(item?.syncRequestedAt);
}

export function accountLabel(institution: string, name: string, mask: string | null): string {
  return `${institution} ${name}${mask ? ` ••${mask}` : ""}`.trim();
}

/** Upserts posted transactions for this item. Returns rows written. */
async function applyTransactions(db: Db, item: ItemDoc, txns: Transaction[]): Promise<number> {
  const posted = txns.filter((t) => !t.pending).map(mapPlaidTransaction);
  if (posted.length === 0) return 0;
  // Only accounts still shown: a line for an account the user disconnected is dropped.
  const accounts = await db.accounts.find({ itemId: item._id, removedAt: null, plaidAccountId: { $in: [...new Set(posted.map((p) => p.plaidAccountId))] } }).toArray();
  const byPlaidId = new Map(accounts.map((a) => [a.plaidAccountId, a]));
  const now = new Date();
  const ops = [];
  for (const p of posted) {
    const account = byPlaidId.get(p.plaidAccountId);
    if (!account) continue;
    const facts: Partial<TxnDoc> = {
      qbConnectionId: item.qbConnectionId,
      accountId: account._id,
      accountLabel: accountLabel(item.institutionName, account.name, account.mask),
      date: p.date,
      authorizedDate: p.authorizedDate,
      description: p.description,
      merchantName: p.merchantName,
      merchantEntityId: p.merchantEntityId,
      counterpartyName: p.counterpartyName,
      counterpartyType: p.counterpartyType,
      logoUrl: p.logoUrl,
      website: p.website,
      amountCents: p.amountCents,
      currency: p.currency,
      categoryPrimary: p.categoryPrimary,
      categoryDetailed: p.categoryDetailed,
      categoryConfidence: p.categoryConfidence,
      paymentChannel: p.paymentChannel,
      checkNumber: p.checkNumber,
      removedAt: null,
      updatedAt: now,
    };
    ops.push({
      updateOne: {
        filter: { plaidTransactionId: p.plaidTransactionId },
        update: {
          $set: facts,
          $setOnInsert: {
            _id: randomUUID(),
            source: "plaid" as const,
            plaidTransactionId: p.plaidTransactionId,
            status: "review" as const,
            matchedInvoiceId: null,
            transferAccountId: null,
            transferLabel: null,
            glAccountId: null,
            taxCodeId: null,
            vendorId: null,
            payee: null,
            decidedBy: null,
            decidedAt: null,
            payeeKey: null,
            suggestion: null,
            postingStatus: null,
            posting: null,
            version: 1,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  }
  if (ops.length === 0) return 0;
  const r = await db.txns.bulkWrite(ops, { ordered: false });
  return r.upsertedCount + r.matchedCount;
}

async function applyRemoved(db: Db, item: ItemDoc, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db.txns.updateMany(
    { plaidTransactionId: { $in: ids }, qbConnectionId: item.qbConnectionId, removedAt: null },
    { $set: { removedAt: new Date(), updatedAt: new Date() } },
  );
  return r.modifiedCount;
}

/** One full pass: all pages from the saved cursor to has_more=false. */
async function syncPass(db: Db, gateway: PlaidGateway, item: ItemDoc, accessToken: string) {
  const startCursor = item.syncCursor;
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
      const recovered = item.status === "login_required" || item.status === "error";
      await db.items.updateOne(
        { _id: item._id },
        {
          $set: {
            syncCursor: cursor,
            lastSyncedAt: new Date(),
            lastSyncError: null,
            errorCode: null,
            updatedAt: new Date(),
            ...(recovered ? { status: "active" as const } : {}),
          },
        },
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
        await logEvent(db, { qbConnectionId: item.qbConnectionId, itemId, actor, action: "sync.login_required", detail: { code: error.code } });
        return { status: "login_required", code: error.code };
      }
      if (error.itemGone) {
        await setItemStatus(db, itemId, "revoked", error.code);
        return { status: "gone" };
      }
      await db.items.updateOne({ _id: itemId }, { $set: { lastSyncError: error.code, updatedAt: new Date() } });
      return { status: "failed", code: error.code };
    }
    throw error;
  }

  if (totals.added + totals.modified + totals.removed > 0) {
    await logEvent(db, { qbConnectionId: item.qbConnectionId, itemId, actor, action: "sync", detail: totals });
    // New lines get their suggestions (and Autopilot coding) straight away.
    await refreshSuggestions(db, item.qbConnectionId);
  }
  return { status: "synced", ...totals };
}
