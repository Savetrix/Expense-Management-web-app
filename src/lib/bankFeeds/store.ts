// SERVER-ONLY. Reads and writes for bank logins (Plaid "items") and their
// accounts. Every query is scoped by qbConnectionId, which only ever comes
// from the door (door.ts), never from a request body.
import { randomUUID } from "node:crypto";

import type { AccountBase } from "plaid";

import type { Db } from "./db";
import type { AccountDoc, ItemDoc, ItemStatus } from "./schema";

export type { ItemStatus } from "./schema";

/** What the Connected accounts tab shows: one row per bank account. */
export interface BankAccountView {
  id: string;
  itemId: string;
  institutionName: string;
  name: string;
  mask?: string;
  subtype?: string;
  currency: string | null;
  currentBalance: number | null;
  lastSyncedAt: string | null;
  status: "connected" | "needs_relogin" | "syncing";
  /** Plaid's reason, for the "Needs re-login" hint. */
  statusDetail: string | null;
  mappedGlAccountId?: string;
  mappedGlAccountName?: string;
  /** First pull still running at Plaid. */
  historyLoading: boolean;
}

const cents = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * 100) : null);

export function itemNeedsRelogin(status: ItemStatus): boolean {
  return status === "login_required" || status === "pending_expiration" || status === "pending_disconnect" || status === "revoked";
}

