// Smart Suggestions, history: learning from the last 12 months of the
// company's own coding in QuickBooks (lib/bankFeeds/history.ts).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { historyMatches, importHistory, nameKey, payeeMatchStats, removeHistory } from "../lib/bankFeeds/history";
import { historyFromQbAnswer } from "../lib/bankFeeds/ledger/quickbooks";
import type { HistoryLine, LedgerAdapter, LedgerContext } from "../lib/bankFeeds/ledger/types";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import { postLines } from "../lib/bankFeeds/posting";
import { refreshSuggestions, vendorMemory, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { pickReason } from "../lib/suggestions/picks";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

describe("reading coded lines from QuickBooks", () => {
  it("keeps each bill line with its account and tax code, and marks the biggest one", () => {
    const lines = historyFromQbAnswer("Bill", {
      QueryResponse: {
        Bill: [
          {
            Id: "88",
            TxnDate: "2026-10-12",
            VendorRef: { value: "56", name: "Staples" },
            Line: [
              { Amount: 120, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "7" }, TaxCodeRef: { value: "5" } } },
              { Amount: 15, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "9" } } },
              { Amount: 40, DetailType: "ItemBasedExpenseLineDetail" },
            ],
          },
        ],
      },
    });
    assert.deepEqual(
      lines.map((l) => [l.line, l.accountId, l.taxCodeId, l.amountCents, l.dominant, l.vendorName]),
      [
        [0, "7", "5", 12000, true, "Staples"],
        [1, "9", null, 1500, false, "Staples"],
      ],
      "an item line has no account, so it is left out",
    );
  });

  it("reads an expense's payee and bank account, a card refund as a credit, and a bill payment", () => {
    const purchase = historyFromQbAnswer("Purchase", {
      QueryResponse: {
        Purchase: [
          { Id: "301", TxnDate: "2026-10-12", AccountRef: { value: "35" }, EntityRef: { value: "61", name: "Petro-Canada" }, Line: [{ Amount: 54.2, AccountBasedExpenseLineDetail: { AccountRef: { value: "7" } } }] },
          { Id: "302", TxnDate: "2026-10-13", AccountRef: { value: "41" }, Credit: true, Line: [{ Amount: 10, AccountBasedExpenseLineDetail: { AccountRef: { value: "7" } } }] },
        ],
      },
    });
    assert.deepEqual([purchase[0].bankAccountId, purchase[0].vendorId, purchase[0].credit], ["35", "61", false]);
    assert.equal(purchase[1].credit, true);
    const paid = historyFromQbAnswer("BillPayment", { QueryResponse: { BillPayment: [{ Id: "77", TxnDate: "2026-10-14", TotalAmt: 99.99, VendorRef: { value: "56", name: "Staples" }, CheckPayment: { BankAccountRef: { value: "35" } } }] } });
    assert.deepEqual([paid[0].accountId, paid[0].bankAccountId, paid[0].amountCents], [null, "35", 9999]);
    const deposit = historyFromQbAnswer("Deposit", {
      QueryResponse: { Deposit: [{ Id: "5", TxnDate: "2026-10-15", DepositToAccountRef: { value: "35" }, Line: [{ Amount: 500, LinkedTxn: [{}] }, { Amount: 80, DepositLineDetail: { AccountRef: { value: "4" }, Entity: { value: "9", name: "Acme" } } }] }] },
    });
    assert.deepEqual(deposit.map((l) => [l.accountId, l.vendorName, l.dominant]), [["4", "Acme", true]], "a line that only deposits a payment has no account");
  });
});

