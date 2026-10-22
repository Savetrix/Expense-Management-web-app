// SERVER-ONLY. Turning a finished Plaid Link session into a stored bank login.
import { sealSecret } from "@/lib/inboundEmail/secretBox";

import type { BankFeedsConfig } from "./config";
import type { Db } from "./db";
import type { PlaidGateway } from "./plaid";
import type { ItemDoc } from "./schema";
import { insertItem, logEvent, upsertAccounts } from "./store";
import { tokenAad } from "./sync";

export interface LinkMetadata {
  institutionId: string | null;
  institutionName: string | null;
  /** Masks of the accounts the user picked in Link (last 2–4 digits). */
  accountMasks: string[];
}

/**
 * Plaid bills every Item every month, and connecting the same bank twice makes
 * two Items. Plaid's own guidance is to compare the institution and account
 * masks from Link's onSuccess metadata BEFORE exchanging the public token
 * (plaid.com/docs/link/duplicate-items/), so a duplicate is never created.
 */
export async function findDuplicateItem(db: Db, qbConnectionId: string, meta: LinkMetadata): Promise<ItemDoc | null> {
  if (!meta.institutionId || meta.accountMasks.length === 0) return null;
  const items = await db.items.find({ qbConnectionId, institutionId: meta.institutionId, removedAt: null }).toArray();
  if (items.length === 0) return null;
  const hit = await db.accounts.findOne({ itemId: { $in: items.map((i) => i._id) }, removedAt: null, mask: { $in: meta.accountMasks } });
  return hit ? (items.find((i) => i._id === hit.itemId) ?? null) : null;
}

export async function connectItem(
  db: Db,
  gateway: PlaidGateway,
  config: BankFeedsConfig,
  args: { qbConnectionId: string; userId: string; publicToken: string; meta: LinkMetadata },
): Promise<ItemDoc> {
  const { accessToken, itemId } = await gateway.exchangePublicToken(args.publicToken);
  const details = await gateway.getAccounts(accessToken);
  const institutionId = details.institutionId ?? args.meta.institutionId;
  const institutionName =
    args.meta.institutionName?.trim() || (institutionId ? await gateway.institutionName(institutionId) : null) || "Bank";

  const item = await insertItem(db, {
    qbConnectionId: args.qbConnectionId,
    plaidItemId: itemId,
    plaidEnv: config.plaidEnv,
    institutionId,
    institutionName,
    sealedAccessToken: sealSecret(accessToken, config.tokenEncryptionKey, tokenAad(itemId)),
    consentExpiresAt: details.consentExpiresAt,
    createdBy: args.userId,
  });
  await upsertAccounts(db, item, details.accounts);
  await logEvent(db, {
    qbConnectionId: args.qbConnectionId,
    itemId: item._id,
    actor: args.userId,
    action: "bank.connected",
    detail: { institutionName, accounts: details.accounts.length, env: config.plaidEnv },
  });
  return item;
}
