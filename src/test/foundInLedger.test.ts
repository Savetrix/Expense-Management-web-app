// Bank lines someone entered straight into QuickBooks/Xero leave To review
// (lib/bankFeeds/foundInLedger.ts). The matching rules are pure; the flow runs
// against a real MongoDB with a fake QuickBooks, skipped unless
// BANK_TEST_MONGODB_URI is set.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { findInLedger, linkFoundEntry, matchEntries, unlinkFoundEntry, type LineToCheck } from "../lib/bankFeeds/foundInLedger";
import type { LedgerAdapter, LedgerContext, LedgerEntry } from "../lib/bankFeeds/ledger/types";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import { postLines } from "../lib/bankFeeds/posting";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const entry = (over: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  key: `Purchase:${over.id}`,
  entity: "Purchase",
  accountId: "35",
  date: "2026-11-04",
  amountCents: -5420,
  label: "Expense",
  name: "Petro-Canada",
  url: `https://qbo.test/expense?txnId=${over.id}`,
  ...over,
});
const line = (over: Partial<LineToCheck> & { id: string }): LineToCheck => ({ ledgerAccountId: "35", date: "2026-11-04", amountCents: -5420, rejected: [], ...over });

describe("which entry is a bank line", () => {
  it("links a line when exactly one entry fits: same account, same amount, within 3 days", () => {
    const m = matchEntries([line({ id: "L1", date: "2026-11-06" })], [entry({ id: "1", date: "2026-11-03" })], new Set());
    assert.equal(m.links.get("L1")?.id, "1");
    assert.equal(m.possible.size, 0);
  });

  it("ignores another account, another amount, a date more than 3 days off, and entries already taken", () => {
    const entries = [
      entry({ id: "acct", accountId: "36" }),
      entry({ id: "amount", amountCents: -5421 }),
      entry({ id: "late", date: "2026-11-08" }),
      entry({ id: "mine" }),
      entry({ id: "found-before", key: "Purchase:found-before" }),
    ];
    const m = matchEntries([line({ id: "L1" })], entries, new Set(["mine", "Purchase:found-before"]));
    assert.equal(m.links.size, 0);
    assert.equal(m.possible.size, 0);
  });

  it("asks a person when two entries fit one line", () => {
    const m = matchEntries([line({ id: "L1" })], [entry({ id: "1", date: "2026-11-05" }), entry({ id: "2", date: "2026-11-04" })], new Set());
    assert.equal(m.links.size, 0);
    assert.deepEqual(m.possible.get("L1")?.map((e) => e.id), ["2", "1"], "nearest date first");
  });

  it("asks a person when one entry fits two lines (two equal payments)", () => {
    const m = matchEntries([line({ id: "L1" }), line({ id: "L2", date: "2026-11-05" })], [entry({ id: "1" })], new Set());
    assert.equal(m.links.size, 0);
    assert.equal(m.possible.size, 2);
  });

  it("never offers an entry a person said is not this line", () => {
    const m = matchEntries([line({ id: "L1", rejected: ["Purchase:1"] })], [entry({ id: "1" })], new Set());
    assert.equal(m.links.size, 0);
    assert.equal(m.possible.size, 0);
  });

  it("links both sides of one transfer to the two bank lines", () => {
    const entries = [
      entry({ id: "9", key: "Transfer:9:from", entity: "Transfer", accountId: "35", amountCents: -50000 }),
      entry({ id: "9", key: "Transfer:9:to", entity: "Transfer", accountId: "36", amountCents: 50000 }),
    ];
    const m = matchEntries([line({ id: "out", amountCents: -50000 }), line({ id: "in", ledgerAccountId: "36", amountCents: 50000 })], entries, new Set());
    assert.equal(m.links.get("out")?.key, "Transfer:9:from");
    assert.equal(m.links.get("in")?.key, "Transfer:9:to");
  });
});