describe("matching bank payees to vendors in the books", () => {
  it("cleans a vendor name the way bank payees are cleaned", () => {
    assert.equal(nameKey("Petro-Canada Ltd."), "petro canada");
    assert.equal(nameKey("The Home Depot Inc"), "home depot");
    assert.equal(nameKey("AB"), null, "too short to match safely");
  });

  it("matches the same name, a payee that starts with it, and the letters run together", () => {
    assert.equal(historyMatches("petro canada toronto", nameKey("Petro-Canada")), true);
    assert.equal(historyMatches("petrocanada", nameKey("Petro Canada")), true);
    assert.equal(historyMatches("mcdonalds toronto", nameKey("McDonald's")), true);
    assert.equal(historyMatches("starbucks store seattle", nameKey("Starbucks")), true);
  });

  it("doesn't match on a shared first word alone", () => {
    assert.equal(historyMatches("uber trip help", nameKey("Uber Technologies")), false);
    assert.equal(historyMatches("amazon", nameKey("Amazon Web Services")), false);
    assert.equal(historyMatches("petro", nameKey("Petro-Canada")), false);
  });

  it("names the source in the reason", () => {
    const evidence = [{ label: "Petro-Canada", date: "2026-10-12", amountCents: 5420, source: "quickbooks" as const }];
    assert.equal(pickReason({ step: "history", subject: "Petro-Canada", lines: 1, historyLines: 1, historySource: "quickbooks", evidence }, "Travel"), "From your QuickBooks history: Petro-Canada, 12 Oct");
    assert.equal(pickReason({ step: "history", subject: "Petro-Canada", lines: 3, historyLines: 3, historySource: "quickbooks", evidence }, "Travel"), "From your QuickBooks history: Petro-Canada, 12 Oct (3 times in all)");
    assert.equal(pickReason({ step: "history", subject: "Petro Canada", lines: 3, historyLines: 1, historySource: "quickbooks", evidence }, "Travel"), "You coded Petro Canada to Travel twice, and once in QuickBooks");
  });
});

const QB = "qb-history";
const sandbox: LedgerContext = { provider: "quickbooks", tenantId: "R1", accessToken: "at", environment: "sandbox", shortCode: null };
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const purchase = (id: string, days: number, over: Partial<HistoryLine> = {}): HistoryLine => ({
  entity: "Purchase",
  id,
  line: 0,
  date: daysAgo(days),
  amountCents: 5420,
  vendorId: "61",
  vendorName: "Petro-Canada",
  accountId: "gl-travel",
  taxCodeId: "gst",
  bankAccountId: "35",
  credit: false,
  dominant: true,
  ...over,
});
function fakeBooks(lines: HistoryLine[]) {
  const adapter: LedgerAdapter = {
    listAccounts: async () => [{ id: "35", name: "Chequing", kind: "bank", type: "Bank", currency: "CAD" }],
    paidBills: async () => [],
    entriesBetween: async () => [],
    historyBetween: async () => lines,
    post: async () => ({ externalId: "301", url: null }),
  };
  return adapter;
}

