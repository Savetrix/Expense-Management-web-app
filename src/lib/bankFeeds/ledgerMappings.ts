// SERVER-ONLY. Which bank or credit-card account in QuickBooks/Xero a bank
// line's account posts to. A Plaid account keeps its mapping on its own row
// (AccountDoc); any other account — a CSV import, or the other side of a
// transfer typed by hand — is mapped by its name (LedgerMappingDoc).
import type { Db } from "./db";
import { accountLabel } from "./sync";

export interface MappedAccount {
  id: string;
  name: string;
}

/** An account that isn't a Plaid account but has lines (or is the other side of a transfer). */
export interface NamedAccountView {
  accountLabel: string;
  lines: number;
  mappedLedgerAccountId?: string;
  mappedLedgerAccountName?: string;
}

const keyOf = (qbConnectionId: string, label: string) => `${qbConnectionId}:${label.trim().toLowerCase()}`;

/** Labels of the company's Plaid accounts → their account row ids. */
async function plaidLabels(db: Db, qbConnectionId: string): Promise<Map<string, string>> {
  const accounts = await db.accounts.find({ qbConnectionId, removedAt: null }).toArray();
  if (accounts.length === 0) return new Map();
  const items = await db.items.find({ _id: { $in: [...new Set(accounts.map((a) => a.itemId))] } }).toArray();
  const inst = new Map(items.map((i) => [i._id, i.institutionName]));
  return new Map(accounts.map((a) => [accountLabel(inst.get(a.itemId) ?? "", a.name, a.mask).toLowerCase(), a._id]));
}

/** The mapped QuickBooks/Xero account for a line's account (by row id first, then by name). */
export async function ledgerAccountFor(db: Db, qbConnectionId: string, ref: { accountId?: string | null; label?: string | null }): Promise<MappedAccount | null> {
  let accountId = ref.accountId ?? null;
  if (!accountId && ref.label) accountId = (await plaidLabels(db, qbConnectionId)).get(ref.label.trim().toLowerCase()) ?? null;
  if (accountId) {
    const a = await db.accounts.findOne({ _id: accountId, qbConnectionId });
    if (a) return a.ledgerAccountId ? { id: a.ledgerAccountId, name: a.ledgerAccountName ?? a.ledgerAccountId } : null;
  }
  if (!ref.label) return null;
  const m = await db.ledgerMappings.findOne({ _id: keyOf(qbConnectionId, ref.label) });
  return m ? { id: m.ledgerAccountId, name: m.ledgerAccountName } : null;
}

export async function setNamedMapping(db: Db, args: { qbConnectionId: string; accountLabel: string; ledger: MappedAccount | null; userId: string }): Promise<void> {
  const _id = keyOf(args.qbConnectionId, args.accountLabel);
  if (!args.ledger) {
    await db.ledgerMappings.deleteOne({ _id });
    return;
  }
  await db.ledgerMappings.updateOne(
    { _id },
    {
      $set: {
        qbConnectionId: args.qbConnectionId,
        accountLabel: args.accountLabel.trim(),
        ledgerAccountId: args.ledger.id,
        ledgerAccountName: args.ledger.name,
        updatedBy: args.userId,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

/** Imported-file accounts and hand-typed transfer accounts, with their mappings. */
export async function listNamedAccounts(db: Db, qbConnectionId: string): Promise<NamedAccountView[]> {
  const [csv, transferTo, mappings, plaid] = await Promise.all([
    db.txns.aggregate<{ _id: string; n: number }>([{ $match: { qbConnectionId, removedAt: null, source: "csv" } }, { $group: { _id: "$accountLabel", n: { $sum: 1 } } }]).toArray(),
    db.txns.distinct("transferLabel", { qbConnectionId, removedAt: null, status: "transfer", transferAccountId: null }),
    db.ledgerMappings.find({ qbConnectionId }).toArray(),
    plaidLabels(db, qbConnectionId),
  ]);
  const byKey = new Map<string, NamedAccountView>();
  const add = (label: string | null | undefined, lines: number) => {
    if (!label?.trim() || plaid.has(label.trim().toLowerCase())) return;
    const k = label.trim().toLowerCase();
    const row = byKey.get(k) ?? { accountLabel: label.trim(), lines: 0 };
    row.lines += lines;
    byKey.set(k, row);
  };
  for (const c of csv) add(c._id, c.n);
  for (const t of transferTo) add(t as string, 0);
  for (const m of mappings) {
    const row = byKey.get(m.accountLabel.toLowerCase());
    if (row) Object.assign(row, { mappedLedgerAccountId: m.ledgerAccountId, mappedLedgerAccountName: m.ledgerAccountName });
  }
  return [...byKey.values()].sort((a, b) => a.accountLabel.localeCompare(b.accountLabel));
}
