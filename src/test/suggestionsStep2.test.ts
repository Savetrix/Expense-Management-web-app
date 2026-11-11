// Smart Suggestions, step 2: the top 3 accounts from the same vendor or payee,
// payees linked to vendors, and the invoice screen's picks.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { createRule, setAutoClassification } from "../lib/bankFeeds/rules";
import { refreshSuggestions, score, vendorMemory, type Suggestion, type Vote } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { billVotes, invoicePicks, type PastBill } from "../lib/suggestions/invoicePicks";
import { historyPicks, pickReason, topPicks, type MemoryVote } from "../lib/suggestions/picks";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const vote = (gl: string, days: number, tax: string | null = null): MemoryVote => ({
  glAccountId: gl,
  taxCodeId: tax,
  decidedAt: daysAgo(days),
  evidence: { label: "Petro Canada", date: daysAgo(days).slice(0, 10), amountCents: 5420, source: "bank" },
});

describe("top 3 picks from history", () => {
  it("ranks accounts by weight, one pick per account, with the most used tax code", () => {
    const picks = historyPicks([vote("travel", 1, "gst"), vote("travel", 2, "gst"), vote("travel", 3), vote("meals", 4), vote("office", 200)], "Petro Canada", NOW);
    assert.deepEqual(picks.map((p) => p.glAccountId), ["travel", "meals", "office"]);
    assert.equal(picks[0].taxCodeId, "gst");
    assert.equal(picks[0].lines, 3);
    assert.equal(picks[2].weight, 0.5, "older than 90 days counts half");
  });

  it("is High only with 3.0 agreeing weight and 90% agreement; Medium from 60%; else Low", () => {
    assert.equal(historyPicks([vote("t", 1), vote("t", 2), vote("t", 3)], "X", NOW)[0].confidence, "high");
    assert.equal(historyPicks([vote("t", 1), vote("t", 2)], "X", NOW)[0].confidence, "medium");
    const split = historyPicks([vote("t", 1), vote("m", 2)], "X", NOW);
    assert.deepEqual(split.map((p) => p.confidence), ["low", "low"]);
  });

  it("keeps the newest 3 past items as evidence, and ignores decisions over a year old", () => {
    const picks = historyPicks([vote("t", 5), vote("t", 1), vote("t", 3), vote("t", 2), vote("t", 400)], "X", NOW);
    assert.equal(picks[0].lines, 4);
    assert.deepEqual(picks[0].evidence.map((e) => e.date), [daysAgo(1), daysAgo(2), daysAgo(3)].map((d) => d.slice(0, 10)));
  });

  it("says why in plain words", () => {
    assert.equal(pickReason({ step: "history", subject: "Petro Canada", lines: 4 }, "Travel"), "You coded Petro Canada to Travel 4 times");
    assert.equal(pickReason({ step: "history", subject: "Shell", lines: 1 }, "Travel"), "You coded Shell to Travel once");
    assert.equal(pickReason({ step: "rule", subject: "Esso", lines: 0 }, "Vehicle"), "Your company rule for Esso");
  });

  it("keeps at most 3 picks, the first of each account", () => {
    const a = historyPicks([vote("a", 1)], "X", NOW);
    const b = historyPicks([vote("a", 1), vote("b", 1), vote("c", 1), vote("d", 1)], "X", NOW);
    assert.deepEqual(topPicks(a, b).map((p) => p.glAccountId), ["a", "b", "c"]);
  });
});

describe("a bank line's suggestion carries its picks", () => {
  const line = { date: "2026-11-09", amountCents: -5420, description: "PETRO-CANADA 1234", payeeLabel: "PETRO-CANADA" };
  const v = (gl: string, days: number, extra: Partial<Vote> = {}): Vote => ({
    kind: "expense", glAccountId: gl, taxCodeId: null, vendorId: "v-petro", payee: "Petro Canada", transferLabel: null, decidedAt: daysAgo(days), ...extra,
  });

  it("puts the suggestion's own account first with its confidence, then the others", () => {
    const s = score(line, [v("travel", 1), v("travel", 2), v("travel", 3), v("meals", 4)], NOW);
    assert.deepEqual(s.picks?.map((p) => [p.glAccountId, p.confidence]), [["travel", "medium"], ["meals", "low"]]);
    assert.equal(s.picks?.[0].subject, "Petro Canada", "the payee people wrote, not the bank's text");
  });

  it("does not split agreement when a vendor was picked on only some of the lines", () => {
    const s = score(line, [v("travel", 1, { vendorId: null }), v("travel", 2, { vendorId: null }), v("travel", 3)], NOW);
    assert.equal(s.autoCoded, true);
    assert.equal(s.confidence, "high");
  });
});

