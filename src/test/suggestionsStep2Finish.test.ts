// Smart Suggestions, finishing step 2 (Saurabh, 11 Nov): the fill-in rule,
// "Suggest only" vs "Fill in when sure", what a line shows, the "Scantrix is
// sure" section, and the auto-post lock.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { codingFor, isSureLine, surePatch } from "../components/v2/bankTransactions/lineCoding";
import type { BankTransaction } from "../components/v2/bankTransactions/types";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { setAutoClassification } from "../lib/bankFeeds/rules";
import { refreshSuggestions, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { autoPostLock, autoPostUnlockDays, earliest } from "../lib/suggestions/autoPostLock";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const suggestion = (over: Record<string, unknown> = {}) => ({
  kind: "expense",
  glAccountId: "gl-travel",
  taxCodeId: "gst",
  vendorId: "v-petro",
  payee: "Petro Canada",
  confidence: "high",
  reason: "Coded by Scantrix — 3 earlier lines for this payee were coded the same way.",
  checks: {},
  autoCoded: true,
  basis: { agreeing: 3, total: 3, lines: 3 },
  ...over,
});
const line = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  id: "t1",
  date: "2026-11-10",
  description: "PETRO-CANADA 1234",
  accountName: "RBC",
  amount: -54.2,
  status: "review",
  source: "csv",
  ...over,
});

