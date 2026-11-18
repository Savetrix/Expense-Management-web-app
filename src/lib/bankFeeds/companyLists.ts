// SERVER-ONLY. What ScanTrix keeps about a company's lists in QuickBooks/Xero,
// so suggestions can be checked without a network call each time:
//
//   chart    — the chart of accounts with each account's type. Bank lines may
//              never be coded to a Bank-type account (Cash included): the bank
//              side of the entry is already the line's own bank account.
//   vendors  — each vendor's saved defaults. Tax on a bank line is the
//              vendor's saved tax code, or blank (Saurabh, 18 Nov call).
//   country  — the company's country in QuickBooks, when known: QuickBooks
//              outside the US wants a tax code on every expense line.
//   environment — "sandbox" or "production", when known (history defaults).
//
// Read through the token route (ledger/backend.ts → QuickBooks/Xero directly)
// when this server has the service key; otherwise the chart comes from the
// backend's own account list, which lacks some types (no Accounts Payable)
// but still says which accounts are Bank. Kept per company, refreshed when
// older than a day or when a person asks (an account they expect is missing).
import type { Db } from "./db";
import { adapterFor } from "./ledger";
import { getLedgerContext, getList } from "./ledger/backend";
import { LedgerError, type LedgerAccount, type LedgerProvider } from "./ledger/types";

export const LISTS_MAX_AGE_MS = 24 * 3_600_000;

export interface ChartAccount {
  id: string;
  /** "Parent:Child" for a QuickBooks sub-account, so it sorts under its parent. */
  name: string;
  kind: LedgerAccount["kind"];
  type: string;
  currency: string | null;
  parentId: string | null;
}

export interface VendorDefaults {
  /** ScanTrix vendor id (the id bank lines store). */
  id: string;
  name: string;
  taxCodeId: string | null;
  glAccountId: string | null;
  currency: string | null;
}

export interface CompanyListsDoc {
  /** = qbConnectionId */
  _id: string;
  provider: LedgerProvider | null;
  chart: ChartAccount[] | null;
  /** "ledger": straight from QuickBooks/Xero (every type). "backend": the backend's list (some types missing). */
  chartSource: "ledger" | "backend" | null;
  chartAt: Date | null;
  vendors: VendorDefaults[] | null;
  vendorsAt: Date | null;
  country: string | null;
  environment: string | null;
}

const fresh = (at: Date | null | undefined, now: number) => Boolean(at && now - new Date(at).getTime() < LISTS_MAX_AGE_MS);

export async function readLists(db: Db, qbConnectionId: string): Promise<CompanyListsDoc | null> {
  return db.companyLists.findOne({ _id: qbConnectionId });
}

async function save(db: Db, qbConnectionId: string, set: Partial<Omit<CompanyListsDoc, "_id">>): Promise<void> {
  await db.companyLists.updateOne({ _id: qbConnectionId }, { $set: set }, { upsert: true });
}

/** The backend's account type ("Bank", "BANK", "Credit Card"…) as a kind. */
export function kindOfType(type: string): LedgerAccount["kind"] {
  const t = type.trim().toLowerCase().replace(/[\s_]+/g, " ");
  if (t === "bank") return "bank";
  if (t === "credit card") return "card";
  if (t === "accounts payable") return "payable";
  if (t === "accounts receivable") return "receivable";
  if (t === "income" || t === "other income" || t === "revenue" || t === "sales" || t === "otherincome") return "income";
  if (t === "expense" || t === "other expense" || t === "cost of goods sold" || t === "overheads" || t === "directcosts") return "expense";
  return "other";
}

/**
 * The company's chart of accounts: from the cache when it is under a day old,
 * else from QuickBooks/Xero (or the backend's list when the token route isn't
 * available here). A failed read keeps the last good list.
 */