describe("invoice picks", () => {
  const bill = (over: Partial<PastBill>): PastBill => ({
    id: "b1", vendorId: "v-uber", vendorName: "Uber", number: "1", date: "2026-11-01", total: 24.5, glAccountId: "travel", taxCodeId: null, decidedAt: daysAgo(5), ...over,
  });

  it("keeps the vendor default first, and company memory adds the 2nd and 3rd", () => {
    const votes = billVotes([bill({ glAccountId: "meals" }), bill({ id: "b2", glAccountId: "meals" }), bill({ id: "b3", glAccountId: "office" })], { id: "v-uber", name: "Uber" });
    const picks = invoicePicks({ vendorName: "Uber", rule: null, vendorDefault: { glAccountId: "travel", taxCodeId: null }, votes, now: NOW });
    assert.deepEqual(picks.map((p) => [p.glAccountId, p.step]), [["travel", "vendor_default"], ["meals", "history"], ["office", "history"]]);
    assert.equal(picks[0].confidence, "medium", "a default with no memory behind it is not High");
  });

  it("lets a company rule beat both", () => {
    const picks = invoicePicks({
      vendorName: "Uber",
      rule: { id: "r1", glAccountId: "vehicle", taxCodeId: "gst", label: "Uber" },
      vendorDefault: { glAccountId: "travel", taxCodeId: null },
      votes: billVotes([bill({ glAccountId: "meals" })], { id: "v-uber", name: "Uber" }),
      now: NOW,
    });
    assert.deepEqual(picks.map((p) => p.glAccountId), ["vehicle", "travel", "meals"]);
    assert.equal(picks[0].confidence, "high");
  });

  it("uses only this vendor's bills, never the bill on screen", () => {
    const votes = billVotes(
      [bill({ id: "here" }), bill({ id: "other", vendorId: "v-lyft", vendorName: "Lyft" }), bill({ id: "by-name", vendorId: null, vendorName: "UBER" })],
      { id: "v-uber", name: "Uber" },
      "here",
    );
    assert.deepEqual(votes.map((v) => v.evidence.label), ["UBER #1"]);
  });
});

