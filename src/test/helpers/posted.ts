// Test helpers for Smart Suggestions after the 18 Nov call: only lines POSTED
// to QuickBooks/Xero teach, and tax is the vendor's saved tax code.
import type { Db } from "../../lib/bankFeeds/db";
import type { ChartAccount } from "../../lib/bankFeeds/companyLists";
import type { PostingRecord } from "../../lib/bankFeeds/schema";
import { decide } from "../../lib/bankFeeds/transactions";

/** Marks lines as sent to QuickBooks (what posting.ts writes on success). A line still to review becomes ready first. */
export async function markPosted(db: Db, qbConnectionId: string, ids: string[], at = new Date()): Promise<void> {
  for (const id of ids) {
    const row = await db.txns.findOne({ _id: id, qbConnectionId });
    if (!row) throw new Error(`no line ${id}`);
    const kind: PostingRecord["kind"] = row.status === "matched" ? "billPayment" : row.status === "transfer" ? "transfer" : row.amountCents < 0 ? "expense" : "deposit";
    const posting: PostingRecord = {
      provider: "quickbooks",
      kind,
      idempotencyKey: `sx-${id}-1`,
      attempt: 1,
      externalId: `qb-${id.slice(0, 8)}`,
      url: null,
      viaTransactionId: null,
      error: null,
      uncertain: false,
      startedAt: at,
      postedAt: at,
      postedBy: "u1",
    };
    await db.txns.updateOne({ _id: id, qbConnectionId }, { $set: { status: row.status === "review" ? "ready" : row.status, postingStatus: "posted", posting } });
  }
}

/** A person's decision, then posted. */
export async function decideAndPost(db: Db, args: Parameters<typeof decide>[1], at?: Date): Promise<void> {
  const r = await decide(db, args);
  if (!r.ok) throw new Error(`decide failed: ${JSON.stringify(r)}`);
  await markPosted(db, args.qbConnectionId, [args.id], at);
}

/** The company's vendors and their saved tax codes, as the bank page would have cached them. */
export async function saveVendorTax(db: Db, qbConnectionId: string, taxByVendor: Record<string, string | null>): Promise<void> {
  const vendors = Object.entries(taxByVendor).map(([id, taxCodeId]) => ({ id, name: id, taxCodeId, glAccountId: null, currency: null }));
  await db.companyLists.updateOne({ _id: qbConnectionId }, { $set: { vendors, vendorsAt: new Date() } }, { upsert: true });
}

/** The company's chart of accounts, as the bank page would have cached it. */
export async function saveChart(db: Db, qbConnectionId: string, chart: Partial<ChartAccount>[]): Promise<void> {
  const accounts = chart.map((a) => ({ id: a.id ?? "", name: a.name ?? a.id ?? "", kind: a.kind ?? "expense", type: a.type ?? "", currency: a.currency ?? null, parentId: a.parentId ?? null }));
  await db.companyLists.updateOne({ _id: qbConnectionId }, { $set: { chart: accounts, chartSource: "ledger", chartAt: new Date() } }, { upsert: true });
}
