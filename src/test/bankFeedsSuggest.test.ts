// Suggestions and Autopilot coding for bank lines.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { payeeKey, refreshSuggestions, score, voteWeight, type Suggestion, type Vote } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const line = { date: "2026-10-20", amountCents: -2415, description: "UBER *TRIP HELP.UBER.COM", payeeLabel: "Uber" };
const travel = (n: number, extra: Partial<Vote> = {}): Vote => ({
  kind: "expense",
  glAccountId: "gl-travel",
  taxCodeId: null,
  vendorId: "v-uber",
  payee: "Uber",
  transferLabel: null,
  decidedAt: daysAgo(n),
  ...extra,
});

describe("payee key", () => {
  it("reduces bank wording to who was paid", () => {
    assert.equal(payeeKey(null, "UBER *TRIP HELP.UBER.COM"), "uber");
    assert.equal(payeeKey("Uber", "UBER 063015 SF**POOL**"), "uber");
    assert.equal(payeeKey(null, "POS DEBIT 4421 STARBUCKS #1234 SEATTLE"), "starbucks seattle");
    assert.equal(payeeKey(null, "ACH PAYMENT GUSTO PAYROLL PPD ID 99"), "gusto payroll");
  });
});

describe("scoring", () => {
  it("weights recent decisions more than old ones, and ignores very old ones", () => {
    assert.equal(voteWeight(daysAgo(10), NOW), 1);
    assert.equal(voteWeight(daysAgo(200), NOW), 0.5);
    assert.equal(voteWeight(daysAgo(400), NOW), 0);
  });

  it("codes the line itself when 3 recent decisions agree", () => {
    const s = score(line, [travel(5), travel(20), travel(40)], NOW);
    assert.equal(s.autoCoded, true);
    assert.equal(s.confidence, "high");
    assert.equal(s.glAccountId, "gl-travel");
    assert.match(s.reason, /^Coded by Scantrix — 3 earlier lines/);
  });

  it("waits with only 2 agreeing decisions, and says why", () => {
    const s = score(line, [travel(5), travel(20)], NOW);
    assert.equal(s.autoCoded, false);
    assert.equal(s.glAccountId, "gl-travel", "still suggested");
    assert.match(s.reason, /at least 3 are needed/);
  });

  it("needs 3.0 of weight: six decisions from 4–10 months ago count as three", () => {
    const old = [200, 210, 220, 230, 240].map((d) => travel(d));
    assert.equal(score(line, old, NOW).autoCoded, false, "2.5 weight");
    assert.equal(score(line, [...old, travel(250)], NOW).autoCoded, true, "3.0 weight");
  });

  it("waits when past decisions disagree (below 90%)", () => {
    const s = score(line, [travel(1), travel(2), travel(3), travel(4), travel(5, { glAccountId: "gl-meals" })], NOW);
    assert.equal(s.autoCoded, false);
    assert.match(s.reason, /coded differently/);
  });

  it("suggests but never auto-applies an exclusion or a transfer", () => {
    const ex = (n: number): Vote => ({ ...travel(n), kind: "exclude", glAccountId: null });
    const s = score(line, [ex(1), ex(2), ex(3)], NOW);
    assert.equal(s.kind, "exclude");
    assert.equal(s.autoCoded, false);
  });

  it("holds a line that isn't clean data", () => {
    const s = score({ ...line, amountCents: 0 }, [travel(1), travel(2), travel(3)], NOW);
    assert.equal(s.autoCoded, false);
    assert.equal(s.checks.legibility.ok, false);
  });

  it("explains a new payee", () => {
    const s: Suggestion = score(line, [], NOW);
    assert.equal(s.kind, null);
    assert.match(s.reason, /New payee/);
  });
});

describe("refreshSuggestions", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const today = new Date().toISOString().slice(0, 10);
  const uberRows = (n: number) => Array.from({ length: n }, (_, i) => ({ date: today, description: `UBER *TRIP HELP.UBER.COM ${i}`, amount: -(10 + i) }));

  it("learns from the user's decisions and codes the next line by itself", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "Chase", rows: uberRows(4) });
    const lines = await listTransactions(db, "qb-1");
    for (const l of lines.slice(0, 3)) {
      const r = await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel", vendorId: "v-uber", payee: "Uber" } });
      assert.ok(r.ok);
    }
    const out = await refreshSuggestions(db, "qb-1");
    assert.equal(out.autoCoded, 1);
    const fourth = (await listTransactions(db, "qb-1")).find((l) => l.id === lines[3].id);
    assert.equal(fourth?.categoryId, "gl-travel");
    assert.equal((fourth?.suggestion as Suggestion).autoCoded, true);
    const ev = await db.events.findOne({ transactionId: lines[3].id, action: "bank.autopilot_coded" });
    assert.equal(ev?.source, "autopilot", "Scantrix's own coding is on the audit trail");
  });

  it("does not let its own coding vote, and undoes it when history changes", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "Chase", rows: uberRows(5) });
    const lines = await listTransactions(db, "qb-1");
    for (const l of lines.slice(0, 3)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel", payee: "Uber" } });
    await refreshSuggestions(db, "qb-1");
    // The user recodes two of their own decisions: history now disagrees.
    for (const l of lines.slice(0, 2)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-meals" } });
    await refreshSuggestions(db, "qb-1");
    const rows = await db.txns.find({ _id: { $in: lines.slice(3).map((l) => l.id) } }).toArray();
    for (const r of rows) {
      assert.equal(r.decidedBy, null, "Scantrix's coding was taken back");
      assert.equal(r.glAccountId, null);
    }
  });

  it("learns from posted (ready) lines too, and pre-fills a repeat after one decision", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "Chase", rows: uberRows(2) });
    const [a, b] = await listTransactions(db, "qb-1");
    await decide(db, { qbConnectionId: "qb-1", id: a.id, userId: "u1", patch: { status: "ready", glAccountId: "gl-travel", vendorId: "v-uber" } });
    await refreshSuggestions(db, "qb-1");
    const repeat = (await listTransactions(db, "qb-1")).find((l) => l.id === b.id);
    const s = repeat?.suggestion as Suggestion;
    assert.equal(s.kind, "expense");
    assert.equal(s.glAccountId, "gl-travel", "pre-filled from the one earlier decision");
    assert.equal(s.autoCoded, false, "but not coded by itself: one decision is not enough");
    assert.equal(repeat?.categoryId, undefined);
  });

  it("never touches a line the user has coded", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "Chase", rows: uberRows(4) });
    const lines = await listTransactions(db, "qb-1");
    for (const l of lines.slice(0, 3)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel", payee: "Uber" } });
    await decide(db, { qbConnectionId: "qb-1", id: lines[3].id, userId: "u2", patch: { glAccountId: "gl-client-travel" } });
    await refreshSuggestions(db, "qb-1");
    const row = await db.txns.findOne({ _id: lines[3].id });
    assert.equal(row?.glAccountId, "gl-client-travel");
  });
});