describe("step 2 on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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
  const petro = (n: number) => Array.from({ length: n }, (_, i) => ({ date: today, description: `PETRO-CANADA 1234 ${i}`, amount: -(50 + i) }));
  const lineAfter = async (qb: string, id: string) => (await listTransactions(db, qb)).find((l) => l.id === id);

  async function codeLines(qb: string, n: number, total: number, patch: Parameters<typeof decide>[1]["patch"]) {
    await importCsv(db, { qbConnectionId: qb, userId: "u1", accountLabel: "RBC", rows: petro(total) });
    const lines = await listTransactions(db, qb);
    for (const l of lines.slice(0, n)) assert.ok((await decide(db, { qbConnectionId: qb, id: l.id, userId: "u1", patch })).ok);
    return lines;
  }

  it("with 3 agreeing decisions, the next line is High and filled in", async () => {
    const lines = await codeLines("qb-1", 3, 4, { glAccountId: "gl-travel", payee: "Petro Canada" });
    await refreshSuggestions(db, "qb-1");
    const next = await lineAfter("qb-1", lines[3].id);
    const s = next?.suggestion as Suggestion;
    assert.equal(next?.categoryId, "gl-travel");
    assert.equal(s.confidence, "high");
    assert.equal(s.picks?.[0].glAccountId, "gl-travel");
    assert.equal(s.picks?.[0].lines, 3);
    assert.equal(s.picks?.[0].evidence.length, 3, "the past lines it used");
  });

  it("with 2 agreeing decisions, it is suggested but not filled in", async () => {
    const lines = await codeLines("qb-1", 2, 3, { glAccountId: "gl-travel", payee: "Petro Canada" });
    await refreshSuggestions(db, "qb-1");
    const next = await lineAfter("qb-1", lines[2].id);
    const s = next?.suggestion as Suggestion;
    assert.equal(next?.categoryId, undefined);
    assert.equal(s.picks?.[0].glAccountId, "gl-travel");
    assert.notEqual(s.picks?.[0].confidence, "high");
  });

  it("lets a company rule beat history: the rule is the 1st pick, history the 2nd", async () => {
    const lines = await codeLines("qb-1", 3, 4, { glAccountId: "gl-travel", payee: "Petro Canada" });
    await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: { match: "payee", value: "petro canada", label: "Petro Canada", glAccountId: "gl-vehicle", taxCodeId: null } });
    const next = await lineAfter("qb-1", lines[3].id);
    const s = next?.suggestion as Suggestion;
    assert.equal(next?.categoryId, "gl-vehicle");
    assert.deepEqual(s.picks?.map((p) => [p.glAccountId, p.step, p.confidence]), [["gl-vehicle", "rule", "high"], ["gl-travel", "history", "medium"]]);
  });

  it("with Suggest only, fills nothing in but still shows the picks", async () => {
    await setAutoClassification(db, { qbConnectionId: "qb-1", userId: "u1", mode: "suggest" });
    const lines = await codeLines("qb-1", 3, 4, { glAccountId: "gl-travel", payee: "Petro Canada" });
    const out = await refreshSuggestions(db, "qb-1");
    assert.equal(out.autoCoded, 0);
    const next = await lineAfter("qb-1", lines[3].id);
    assert.equal(next?.categoryId, undefined);
    assert.equal((next?.suggestion as Suggestion).picks?.[0].glAccountId, "gl-travel");
  });

  it("links a payee to the vendor a person picked, and the next line gets that vendor", async () => {
    const lines = await codeLines("qb-1", 1, 2, { vendorId: "v-petro", payee: "Petro Canada" });
    await refreshSuggestions(db, "qb-1");
    const link = await db.payeeLinks.findOne({ qbConnectionId: "qb-1" });
    assert.equal(link?.vendorId, "v-petro");
    const next = await lineAfter("qb-1", lines[1].id);
    const s = next?.suggestion as Suggestion;
    assert.equal(s.vendorId, "v-petro");
    assert.equal(s.linkedVendor, true);
    assert.equal(next?.vendorId, undefined, "suggested, not saved");
    assert.ok(await db.events.findOne({ action: "suggestion.payee_linked", actor: "u1" }));
  });

  it("counts the linked vendor as known: a vendor on the 1st line, accounts only on the next 2, fills the 4th", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: petro(4) });
    const lines = await listTransactions(db, "qb-1");
    await decide(db, { qbConnectionId: "qb-1", id: lines[0].id, userId: "u1", patch: { vendorId: "v-petro", payee: "Petro Canada", glAccountId: "gl-travel" } });
    for (const l of lines.slice(1, 3)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel" } });
    await refreshSuggestions(db, "qb-1");
    const fourth = await lineAfter("qb-1", lines[3].id);
    assert.equal(fourth?.categoryId, "gl-travel");
    assert.equal(fourth?.vendorId, "v-petro");
    assert.equal((fourth?.suggestion as Suggestion).confidence, "high");
  });

  it("a payee typed on one line is enough: accounts only on the next 2 still fill the 4th", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: petro(4) });
    const lines = await listTransactions(db, "qb-1");
    await decide(db, { qbConnectionId: "qb-1", id: lines[0].id, userId: "u1", patch: { payee: "Petro Canada", glAccountId: "gl-travel" } });
    for (const l of lines.slice(1, 3)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel" } });
    await refreshSuggestions(db, "qb-1");
    const fourth = await lineAfter("qb-1", lines[3].id);
    assert.equal(fourth?.categoryId, "gl-travel");
    assert.equal(fourth?.payee, "Petro Canada");
  });

  it("without any vendor or payee, 3 agreeing accounts still wait (nothing says who was paid)", async () => {
    const lines = await codeLines("qb-1", 3, 4, { glAccountId: "gl-travel" });
    await refreshSuggestions(db, "qb-1");
    const fourth = await lineAfter("qb-1", lines[3].id);
    assert.equal(fourth?.categoryId, undefined);
    assert.equal((fourth?.suggestion as Suggestion).checks.completeness.detail, "No vendor to suggest.");
  });

  it("never lets one company's history, links or vendor memory reach another", async () => {
    await codeLines("qb-1", 3, 3, { glAccountId: "gl-travel", vendorId: "v-petro", payee: "Petro Canada" });
    await importCsv(db, { qbConnectionId: "qb-2", userId: "u9", accountLabel: "TD", rows: petro(1) });
    await refreshSuggestions(db, "qb-2");
    const [other] = await listTransactions(db, "qb-2");
    const s = other.suggestion as Suggestion;
    assert.equal(other.categoryId, undefined);
    assert.equal(s.kind, null);
    assert.deepEqual(s.picks, []);
    assert.equal(s.vendorId, undefined, "qb-1's payee link stays in qb-1");
    assert.equal((await vendorMemory(db, "qb-2", "v-petro")).length, 0);
    assert.equal((await vendorMemory(db, "qb-1", "v-petro")).length, 3);
  });

  it("vendor memory counts only a person's decisions", async () => {
    const lines = await codeLines("qb-1", 3, 4, { glAccountId: "gl-travel", vendorId: "v-petro", payee: "Petro Canada" });
    await refreshSuggestions(db, "qb-1");
    const filled = await lineAfter("qb-1", lines[3].id);
    assert.equal(filled?.categoryId, "gl-travel", "Scantrix filled the 4th line in");
    assert.equal((await vendorMemory(db, "qb-1", "v-petro")).length, 3, "but its own coding is not memory");
  });
});
