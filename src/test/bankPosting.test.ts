// Sending bank lines to QuickBooks/Xero: each line exactly once, with a fake
// provider. Runs against a real MongoDB; skipped unless BANK_TEST_MONGODB_URI is set.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type Posting } from "../lib/bankFeeds/ledger/types";
import { postLines, type PostingServices } from "../lib/bankFeeds/posting";
import { decide, importCsv, listTransactions, unsortedCounts } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

/** A JSON body, read loosely in assertions. */
type Json = { [key: string]: Json } & { [index: number]: Json };

const QB = "qb-1";
const CHART: LedgerAccount[] = [
  { id: "35", name: "Business Chequing", kind: "bank", type: "Bank", currency: "CAD" },
  { id: "36", name: "Savings", kind: "bank", type: "Bank", currency: "CAD" },
  { id: "41", name: "Visa", kind: "card", type: "Credit Card", currency: "CAD" },
  { id: "7", name: "Travel", kind: "expense", type: "Expense", currency: null },
];

interface Call {
  posting: Posting;
  key: string;
}
function fakeAdapter(behaviour: (call: Call, n: number) => void | Promise<void> = () => {}) {
  const calls: Call[] = [];
  const adapter: LedgerAdapter = {
    listAccounts: async () => CHART,
    post: async (_ctx, posting, key) => {
      calls.push({ posting, key });
      await behaviour({ posting, key }, calls.length);
      return { externalId: `ext-${calls.length}`, url: `https://ledger.test/${calls.length}` };
    },
  };
  return { adapter, calls };
}
const ctx: LedgerContext = { provider: "quickbooks", tenantId: "R1", accessToken: "at", environment: "sandbox", shortCode: null };
function services(adapter: LedgerAdapter, over: Partial<PostingServices> = {}): PostingServices {
  return {
    ledger: { ...ctx },
    adapter,
    vendorIds: async () => new Map([["v-uber", "56"]]),
    taxRates: async () => new Map([["5", 5]]),
    bill: async (id) => (id === "inv-posted" ? { billId: "145", vendorId: "56" } : null),
    ...over,
  };
}

