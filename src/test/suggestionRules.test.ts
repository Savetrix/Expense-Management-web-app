// Smart Suggestions, step 1: company rules ("Always code Esso to Vehicle expense").
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { goneFromChart } from "../lib/bankFeeds/accountCheck";
import { createRule, deleteRule, listRules, markBrokenRules, readRule, setAutoClassification, updateRule, type RuleInput } from "../lib/bankFeeds/rules";
import { type RuleLike, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { ruleFor, ruleForVendor } from "../lib/suggestions/match";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const rule = (over: Partial<RuleLike>): RuleLike => ({
  _id: "r",
  match: "payee",
  value: "esso",
  label: "Esso",
  glAccountId: "gl-vehicle",
  taxCodeId: null,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});
const line = (over: Partial<Parameters<typeof ruleFor>[1]> = {}) => ({
  payeeKey: "esso toronto on",
  description: "ESSO 5512 TORONTO ON",
  categoryPrimary: "TRANSPORTATION",
  categoryDetailed: "TRANSPORTATION_GAS",
  ...over,
});

describe("which rule codes a line", () => {
  it("matches a payee rule word by word from the start of the payee", () => {
    assert.equal(ruleFor([rule({})], line())?._id, "r");
    assert.equal(ruleFor([rule({})], line({ payeeKey: "esso" }))?._id, "r");
    assert.equal(ruleFor([rule({})], line({ payeeKey: "essolube depot" })), null, "not a different word that starts the same");
    assert.equal(ruleFor([rule({})], line({ payeeKey: "petro canada" })), null);
  });

  it("matches description words and Plaid's category", () => {
    const words = rule({ _id: "d", match: "description", value: "toronto on", label: "Toronto ON" });
    const category = rule({ _id: "c", match: "category", value: "TRANSPORTATION_GAS", label: "TRANSPORTATION_GAS" });
    assert.equal(ruleFor([words], line({ payeeKey: "x" }))?._id, "d");
    assert.equal(ruleFor([category], line({ payeeKey: "x" }))?._id, "c");
    assert.equal(ruleFor([words], line({ payeeKey: "x", description: "ESSO 5512 TORONTOON" })), null, "whole words only");
  });

  it("lets a payee rule beat a description or category rule, and the newest rule of a kind win", () => {
    const newer = new Date("2026-11-03T00:00:00Z");
    const payee = rule({ _id: "p" });
    const category = rule({ _id: "c", match: "category", value: "TRANSPORTATION_GAS", label: "TRANSPORTATION_GAS", updatedAt: newer });
    assert.equal(ruleFor([category, payee], line())?._id, "p");
    const older = rule({ _id: "old", match: "description", value: "esso", label: "esso" });
    const newest = rule({ _id: "new", match: "description", value: "toronto", label: "toronto", updatedAt: newer });
    assert.equal(ruleFor([older, newest], line({ payeeKey: "x" }))?._id, "new");
  });
});

describe("a vendor rule on an invoice", () => {
  it("matches the invoice's vendor name, and ignores description and category rules", () => {
    const uber = { match: "payee" as const, value: "uber", label: "Uber", updatedAt: "2026-11-01T00:00:00Z" };
    const words = { match: "description" as const, value: "uber", label: "uber", updatedAt: "2026-11-05T00:00:00Z" };
    assert.equal(ruleForVendor([words, uber], "Uber Canada Inc."), uber);
    assert.equal(ruleForVendor([words], "Uber Canada Inc."), null);
    assert.equal(ruleForVendor([uber], "Lyft"), null);
  });
});

describe("reading a rule from the screen", () => {
  it("keeps a payee rule as a payee key and refuses a rule with no account", () => {
    const r = readRule({ match: "payee", label: "ESSO #12", glAccountId: "gl-vehicle" }) as RuleInput;
    assert.equal(r.value, "esso");
    assert.equal(r.taxCodeId, null);
    assert.match(readRule({ match: "payee", label: "Esso" }) as string, /GL account/);
    assert.match(readRule({ match: "category", label: "gas stations!", glAccountId: "gl" }) as string, /Plaid's categories/);
    assert.match(readRule({ match: "anything", label: "x", glAccountId: "gl" }) as string, /what the rule looks at/);
  });
});

describe("rules on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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
  const esso = { match: "payee" as const, value: "esso", label: "Esso", glAccountId: "gl-vehicle", taxCodeId: "tax-gst" };

  it("fills in a payee seen for the first time, says it was the rule, and logs it", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 }] });
    const saved = await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    assert.equal(saved.filled, 1);
    const [l] = await listTransactions(db, "qb-1");
    assert.equal(l.categoryId, "gl-vehicle");
    assert.equal(l.taxCodeId, "tax-gst");
    assert.equal(l.status, "review", "filled in, never posted");
    const s = l.suggestion as Suggestion;
    assert.equal(s.step, "rule");
    assert.equal(s.confidence, "high");
    assert.equal(s.rule?.id, saved.rule.id);
    assert.match(s.reason, /company rule for Esso/);
    const ev = await db.events.findOne({ transactionId: l.id, action: "bank.autopilot_coded" });
    assert.deepEqual((ev?.detail as { step: string; ruleId: string }).step, "rule");
    assert.ok(await db.events.findOne({ action: "suggestion.rule_created", actor: "u1" }));
  });

  it("beats the payee's history", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ date: today, description: `ESSO 5512 TORONTO ON ${i}`, amount: -(40 + i) }));
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows });
    const lines = await listTransactions(db, "qb-1");
    for (const l of lines.slice(0, 3)) await decide(db, { qbConnectionId: "qb-1", id: l.id, userId: "u1", patch: { glAccountId: "gl-travel", payee: "Esso" } });
    await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    const fourth = (await listTransactions(db, "qb-1")).find((l) => l.id === lines[3].id);
    assert.equal(fourth?.categoryId, "gl-vehicle");
    assert.equal(fourth?.payee, "Esso", "the payee still comes from history");
  });

  it("never touches a line a person coded, nor another company's lines", async () => {
    const row = { date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 };
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [row, { ...row, amount: -20 }] });
    await importCsv(db, { qbConnectionId: "qb-2", userId: "u9", accountLabel: "TD", rows: [row] });
    const [mine] = await listTransactions(db, "qb-1");
    await decide(db, { qbConnectionId: "qb-1", id: mine.id, userId: "u1", patch: { glAccountId: "gl-meals" } });
    const saved = await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    assert.equal(saved.filled, 1);
    assert.equal((await db.txns.findOne({ _id: mine.id }))?.glAccountId, "gl-meals");
    const [other] = await listTransactions(db, "qb-2");
    assert.equal(other.categoryId, undefined, "qb-2 never sees qb-1's rule");
  });

  it("with Suggest only, shows the rule but fills nothing in, and takes back what was filled", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 }] });
    await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    assert.equal((await listTransactions(db, "qb-1"))[0].categoryId, "gl-vehicle", "filled while the setting is the default");
    await setAutoClassification(db, { qbConnectionId: "qb-1", userId: "admin", mode: "suggest" });
    const [l] = await listTransactions(db, "qb-1");
    assert.equal(l.categoryId, undefined, "taken back");
    const s = l.suggestion as Suggestion;
    assert.equal(s.step, "rule");
    assert.equal(s.glAccountId, "gl-vehicle", "still suggested");
    assert.equal(s.autoCoded, false);
    assert.equal(s.reason, "Your company rule for Esso.");
    const again = await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: { ...esso, match: "description", value: "toronto", label: "Toronto" } });
    assert.equal(again.autoClassification, "suggest");
    assert.ok(await db.events.findOne({ action: "suggestion.settings_changed", actor: "admin" }));
  });

  it("with Off, shows no suggestion at all", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 }] });
    await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    await setAutoClassification(db, { qbConnectionId: "qb-1", userId: "admin", mode: "off" });
    const [l] = await listTransactions(db, "qb-1");
    assert.equal(l.categoryId, undefined);
    assert.equal(l.suggestion, undefined);
    await setAutoClassification(db, { qbConnectionId: "qb-1", userId: "admin", mode: "fill" });
    assert.equal((await listTransactions(db, "qb-1"))[0].categoryId, "gl-vehicle", "back on: filled again");
  });

  it("skips a rule whose account is gone, and uses it again once the account is back", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 }] });
    await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    assert.equal(await markBrokenRules(db, { qbConnectionId: "qb-1", isGone: goneFromChart(["gl-travel"]) }), 1);
    const [rule] = await listRules(db, "qb-1");
    assert.equal(rule.broken, true);
    assert.equal((await listTransactions(db, "qb-1"))[0].categoryId, undefined, "its coding is taken back");
    assert.ok(await db.events.findOne({ action: "suggestion.rule_broken" }));
    assert.equal(await markBrokenRules(db, { qbConnectionId: "qb-1", isGone: goneFromChart(["gl-travel"]) }), 0, "nothing new to mark");
    assert.equal(await markBrokenRules(db, { qbConnectionId: "qb-1", isGone: goneFromChart(["gl-vehicle"]) }), 1);
    assert.equal((await listRules(db, "qb-1"))[0].broken, false);
    assert.equal((await listTransactions(db, "qb-1"))[0].categoryId, "gl-vehicle");
  });

  it("re-codes when the rule changes, and takes the coding back when it is deleted", async () => {
    await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 5512 TORONTO ON", amount: -61.2 }] });
    const { rule: r } = await createRule(db, { qbConnectionId: "qb-1", userId: "u1", input: esso });
    await updateRule(db, { qbConnectionId: "qb-1", userId: "u1", id: r.id, input: { ...esso, glAccountId: "gl-fuel" } });
    assert.equal((await listTransactions(db, "qb-1"))[0].categoryId, "gl-fuel");
    assert.equal(await updateRule(db, { qbConnectionId: "qb-2", userId: "u9", id: r.id, input: esso }), null, "another company can't change it");
    assert.equal(await deleteRule(db, { qbConnectionId: "qb-1", userId: "u1", id: r.id }), true);
    const [l] = await listTransactions(db, "qb-1");
    assert.equal(l.categoryId, undefined);
    assert.equal((l.suggestion as Suggestion).step, "history");
  });
});
