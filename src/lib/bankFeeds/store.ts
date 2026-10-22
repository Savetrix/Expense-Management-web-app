// SERVER-ONLY. Reads and writes for bank logins (Plaid "items") and their
// accounts. Every query is scoped by qb_connection_id, which only ever comes
// from the door (door.ts), never from a request body.
import type { AccountBase } from "plaid";

import type { Db } from "./db";

export type ItemStatus = "active" | "login_required" | "pending_expiration" | "pending_disconnect" | "revoked" | "error";

export interface ItemRow {
  id: string;
  qb_connection_id: string;
  plaid_item_id: string;
  plaid_env: string;
  institution_id: string | null;
  institution_name: string;
  sealed_access_token: string;
  sync_cursor: string | null;
  status: ItemStatus;
  error_code: string | null;
  consent_expires_at: string | null;
  initial_update_complete: boolean;
  historical_update_complete: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  sync_lease_until: string | null;
  sync_requested_at: string | null;
  created_by: string;
  created_at: string;
  removed_at: string | null;
}

export interface AccountRow {
  id: string;
  item_id: string;
  qb_connection_id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currency: string | null;
  current_balance_cents: string | null;
  available_balance_cents: string | null;
  ledger_account_id: string | null;
  ledger_account_name: string | null;
  removed_at: string | null;
}

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
): Promise<ItemRow> {
  const [row] = await db.query<ItemRow>(
    `INSERT INTO bank_items (qb_connection_id, plaid_item_id, plaid_env, institution_id, institution_name, sealed_access_token, consent_expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (plaid_item_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [args.qbConnectionId, args.plaidItemId, args.plaidEnv, args.institutionId, args.institutionName, args.sealedAccessToken, args.consentExpiresAt, args.createdBy],
  );
  return row;
}

/** Inserts or refreshes the item's accounts. Accounts Plaid no longer returns are left alone. */
export async function upsertAccounts(db: Db, item: Pick<ItemRow, "id" | "qb_connection_id">, accounts: AccountBase[]): Promise<void> {
  for (const a of accounts) {
    await db.query(
      `INSERT INTO bank_accounts (item_id, qb_connection_id, plaid_account_id, name, official_name, mask, type, subtype, currency, current_balance_cents, available_balance_cents, balance_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (plaid_account_id) DO UPDATE SET
         name = EXCLUDED.name, official_name = EXCLUDED.official_name, mask = EXCLUDED.mask,
         type = EXCLUDED.type, subtype = EXCLUDED.subtype, currency = EXCLUDED.currency,
         current_balance_cents = EXCLUDED.current_balance_cents, available_balance_cents = EXCLUDED.available_balance_cents,
         balance_updated_at = now(), updated_at = now()`,
      [
        item.id,
        item.qb_connection_id,
        a.account_id,
        a.name,
        a.official_name ?? null,
        a.mask ?? null,
        a.type ?? null,
        a.subtype ?? null,
        a.balances?.iso_currency_code ?? a.balances?.unofficial_currency_code ?? null,
        cents(a.balances?.current),
        cents(a.balances?.available),
      ],
    );
  }
}

export async function listAccountViews(db: Db, qbConnectionId: string): Promise<BankAccountView[]> {
  const rows = await db.query<AccountRow & ItemRow & { account_id: string }>(
    `SELECT a.id AS account_id, a.*, i.institution_name, i.status, i.error_code, i.last_synced_at, i.historical_update_complete,
            i.initial_update_complete, i.sync_lease_until
       FROM bank_accounts a JOIN bank_items i ON i.id = a.item_id
      WHERE a.qb_connection_id = $1 AND a.removed_at IS NULL AND i.removed_at IS NULL
      ORDER BY i.institution_name, a.name`,
    [qbConnectionId],
  );
  return rows.map((r) => {
    const syncing = r.sync_lease_until !== null && new Date(r.sync_lease_until).getTime() > Date.now();
    return {
      id: r.account_id,
      itemId: r.item_id,
      institutionName: r.institution_name,
      name: r.name,
      mask: r.mask ?? undefined,
      subtype: r.subtype ?? undefined,
      currency: r.currency,
      currentBalance: r.current_balance_cents === null ? null : Number(r.current_balance_cents) / 100,
      lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
      status: itemNeedsRelogin(r.status) ? "needs_relogin" : syncing ? "syncing" : "connected",
      statusDetail: itemNeedsRelogin(r.status) ? reloginReason(r.status) : null,
      mappedGlAccountId: r.ledger_account_id ?? undefined,
      mappedGlAccountName: r.ledger_account_name ?? undefined,
      historyLoading: !r.historical_update_complete,
    };
  });
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

export async function getItemForAccount(db: Db, qbConnectionId: string, accountId: string): Promise<{ item: ItemRow; account: AccountRow } | null> {
  const rows = await db.query<AccountRow & { item: ItemRow }>(
    `SELECT a.*, row_to_json(i.*) AS item FROM bank_accounts a JOIN bank_items i ON i.id = a.item_id
      WHERE a.id = $1 AND a.qb_connection_id = $2 AND a.removed_at IS NULL AND i.removed_at IS NULL`,
    [accountId, qbConnectionId],
  );
  if (rows.length === 0) return null;
  const { item, ...account } = rows[0];
  return { item, account: account as AccountRow };
}

export async function getItemByPlaidId(db: Db, plaidItemId: string): Promise<ItemRow | null> {
  const rows = await db.query<ItemRow>("SELECT * FROM bank_items WHERE plaid_item_id = $1 AND removed_at IS NULL", [plaidItemId]);
  return rows[0] ?? null;
}

export async function getItem(db: Db, qbConnectionId: string, itemId: string): Promise<ItemRow | null> {
  const rows = await db.query<ItemRow>("SELECT * FROM bank_items WHERE id = $1 AND qb_connection_id = $2 AND removed_at IS NULL", [itemId, qbConnectionId]);
  return rows[0] ?? null;
}

export async function setItemStatus(db: Db, itemId: string, status: ItemStatus, errorCode: string | null): Promise<void> {
  await db.query("UPDATE bank_items SET status = $2, error_code = $3, updated_at = now() WHERE id = $1", [itemId, status, errorCode]);
}

export async function setAccountMapping(db: Db, qbConnectionId: string, accountId: string, ledger: { id: string; name: string } | null): Promise<boolean> {
  const rows = await db.query(
    `UPDATE bank_accounts SET ledger_account_id = $3, ledger_account_name = $4, updated_at = now()
      WHERE id = $1 AND qb_connection_id = $2 AND removed_at IS NULL RETURNING id`,
    [accountId, qbConnectionId, ledger?.id ?? null, ledger?.name ?? null],
  );
  return rows.length === 1;
}

/** Hides one account. Returns how many accounts of its item are still shown. */
export async function removeAccount(db: Db, qbConnectionId: string, accountId: string): Promise<number> {
  return db.tx(async (q) => {
    const [row] = await q<{ item_id: string }>(
      "UPDATE bank_accounts SET removed_at = now(), updated_at = now() WHERE id = $1 AND qb_connection_id = $2 AND removed_at IS NULL RETURNING item_id",
      [accountId, qbConnectionId],
    );
    if (!row) return -1;
    const [{ remaining }] = await q<{ remaining: string }>(
      "SELECT count(*) AS remaining FROM bank_accounts WHERE item_id = $1 AND removed_at IS NULL",
      [row.item_id],
    );
    return Number(remaining);
  });
}

export async function markItemRemoved(db: Db, itemId: string): Promise<void> {
  // The sealed token is overwritten: once an item is removed at Plaid the token
  // is dead anyway, and nothing should be able to open it again.
  await db.query(
    "UPDATE bank_items SET removed_at = now(), status = 'revoked', sealed_access_token = 'removed', updated_at = now() WHERE id = $1",
    [itemId],
  );
  await db.query("UPDATE bank_accounts SET removed_at = coalesce(removed_at, now()) WHERE item_id = $1", [itemId]);
}

export async function logEvent(
  db: Db,
  e: { qbConnectionId: string; actor: string; action: string; transactionId?: string | null; itemId?: string | null; detail?: unknown },
): Promise<void> {
  await db.query("INSERT INTO bank_events (qb_connection_id, transaction_id, item_id, actor, action, detail) VALUES ($1, $2, $3, $4, $5, $6)", [
    e.qbConnectionId,
    e.transactionId ?? null,
    e.itemId ?? null,
    e.actor,
    e.action,
    e.detail === undefined ? null : JSON.stringify(e.detail),
  ]);
}