describe("sending bank lines to the accounting software", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const seed = async (rows: { date: string; description: string; amount: number }[], label = "Chequing ••4421") => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: label, rows });
    return listTransactions(db, QB);
  };
  const mapChequing = () => setNamedMapping(db, { qbConnectionId: QB, accountLabel: "Chequing ••4421", ledger: { id: "35", name: "Business Chequing" }, userId: "u1" });
  const ready = async (id: string, patch: Record<string, unknown> = {}) => {
    const r = await decide(db, { qbConnectionId: QB, id, userId: "u1", patch: { status: "ready", glAccountId: "7", vendorId: "v-uber", ...patch } });
    assert.ok(r.ok, !r.ok ? r.error : "");
  };

  it("sends a ready line once as an expense, and never again", async () => {
    const [uber] = await seed([{ date: "2026-10-02", description: "UBER *TRIP", amount: -112 }]);
    await mapChequing();
    await ready(uber.id, { taxCodeId: "5" });
    const { adapter, calls } = fakeAdapter();
    const [first] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u1" });
    assert.ok(first.ok);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      { kind: calls[0].posting.kind, amount: calls[0].posting.amount, bank: (calls[0].posting as unknown as Json).bankAccount, vendor: (calls[0].posting as unknown as Json).vendorId, rate: (calls[0].posting as unknown as Json).taxRate },
      { kind: "expense", amount: 112, bank: { id: "35", isCard: false }, vendor: "56", rate: 5 },
    );
    assert.equal(first.transaction?.postingStatus, "posted");
    assert.equal(first.transaction?.posting?.url, "https://ledger.test/1");
    const [again] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u1" });
    assert.ok(again.ok);
    assert.equal(calls.length, 1, "a posted line is not sent twice");
    const edit = await decide(db, { qbConnectionId: QB, id: uber.id, userId: "u1", patch: { status: "excluded" } });
    assert.equal(!edit.ok && edit.status, 409, "a posted line is locked");
    const ev = await db.events.findOne({ transactionId: uber.id, action: "bank.posted" });
    assert.equal(ev?.source, "web");
  });

  it("two clicks at the same moment send the line once", async () => {
    const [uber] = await seed([{ date: "2026-10-02", description: "UBER *TRIP", amount: -112 }]);
    await mapChequing();
    await ready(uber.id);
    const { adapter, calls } = fakeAdapter(() => new Promise((r) => setTimeout(r, 50)));
    const [a, b] = await Promise.all([
      postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u1" }),
      postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u2" }),
    ]);
    assert.equal(calls.length, 1);
    assert.equal([a[0].ok, b[0].ok].filter(Boolean).length, 1);
  });

  it("money in is a deposit; it needs the account mapped first", async () => {
    const [payout] = await seed([{ date: "2026-10-08", description: "STRIPE PAYOUT", amount: 2450 }]);
    await ready(payout.id, { glAccountId: "79", vendorId: null });
    const { adapter, calls } = fakeAdapter();
    const [unmapped] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [payout.id], userId: "u1" });
    assert.match(unmapped.error ?? "", /Choose which bank account in QuickBooks "Chequing ••4421" posts to/);
    assert.equal(calls.length, 0);
    const row = await db.txns.findOne({ _id: payout.id });
    assert.equal(row?.postingStatus, "failed", "the row keeps the reason");
    assert.match(row?.posting?.error ?? "", /Choose which bank account/);
    await mapChequing();
    const [ok] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [payout.id], userId: "u1" });
    assert.ok(ok.ok);
    assert.equal(calls[0].posting.kind, "deposit");
    assert.equal(calls[0].key, `sx-${payout.id}-1`, "nothing was sent before, so the first real send is attempt 1");
  });

  it("a definite refusal gets a new key next time; an unclear failure keeps the key", async () => {
    const [a, b] = await seed([
      { date: "2026-10-02", description: "UBER *TRIP", amount: -112 },
      { date: "2026-10-03", description: "UBER *TRIP 2", amount: -20 },
    ]);
    await mapChequing();
    await ready(a.id);
    await ready(b.id);
    let mode: "refuse" | "timeout" | "ok" = "refuse";
    const { adapter, calls } = fakeAdapter(() => {
      if (mode === "refuse") throw new LedgerError("Account is inactive", "definite", "validation");
      if (mode === "timeout") throw new LedgerError("no answer", "unknown", "unavailable");
    });
    const [refused] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [a.id], userId: "u1" });
    assert.equal(refused.ok, false);
    assert.equal(refused.transaction?.postingStatus, "failed");
    assert.equal(refused.transaction?.posting?.error, "Account is inactive");
    mode = "ok";
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [a.id], userId: "u1" });
    assert.notEqual(calls[1].key, calls[0].key, "nothing was created, so a fresh key");

    mode = "timeout";
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [b.id], userId: "u1" });
    // A refusal before sending (account unmapped for a moment) must not drop the key of the unclear attempt.
    await db.ledgerMappings.deleteMany({});
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [b.id], userId: "u1" });
    await mapChequing();
    mode = "ok";
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [b.id], userId: "u1" });
    assert.equal(calls.length, 4);
    assert.equal(calls[3].key, calls[2].key, "the entry may exist, so the same key: the provider answers with it");
  });

  it("a matched line pays the bill, but only once the bill is in QuickBooks", async () => {
    const [x, y] = await seed([
      { date: "2026-10-02", description: "ATLASSIAN", amount: -3600 },
      { date: "2026-10-03", description: "STAPLES", amount: -212.4 },
    ]);
    await mapChequing();
    assert.ok((await decide(db, { qbConnectionId: QB, id: x.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-posted" } })).ok);
    assert.ok((await decide(db, { qbConnectionId: QB, id: y.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-pending" } })).ok);
    const { adapter, calls } = fakeAdapter();
    const out = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [x.id, y.id], userId: "u1" });
    assert.ok(out[0].ok);
    assert.deepEqual({ kind: calls[0].posting.kind, bill: (calls[0].posting as unknown as Json).billId, vendor: (calls[0].posting as unknown as Json).vendorId }, { kind: "billPayment", bill: "145", vendor: "56" });
    assert.match(out[1].error ?? "", /isn't in QuickBooks yet/);
    assert.equal(calls.length, 1);
  });

  it("a transfer is one entry for both bank lines", async () => {
    const [out] = await seed([{ date: "2026-10-12", description: "TRANSFER TO SAVINGS", amount: -1500 }]);
    await seed([{ date: "2026-10-13", description: "TRANSFER FROM CHEQUING", amount: 1500 }], "Savings ••9001");
    const inLine = (await listTransactions(db, QB)).find((t) => t.accountName === "Savings ••9001")!;
    await mapChequing();
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "Savings ••9001", ledger: { id: "36", name: "Savings" }, userId: "u1" });
    assert.ok((await decide(db, { qbConnectionId: QB, id: out.id, userId: "u1", patch: { status: "transfer", transferLabel: "Savings ••9001" } })).ok);
    assert.ok((await decide(db, { qbConnectionId: QB, id: inLine.id, userId: "u1", patch: { status: "transfer", transferLabel: "Chequing ••4421" } })).ok);
    const { adapter, calls } = fakeAdapter();
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [out.id], userId: "u1" });
    assert.deepEqual(calls.map((c) => c.posting), [{ kind: "transfer", date: "2026-10-12", amount: 1500, memo: "TRANSFER TO SAVINGS", fromAccountId: "35", toAccountId: "36" }]);
    const other = await db.txns.findOne({ _id: inLine.id });
    assert.equal(other?.postingStatus, "posted", "the other side is marked posted by the same entry");
    assert.equal(other?.posting?.viaTransactionId, out.id);
    const [again] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [inLine.id], userId: "u1" });
    assert.ok(again.ok);
    assert.equal(calls.length, 1, "sending the other side does not make a second transfer");
  });

  it("renews the token once when the provider refuses it, keeping the key", async () => {
    const [uber] = await seed([{ date: "2026-10-02", description: "UBER *TRIP", amount: -112 }]);
    await mapChequing();
    await ready(uber.id);
    const { adapter, calls } = fakeAdapter((_c, n) => {
      if (n === 1) throw new LedgerError("token", "definite", "reconnect");
    });
    let renewed = 0;
    const [r] = await postLines(db, services(adapter, { renewLedger: async () => (renewed++, { ...ctx, accessToken: "at-2" }) }), { qbConnectionId: QB, ids: [uber.id], userId: "u1" });
    assert.ok(r.ok);
    assert.equal(renewed, 1);
    assert.equal(calls[1].key, calls[0].key);
  });

  it("stops the batch when the connection itself is the problem", async () => {
    const lines = await seed([
      { date: "2026-10-02", description: "A", amount: -1 },
      { date: "2026-10-03", description: "B", amount: -2 },
    ]);
    await mapChequing();
    for (const l of lines) await ready(l.id);
    const { adapter, calls } = fakeAdapter(() => {
      throw new LedgerError("Reconnect Xero once to allow it.", "definite", "scope");
    });
    const out = await postLines(db, services(adapter), { qbConnectionId: QB, ids: lines.map((l) => l.id), userId: "u1" });
    assert.equal(calls.length, 1);
    assert.deepEqual(out.map((o) => o.code), ["scope", "scope"]);
  });

  it("takes over a claim left by a crashed run, with the same key", async () => {
    const [uber] = await seed([{ date: "2026-10-02", description: "UBER *TRIP", amount: -112 }]);
    await mapChequing();
    await ready(uber.id);
    const { adapter, calls } = fakeAdapter((_c, n) => {
      if (n === 1) throw new LedgerError("no answer", "unknown", "unavailable");
    });
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u1" });
    // Simulate a crash mid-send: the line was left "processing" 11 minutes ago.
    await db.txns.updateOne({ _id: uber.id }, { $set: { postingStatus: "processing", "posting.startedAt": new Date(Date.now() - 11 * 60_000) } });
    const [r] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [uber.id], userId: "u1" });
    assert.ok(r.ok);
    assert.equal(calls[1].key, calls[0].key);
  });

  it("leaves review and excluded lines alone, and counts unsent lines for period close", async () => {
    const [a, b, c] = await seed([
      { date: "2026-09-02", description: "A", amount: -1 },
      { date: "2026-09-03", description: "B", amount: -2 },
      { date: "2026-09-04", description: "C", amount: -3 },
    ]);
    await mapChequing();
    await ready(a.id);
    await ready(b.id);
    const { adapter, calls } = fakeAdapter();
    const [review] = await postLines(db, services(adapter), { qbConnectionId: QB, ids: [c.id], userId: "u1" });
    assert.match(review.error ?? "", /Only lines that are ready/);
    assert.deepEqual(await unsortedCounts(db, QB, "2026-09-30"), { toReview: 1, readyToPost: 2 });
    await postLines(db, services(adapter), { qbConnectionId: QB, ids: [a.id], userId: "u1" });
    assert.deepEqual(await unsortedCounts(db, QB, "2026-09-30"), { toReview: 1, readyToPost: 1 });
    assert.equal(calls.length, 1);
  });
});