describe("what a bank line shows", () => {
  it("a line Scantrix filled in shows its values, marked as Scantrix's", () => {
    const c = codingFor(line({ categoryId: "gl-travel", taxCodeId: "gst", vendorId: "v-petro", suggestion: suggestion() }));
    assert.equal(c.source, "autopilot");
    assert.equal(c.glAccountId, "gl-travel");
    assert.equal(c.offered, null);
  });

  it("a suggestion Scantrix didn't fill in stays out of the boxes, even when High ('Suggest only')", () => {
    const c = codingFor(line({ suggestion: suggestion({ autoCoded: false }) }));
    assert.equal(c.source, "none");
    assert.equal(c.glAccountId, undefined, "the GL box is empty");
    assert.equal(c.vendorId, undefined, "the vendor box is empty");
    assert.deepEqual(c.offered, { vendorId: "v-petro", payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
  });

  it("a Medium suggestion is offered, never shown as filled", () => {
    const c = codingFor(line({ suggestion: suggestion({ autoCoded: false, confidence: "medium" }) }));
    assert.equal(c.glAccountId, undefined);
    assert.equal(c.offered?.glAccountId, "gl-travel");
  });

  it("a person's own choice is kept as theirs", () => {
    const c = codingFor(line({ categoryId: "gl-meals", suggestion: suggestion() }));
    assert.equal(c.source, "user");
    assert.equal(c.glAccountId, "gl-meals");
  });
});

describe("the 'Scantrix is sure' section", () => {
  it("holds lines Scantrix filled in, and High suggestions under 'Suggest only'", () => {
    assert.equal(isSureLine(line({ categoryId: "gl-travel", taxCodeId: "gst", vendorId: "v-petro", suggestion: suggestion() })), true);
    assert.equal(isSureLine(line({ suggestion: suggestion({ autoCoded: false }) })), true);
  });

  it("leaves out Medium suggestions, lines a person changed, and lines already decided", () => {
    assert.equal(isSureLine(line({ suggestion: suggestion({ autoCoded: false, confidence: "medium" }) })), false);
    assert.equal(isSureLine(line({ categoryId: "gl-meals", suggestion: suggestion() })), false);
    assert.equal(isSureLine(line({ status: "ready", categoryId: "gl-travel", suggestion: suggestion() })), false);
    assert.equal(isSureLine(line({ suggestion: suggestion({ kind: "transfer", glAccountId: undefined }) })), false);
  });

  it("one click posts the vendor, GL and tax the row shows", () => {
    assert.deepEqual(surePatch(line({ suggestion: suggestion({ autoCoded: false }) })), {
      status: "ready",
      vendorId: "v-petro",
      categoryId: "gl-travel",
      taxCodeId: "gst",
      payee: "Petro Canada",
    });
    assert.equal(surePatch(line({ suggestion: suggestion({ autoCoded: false, confidence: "low" }) })), null);
  });
});

describe("the auto-post lock", () => {
  const NOW = Date.parse("2026-11-13T12:00:00Z");
  const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  it("is locked with nothing coded yet, and until 15 days after the first coded item", () => {
    assert.equal(autoPostLock(null, 15, NOW).locked, true);
    const young = autoPostLock(ago(10), 15, NOW);
    assert.equal(young.locked, true);
    assert.equal(young.days, 10);
    assert.match(young.note ?? "", /5 days to go/);
    assert.equal(autoPostLock(ago(15), 15, NOW).locked, false);
    assert.equal(autoPostLock(ago(15), 15, NOW).note, null);
  });

  it("reads the number of days from the setting, 15 when unset or wrong", () => {
    assert.equal(autoPostUnlockDays(undefined), 15);
    assert.equal(autoPostUnlockDays("30"), 30);
    assert.equal(autoPostUnlockDays("soon"), 15);
    assert.equal(autoPostLock(ago(20), 30, NOW).locked, true);
  });

  it("counts from the earliest of posted bills and coded bank lines", () => {
    assert.equal(earliest(null, ago(3), ago(20), undefined), ago(20));
    assert.equal(earliest(null, undefined), null);
  });
});

describe("filling in, on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const QB = "qb-fill";
  const today = new Date().toISOString().slice(0, 10);
  const lines = async (n: number) => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "RBC", rows: Array.from({ length: n }, (_, i) => ({ date: today, description: `PETRO-CANADA 1234 ${i}`, amount: -(50 + i) })) });
    return listTransactions(db, QB);
  };
  const code = async (id: string, patch: Parameters<typeof decide>[1]["patch"]) => assert.ok((await decide(db, { qbConnectionId: QB, id, userId: "u1", patch })).ok);
  const read = async (id: string) => (await listTransactions(db, QB)).find((l) => l.id === id);

  it("fills a line after 3 past lines with the same GL and tax, and fills the vendor they had", async () => {
    const all = await lines(4);
    for (const l of all.slice(0, 3)) await code(l.id, { vendorId: "v-petro", payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    await refreshSuggestions(db, QB);
    const next = await read(all[3].id);
    assert.equal(next?.categoryId, "gl-travel");
    assert.equal(next?.taxCodeId, "gst");
    assert.equal(next?.vendorId, "v-petro");
    assert.equal((next?.suggestion as Suggestion).autoCoded, true);
  });

  it("doesn't fill when the 3 past lines disagree on the tax code", async () => {
    const all = await lines(4);
    await code(all[0].id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    await code(all[1].id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    await code(all[2].id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "hst" });
    await refreshSuggestions(db, QB);
    const next = await read(all[3].id);
    assert.equal(next?.categoryId, undefined);
    assert.notEqual((next?.suggestion as Suggestion).confidence, "high");
  });

  it("Suggest only fills nothing, however many past lines agree", async () => {
    await setAutoClassification(db, { qbConnectionId: QB, userId: "admin", mode: "suggest" });
    const all = await lines(7);
    for (const l of all.slice(0, 6)) await code(l.id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    const out = await refreshSuggestions(db, QB);
    assert.equal(out.autoCoded, 0);
    const next = await read(all[6].id);
    assert.equal(next?.categoryId, undefined);
    assert.equal((next?.suggestion as Suggestion).confidence, "high", "still High, so it shows in the 'sure' section");
  });

  it("switching to Suggest only clears what Scantrix filled, never what a person chose", async () => {
    const all = await lines(5);
    for (const l of all.slice(0, 3)) await code(l.id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    await refreshSuggestions(db, QB);
    assert.equal((await read(all[3].id))?.categoryId, "gl-travel", "filled by Scantrix");
    await code(all[4].id, { glAccountId: "gl-meals" });

    await setAutoClassification(db, { qbConnectionId: QB, userId: "admin", mode: "suggest" });
    assert.equal((await read(all[3].id))?.categoryId, undefined, "Scantrix's fill is taken back");
    assert.equal((await read(all[4].id))?.categoryId, "gl-meals", "the person's choice stays");
    assert.equal((await read(all[0].id))?.categoryId, "gl-travel");
  });

  it("Off shows nothing at all", async () => {
    const all = await lines(4);
    for (const l of all.slice(0, 3)) await code(l.id, { payee: "Petro Canada", glAccountId: "gl-travel", taxCodeId: "gst" });
    await setAutoClassification(db, { qbConnectionId: QB, userId: "admin", mode: "off" });
    const next = await read(all[3].id);
    assert.equal(next?.categoryId, undefined);
    assert.equal(next?.suggestion, undefined);
  });
});