describe("history on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const read = (lines: HistoryLine[], over: Partial<Parameters<typeof importHistory>[1]> = {}) =>
    importHistory(db, { qbConnectionId: QB, userId: "u1", ledger: { ctx: sandbox, adapter: fakeBooks(lines) }, vendorIds: new Map([["v-petro", "61"]]), scantrixBillIds: new Set(), ...over });
  const bankLine = async (description = "PETRO-CANADA 1234 TORONTO ON", amount = -54.2) => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "RBC", rows: [{ date: new Date().toISOString().slice(0, 10), description, amount }] });
    return (await listTransactions(db, QB)).find((l) => l.description === description)!;
  };
  const after_ = async (id: string) => (await listTransactions(db, QB)).find((l) => l.id === id);

  it("saves a sandbox company's coded lines, marked as from QuickBooks, with the Scantrix vendor", async () => {
    const status = await read([purchase("1", 5), purchase("2", 10)]);
    assert.equal(status.outcome, "done");
    assert.equal(status.lines, 2);
    const rows = await db.history.find({ qbConnectionId: QB }).toArray();
    assert.deepEqual(rows.map((r) => [r.source, r.vendorId, r.nameKey]).sort(), [
      ["quickbooks", "v-petro", "petro canada"],
      ["quickbooks", "v-petro", "petro canada"],
    ]);
  });

  it("leaves out entries Scantrix posted itself: its bank lines and its bills", async () => {
    const line = await bankLine("UBER TRIP", -12);
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "RBC", ledger: { id: "35", name: "Chequing" }, userId: "u1" });
    assert.ok((await decide(db, { qbConnectionId: QB, id: line.id, userId: "u1", patch: { status: "ready", glAccountId: "gl-travel" } })).ok);
    const sent = await postLines(db, { ledger: sandbox, adapter: fakeBooks([]), vendorIds: async () => new Map(), taxRates: async () => new Map(), bill: async () => null }, { qbConnectionId: QB, ids: [line.id], userId: "u1" });
    assert.equal(sent[0].ok, true, "Scantrix posted it as entry 301");
    const status = await read([purchase("301", 1), purchase("302", 2), { ...purchase("900", 3), entity: "Bill", bankAccountId: null }], { scantrixBillIds: new Set(["900"]) });
    assert.equal(status.skippedScantrix, 2);
    assert.deepEqual((await db.history.find({ qbConnectionId: QB }).toArray()).map((r) => r.entryId), ["302"]);
  });

  it("doesn't read a real company's books until that is switched on, nor a provider without a reader", async () => {
    const real = await importHistory(db, { qbConnectionId: QB, userId: "u1", ledger: { ctx: { ...sandbox, environment: "production" }, adapter: fakeBooks([purchase("1", 1)]) }, vendorIds: new Map(), scantrixBillIds: new Set() });
    assert.equal(real.outcome, "real_company");
    const { historyBetween: _none, ...noReader } = fakeBooks([purchase("1", 1)]);
    const xero = await importHistory(db, { qbConnectionId: QB, userId: "u1", ledger: { ctx: { ...sandbox, provider: "xero" }, adapter: noReader }, vendorIds: new Map(), scantrixBillIds: new Set() });
    assert.equal(xero.outcome, "provider_terms");
    assert.equal(await db.history.countDocuments({ qbConnectionId: QB }), 0);
  });

  it("counts toward the 3: a payee with 3 recent expenses in the books is filled in, and the reason names QuickBooks", async () => {
    await read([purchase("1", 5), purchase("2", 10), purchase("3", 20)]);
    const line = await bankLine();
    await refreshSuggestions(db, QB);
    const next = await after_(line.id);
    const s = next?.suggestion as Suggestion;
    assert.equal(next?.categoryId, "gl-travel");
    assert.equal(next?.taxCodeId, "gst");
    assert.equal(next?.vendorId, "v-petro", "the Scantrix vendor for the QuickBooks vendor");
    assert.match(s.reason, /QuickBooks history/);
    assert.equal(s.picks?.[0].historyLines, 3);
    assert.equal(pickReason(s.picks![0], "Travel").startsWith("From your QuickBooks history: Petro-Canada"), true);
  });

  it("uses the same recency rule: 3 expenses older than 90 days are not enough", async () => {
    await read([purchase("1", 100), purchase("2", 120), purchase("3", 150)]);
    const line = await bankLine();
    await refreshSuggestions(db, QB);
    assert.equal((await after_(line.id))?.categoryId, undefined);
  });

  it("a vendor's deposits don't speak for money going out", async () => {
    await read([1, 2, 3].map((n) => purchase(String(n), n, { entity: "Deposit", accountId: "gl-income" })));
    const line = await bankLine();
    await refreshSuggestions(db, QB);
    assert.equal((await after_(line.id))?.categoryId, undefined);
  });

  it("with the setting off, history is removed and not used", async () => {
    await read([purchase("1", 5), purchase("2", 10), purchase("3", 20)]);
    await db.suggestionSettings.updateOne({ _id: QB }, { $set: { learnFromHistory: false } }, { upsert: true });
    await removeHistory(db, QB);
    const line = await bankLine();
    await refreshSuggestions(db, QB);
    assert.equal((await after_(line.id))?.categoryId, undefined);
    assert.equal(await db.history.countDocuments({ qbConnectionId: QB }), 0);
  });

  it("feeds the invoice screen's memory for that vendor", async () => {
    await read([{ ...purchase("88", 4), entity: "Bill", bankAccountId: null }]);
    const votes = await vendorMemory(db, QB, "v-petro");
    assert.deepEqual(votes.map((v) => [v.glAccountId, v.evidence.source]), [["gl-travel", "quickbooks"]]);
  });

  it("counts how many bank payees found a vendor in the books", async () => {
    await read([purchase("1", 5)]);
    await bankLine();
    await bankLine("UBER *TRIP HELP.UBER.COM", -12);
    const stats = await payeeMatchStats(db, QB);
    assert.deepEqual([stats.total, stats.matched], [2, 1]);
    assert.equal(stats.unmatched.length, 1);
  });
});