export async function chartFor(
  db: Db,
  userToken: string,
  qbConnectionId: string,
  opts: { force?: boolean; now?: number } = {},
): Promise<{ accounts: ChartAccount[]; source: "ledger" | "backend" | null; provider: LedgerProvider | null; ledgerError?: LedgerError }> {
  const now = opts.now ?? Date.now();
  const cached = await readLists(db, qbConnectionId);
  if (!opts.force && cached?.chart && fresh(cached.chartAt, now) && cached.chartSource === "ledger") {
    return { accounts: cached.chart, source: cached.chartSource, provider: cached.provider };
  }
  let ledgerError: LedgerError | undefined;
  try {
    const ledger = await getLedgerContext(userToken, qbConnectionId);
    const adapter = adapterFor(ledger.provider);
    const [raw, info] = await Promise.all([adapter.listAccounts(ledger), adapter.companyInfo ? adapter.companyInfo(ledger).catch(() => null) : Promise.resolve(null)]);
    const accounts: ChartAccount[] = raw.map((a) => ({ id: a.id, name: a.name, kind: a.kind, type: a.type, currency: a.currency, parentId: a.parentId ?? null }));
    await save(db, qbConnectionId, { provider: ledger.provider, chart: accounts, chartSource: "ledger", chartAt: new Date(now), environment: ledger.environment, ...(info ? { country: info.country } : {}) });
    return { accounts, source: "ledger", provider: ledger.provider };
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    ledgerError = error;
  }
  if (!opts.force && cached?.chart && fresh(cached.chartAt, now)) return { accounts: cached.chart, source: cached.chartSource, provider: cached.provider, ledgerError };
  try {
    const rows = await getList<{ qbAccountId?: string; name?: string; accountType?: string; isDeleted?: boolean; currency?: string | null }>(userToken, qbConnectionId, "/quickbooks/accounts", (d) => d.accounts as never);
    const accounts: ChartAccount[] = rows
      .filter((r) => r.qbAccountId && r.name && !r.isDeleted)
      .map((r) => ({ id: String(r.qbAccountId), name: String(r.name), kind: kindOfType(r.accountType ?? ""), type: r.accountType ?? "", currency: r.currency ?? null, parentId: null }));
    await save(db, qbConnectionId, { chart: accounts, chartSource: "backend", chartAt: new Date(now) });
    return { accounts, source: "backend", provider: cached?.provider ?? null, ledgerError };
  } catch {
    return { accounts: cached?.chart ?? [], source: cached?.chartSource ?? null, provider: cached?.provider ?? null, ledgerError };
  }
}

/** Each vendor's saved defaults, cached like the chart. */
export async function vendorsFor(db: Db, userToken: string, qbConnectionId: string, opts: { force?: boolean; now?: number } = {}): Promise<VendorDefaults[]> {
  const now = opts.now ?? Date.now();
  const cached = await readLists(db, qbConnectionId);
  if (!opts.force && cached?.vendors && fresh(cached.vendorsAt, now)) return cached.vendors;
  try {
    const rows = await getList<{ _id?: string; displayName?: string; taxCodeId?: string | null; glAccountId?: string | null; currency?: string | null }>(userToken, qbConnectionId, "/quickbooks/vendors", (d) => d.vendors as never);
    const vendors: VendorDefaults[] = rows
      .filter((v) => v._id)
      .map((v) => ({ id: String(v._id), name: v.displayName ?? "", taxCodeId: v.taxCodeId || null, glAccountId: v.glAccountId || null, currency: v.currency || null }));
    await save(db, qbConnectionId, { vendors, vendorsAt: new Date(now) });
    return vendors;
  } catch {
    return cached?.vendors ?? [];
  }
}

/**
 * Makes sure the cached vendors include this one (a vendor created a moment
 * ago isn't in a day-old list). True when the list was read again.
 */
export async function ensureVendorKnown(db: Db, userToken: string, qbConnectionId: string, vendorId: string): Promise<boolean> {
  const cached = await readLists(db, qbConnectionId);
  if (cached?.vendors?.some((v) => v.id === vendorId)) return false;
  await vendorsFor(db, userToken, qbConnectionId, { force: true });
  return true;
}

/** The bank or card accounts this company's bank lines are mapped to (Connected accounts). */
export async function mappedLedgerIds(db: Db, qbConnectionId: string): Promise<string[]> {
  const [plaid, named] = await Promise.all([
    db.accounts.find({ qbConnectionId, ledgerAccountId: { $ne: null } }, { projection: { ledgerAccountId: 1 } }).toArray(),
    db.ledgerMappings.find({ qbConnectionId }, { projection: { ledgerAccountId: 1 } }).toArray(),
  ]);
  return [...plaid.map((a) => a.ledgerAccountId), ...named.map((m) => m.ledgerAccountId)].filter((id): id is string => Boolean(id));
}

/**
 * Accounts a bank line may never be coded to: every Bank-type account in the
 * chart (Cash on hand included) and every account a bank line is mapped to.
 * Read from the cache only; refreshed by the bank page (chartFor).
 */
export async function bankSideIds(db: Db, qbConnectionId: string): Promise<Set<string>> {
  const [lists, mapped] = await Promise.all([readLists(db, qbConnectionId), mappedLedgerIds(db, qbConnectionId)]);
  return new Set([...(lists?.chart ?? []).filter((a) => a.kind === "bank").map((a) => a.id), ...mapped]);
}

/** Vendor id → its saved tax code, from the cache (vendors without one are left out). */
export async function vendorTaxCodes(db: Db, qbConnectionId: string): Promise<Map<string, string>> {
  const lists = await readLists(db, qbConnectionId);
  return new Map((lists?.vendors ?? []).filter((v) => v.taxCodeId).map((v) => [v.id, v.taxCodeId as string]));
}