const QB = "qb-found";
const ctx: LedgerContext = { provider: "quickbooks", tenantId: "R1", accessToken: "at", environment: "sandbox", shortCode: null };
function fakeLedger(entries: () => LedgerEntry[]) {
  const calls: { from: string; to: string }[] = [];
  const adapter: LedgerAdapter = {
    listAccounts: async () => [
      { id: "35", name: "Business Chequing", kind: "bank", type: "Bank", currency: "CAD" },
      { id: "7", name: "Travel", kind: "expense", type: "Expense", currency: null },
    ],
    paidBills: async () => [],
    entriesBetween: async (_ctx, from, to) => {
      calls.push({ from, to });
      return entries();
    },
    post: async () => ({ externalId: "500", url: "https://qbo.test/expense?txnId=500" }),
  };
  return { adapter, calls };
}

describe("lines already entered in the accounting software", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  let db: Db;
  before(async () => {
    await resetBankTestDatabase(URL as string);
    await __closeBankDbForTests();
    db = await openTestDb(URL as string);
  });
  after(async () => {
    await __closeBankDbForTests();
  });
  beforeEach(async () => {
    await clearBankTestData(db);
  });

  const LABEL = "Chequing ••4421";
  const seed = async (rows: { date: string; description: string; amount: number }[]) => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: LABEL, rows });
    return listTransactions(db, QB);
  };
  const mapChequing = () => setNamedMapping(db, { qbConnectionId: QB, accountLabel: LABEL, ledger: { id: "35", name: "Business Chequing" }, userId: "u1" });
  const byDescription = async (d: string) => (await listTransactions(db, QB)).find((t) => t.description === d);

  it("moves a line entered in QuickBooks to Matched, linked to that entry, and asks QuickBooks only for the dates it needs", async () => {
    await seed([
      { date: "2026-11-04", description: "PETRO-CANADA 1234", amount: -54.2 },
      { date: "2026-11-06", description: "STARBUCKS", amount: -7.85 },
    ]);
    await mapChequing();
    const { adapter, calls } = fakeLedger(() => [entry({ id: "301", date: "2026-11-05" })]);

    const outcome = await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    assert.deepEqual(outcome, { checked: 2, linked: 1, possible: 0 });
    assert.deepEqual(calls, [{ from: "2026-11-01", to: "2026-11-09" }]);

    const petro = await byDescription("PETRO-CANADA 1234");
    assert.equal(petro?.status, "matched");
    assert.equal(petro?.postingStatus, "posted");
    assert.equal(petro?.posting?.externalId, "301");
    assert.equal(petro?.posting?.found?.label, "Expense");
    assert.equal(petro?.posting?.found?.auto, true);
    assert.equal((await byDescription("STARBUCKS"))?.status, "review", "no entry for it, so it stays");

    const events = await db.events.find({ qbConnectionId: QB, action: "bank.found_in_ledger" }).toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "system");
  });

  it("does nothing for a bank account that isn't mapped to QuickBooks", async () => {
    await seed([{ date: "2026-11-04", description: "PETRO-CANADA 1234", amount: -54.2 }]);
    const { adapter, calls } = fakeLedger(() => [entry({ id: "301" })]);
    const outcome = await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    assert.deepEqual(outcome, { checked: 0, linked: 0, possible: 0 });
    assert.equal(calls.length, 0, "QuickBooks isn't asked at all");
  });

  it("never links a line to an entry Scantrix itself posted for another line", async () => {
    const [a, b] = await seed([
      { date: "2026-11-04", description: "UBER A", amount: -54.2 },
      { date: "2026-11-04", description: "UBER B", amount: -54.2 },
    ]);
    await mapChequing();
    const { adapter } = fakeLedger(() => [entry({ id: "500" })]);
    // Line A is posted from Scantrix: QuickBooks gives it entry 500.
    const sent = a.description === "UBER A" ? a : b;
    const r = await decide(db, { qbConnectionId: QB, id: sent.id, userId: "u1", patch: { status: "ready", glAccountId: "7" } });
    assert.ok(r.ok);
    const posted = await postLines(db, { ledger: { ...ctx }, adapter, vendorIds: async () => new Map(), taxRates: async () => new Map(), bill: async () => null }, { qbConnectionId: QB, ids: [sent.id], userId: "u1" });
    assert.equal(posted[0].ok, true);

    const outcome = await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    assert.equal(outcome.linked, 0);
    assert.equal((await byDescription("UBER B"))?.status, "review");
  });

  it("keeps the line in To review with the candidates when two entries fit, and a person picks one", async () => {
    const [petro] = await seed([{ date: "2026-11-04", description: "PETRO-CANADA 1234", amount: -54.2 }]);
    await mapChequing();
    const { adapter } = fakeLedger(() => [entry({ id: "301" }), entry({ id: "302", date: "2026-11-05" })]);

    const outcome = await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    assert.deepEqual(outcome, { checked: 1, linked: 0, possible: 1 });
    const waiting = await byDescription("PETRO-CANADA 1234");
    assert.equal(waiting?.status, "review");
    assert.deepEqual(waiting?.ledgerCandidates?.map((c) => [c.key, c.amount]), [
      ["Purchase:301", -54.2],
      ["Purchase:302", -54.2],
    ]);
    assert.equal(waiting?.version, petro.version, "candidates don't change the line's version");

    const refused = await linkFoundEntry(db, { qbConnectionId: QB, id: petro.id, key: "Purchase:999", userId: "u1", provider: "quickbooks" });
    assert.equal(refused.ok, false, "only an entry Scantrix found can be picked");

    const picked = await linkFoundEntry(db, { qbConnectionId: QB, id: petro.id, key: "Purchase:302", userId: "u1", provider: "quickbooks" });
    assert.ok(picked.ok);
    assert.equal(picked.ok && picked.txn.status, "matched");
    assert.equal(picked.ok && picked.txn.posting?.found?.auto, false);
    assert.equal(picked.ok && picked.txn.ledgerCandidates, undefined);
  });

  it("'Not this' puts the line back, and the next check doesn't link that entry to it again", async () => {
    await seed([{ date: "2026-11-04", description: "PETRO-CANADA 1234", amount: -54.2 }]);
    await mapChequing();
    const { adapter } = fakeLedger(() => [entry({ id: "301" })]);
    await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    const linked = await byDescription("PETRO-CANADA 1234");
    assert.equal(linked?.status, "matched");

    const back = await unlinkFoundEntry(db, { qbConnectionId: QB, id: linked!.id, userId: "u1" });
    assert.ok(back.ok);
    assert.equal(back.ok && back.txn.status, "review");
    assert.equal(back.ok && back.txn.postingStatus, undefined);

    const again = await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    assert.deepEqual(again, { checked: 1, linked: 0, possible: 0 });
    assert.equal((await byDescription("PETRO-CANADA 1234"))?.status, "review");
  });

  it("a found line can't be changed like a posted one, and 'Not this' is refused on a line Scantrix posted itself", async () => {
    const [petro] = await seed([{ date: "2026-11-04", description: "PETRO-CANADA 1234", amount: -54.2 }]);
    await mapChequing();
    const { adapter } = fakeLedger(() => [entry({ id: "301" })]);
    await findInLedger(db, { ctx, adapter }, { qbConnectionId: QB, userId: "u1" });
    const change = await decide(db, { qbConnectionId: QB, id: petro.id, userId: "u1", patch: { status: "excluded" } });
    assert.equal(change.ok, false);

    await clearBankTestData(db);
    const [sent] = await seed([{ date: "2026-11-04", description: "UBER", amount: -12 }]);
    await mapChequing();
    await decide(db, { qbConnectionId: QB, id: sent.id, userId: "u1", patch: { status: "ready", glAccountId: "7" } });
    await postLines(db, { ledger: { ...ctx }, adapter, vendorIds: async () => new Map(), taxRates: async () => new Map(), bill: async () => null }, { qbConnectionId: QB, ids: [sent.id], userId: "u1" });
    const refused = await unlinkFoundEntry(db, { qbConnectionId: QB, id: sent.id, userId: "u1" });
    assert.equal(refused.ok, false);
  });
});