export async function insertItem(
  db: Db,
  args: {
    qbConnectionId: string;
    plaidItemId: string;
    plaidEnv: string;
    institutionId: string | null;
    institutionName: string;
    sealedAccessToken: string;
    consentExpiresAt: string | null;
    createdBy: string;
  },
): Promise<ItemDoc> {
  const now = new Date();
  // Upsert by Plaid's id: a retried exchange of the same item must not create a second row.
  const doc = await db.items.findOneAndUpdate(
    { plaidItemId: args.plaidItemId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        qbConnectionId: args.qbConnectionId,
        plaidItemId: args.plaidItemId,
        plaidEnv: args.plaidEnv,
        institutionId: args.institutionId,
        institutionName: args.institutionName,
        sealedAccessToken: args.sealedAccessToken,
        syncCursor: null,
        status: "active",
        errorCode: null,
        consentExpiresAt: args.consentExpiresAt,
        initialUpdateComplete: false,
        historicalUpdateComplete: false,
        lastSyncedAt: null,
        lastSyncError: null,
        syncLeaseUntil: null,
        syncRequestedAt: null,
        createdBy: args.createdBy,
        createdAt: now,
        removedAt: null,
      },
      $set: { updatedAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  return doc as ItemDoc;
}

/** Inserts or refreshes the item's accounts. Accounts Plaid no longer returns are left alone. */
export async function upsertAccounts(db: Db, item: Pick<ItemDoc, "_id" | "qbConnectionId">, accounts: AccountBase[]): Promise<void> {
  if (accounts.length === 0) return;
  const now = new Date();
  await db.accounts.bulkWrite(
    accounts.map((a) => ({
      updateOne: {
        filter: { plaidAccountId: a.account_id },
        update: {
          $setOnInsert: {
            _id: randomUUID(),
            itemId: item._id,
            qbConnectionId: item.qbConnectionId,
            plaidAccountId: a.account_id,
            ledgerAccountId: null,
            ledgerAccountName: null,
            createdAt: now,
            removedAt: null,
          },
          $set: {
            name: a.name,
            officialName: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type ?? null,
            subtype: a.subtype ?? null,
            currency: a.balances?.iso_currency_code ?? a.balances?.unofficial_currency_code ?? null,
            currentBalanceCents: cents(a.balances?.current),
            availableBalanceCents: cents(a.balances?.available),
            balanceUpdatedAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

function reloginReason(status: ItemStatus): string {
  switch (status) {
    case "pending_expiration":
      return "The bank's permission for Scantrix expires soon. Sign in again to keep transactions coming.";
    case "pending_disconnect":
      return "The bank is about to stop sharing with Scantrix. Sign in again to keep transactions coming.";
    case "revoked":
      return "Access was withdrawn at the bank. Sign in again to reconnect.";
    default:
      return "The bank login changed or expired. Sign in again to resume syncing.";
  }
}

export async function listAccountViews(db: Db, qbConnectionId: string): Promise<BankAccountView[]> {
  const items = await db.items.find({ qbConnectionId, removedAt: null }).toArray();
  if (items.length === 0) return [];
  const byId = new Map(items.map((i) => [i._id, i]));
  const accounts = await db.accounts.find({ qbConnectionId, removedAt: null, itemId: { $in: [...byId.keys()] } }).toArray();
  const now = Date.now();
  return accounts
    .map((a) => {
      const i = byId.get(a.itemId) as ItemDoc;
      const syncing = i.syncLeaseUntil !== null && i.syncLeaseUntil.getTime() > now;
      const relogin = itemNeedsRelogin(i.status);
      return {
        id: a._id,
        itemId: a.itemId,
        institutionName: i.institutionName,
        name: a.name,
        mask: a.mask ?? undefined,
        subtype: a.subtype ?? undefined,
        currency: a.currency,
        currentBalance: a.currentBalanceCents === null ? null : a.currentBalanceCents / 100,
        lastSyncedAt: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
        status: relogin ? "needs_relogin" : syncing ? "syncing" : "connected",
        statusDetail: relogin ? reloginReason(i.status) : null,
        mappedGlAccountId: a.ledgerAccountId ?? undefined,
        mappedGlAccountName: a.ledgerAccountName ?? undefined,
        historyLoading: !i.historicalUpdateComplete,
      } satisfies BankAccountView;
    })
    .sort((x, y) => x.institutionName.localeCompare(y.institutionName) || x.name.localeCompare(y.name));
}

export async function getItemForAccount(db: Db, qbConnectionId: string, accountId: string): Promise<{ item: ItemDoc; account: AccountDoc } | null> {
  const account = await db.accounts.findOne({ _id: accountId, qbConnectionId, removedAt: null });
  if (!account) return null;
  const item = await db.items.findOne({ _id: account.itemId, qbConnectionId, removedAt: null });
  return item ? { item, account } : null;
}

export async function getItemByPlaidId(db: Db, plaidItemId: string): Promise<ItemDoc | null> {
  return db.items.findOne({ plaidItemId, removedAt: null });
}

export async function setItemStatus(db: Db, itemId: string, status: ItemStatus, errorCode: string | null): Promise<void> {
  await db.items.updateOne({ _id: itemId }, { $set: { status, errorCode, updatedAt: new Date() } });
}

export async function setItemUpdateFlags(db: Db, itemId: string, flags: { initial?: boolean; historical?: boolean }): Promise<void> {
  const set: Partial<ItemDoc> = { updatedAt: new Date() };
  if (flags.initial) set.initialUpdateComplete = true;
  if (flags.historical) set.historicalUpdateComplete = true;
  await db.items.updateOne({ _id: itemId }, { $set: set });
}

export async function setAccountMapping(db: Db, qbConnectionId: string, accountId: string, ledger: { id: string; name: string } | null): Promise<boolean> {
  const r = await db.accounts.updateOne(
    { _id: accountId, qbConnectionId, removedAt: null },
    { $set: { ledgerAccountId: ledger?.id ?? null, ledgerAccountName: ledger?.name ?? null, updatedAt: new Date() } },
  );
  return r.matchedCount === 1;
}

/** Hides one account. Returns how many accounts of its item are still shown, or -1 if not found. */
export async function removeAccount(db: Db, qbConnectionId: string, accountId: string): Promise<number> {
  const account = await db.accounts.findOneAndUpdate(
    { _id: accountId, qbConnectionId, removedAt: null },
    { $set: { removedAt: new Date(), updatedAt: new Date() } },
  );
  if (!account) return -1;
  return db.accounts.countDocuments({ itemId: account.itemId, removedAt: null });
}

export async function markItemRemoved(db: Db, itemId: string): Promise<void> {
  const now = new Date();
  // The sealed token is overwritten: once an item is removed at Plaid the token
  // is dead anyway, and nothing should be able to open it again.
  await db.items.updateOne({ _id: itemId }, { $set: { removedAt: now, status: "revoked", sealedAccessToken: "removed", updatedAt: now } });
  await db.accounts.updateMany({ itemId, removedAt: null }, { $set: { removedAt: now, updatedAt: now } });
}

export async function logEvent(
  db: Db,
  e: { qbConnectionId: string; actor: string; action: string; transactionId?: string | null; itemId?: string | null; detail?: unknown },
): Promise<void> {
  await db.events.insertOne({
    qbConnectionId: e.qbConnectionId,
    transactionId: e.transactionId ?? null,
    itemId: e.itemId ?? null,
    actor: e.actor,
    action: e.action,
    detail: e.detail ?? null,
    at: new Date(),
  });
}

export async function logWebhook(db: Db, w: { plaidItemId: string | null; webhookType: string | null; webhookCode: string | null; outcome: string }): Promise<void> {
  await db.webhooks.insertOne({ ...w, receivedAt: new Date() });
}
