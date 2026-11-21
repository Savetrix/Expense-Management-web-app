// Smart Suggestions, step 4: the AI pick (lib/suggestions/aiPick.ts,
// lib/bankFeeds/aiPick.ts), with a fake AI so nothing is sent anywhere.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { isSureLine, surePatch } from "../components/v2/bankTransactions/lineCoding";
import type { BankTransaction } from "../components/v2/bankTransactions/types";
import { needsAi, runAiPicks, type AiPicker } from "../lib/bankFeeds/aiPick";
import type { ChartAccount } from "../lib/bankFeeds/companyLists";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { refreshSuggestions, type Suggestion } from "../lib/bankFeeds/suggest";
import { importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { aiAllowedAccounts, aiUserMessage, validPicks, type AiInput } from "../lib/suggestions/aiPick";
import { pickReason } from "../lib/suggestions/picks";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";
import { decideAndPost } from "./helpers/posted";

const acct = (id: string, name: string, kind: ChartAccount["kind"], type: string, over: Partial<ChartAccount> = {}): ChartAccount => ({ id, name, kind, type, currency: "CAD", parentId: null, ...over });
const CHART: ChartAccount[] = [
  acct("35", "Chequing", "bank", "Bank"),
  acct("36", "Cash on hand", "bank", "Bank"),
  acct("41", "Visa", "card", "Credit Card"),
  acct("84", "Accounts Receivable (A/R)", "receivable", "Accounts Receivable"),
  acct("33", "Accounts Payable (A/P)", "payable", "Accounts Payable"),
  acct("3", "Opening Balance Equity", "other", "Equity"),
  acct("89", "GST/HST Payable", "other", "Other Current Liability", { subtype: "GlobalTaxPayable" }),
  acct("90", "GST/HST Suspense", "other", "Other Current Liability", { subtype: "GlobalTaxSuspense" }),
  acct("13", "Meals and Entertainment", "expense", "Expense", { description: "Client meals, coffee" }),
  acct("62", "Shipping and delivery expense", "expense", "Expense"),
  acct("15", "Office Expenses", "expense", "Expense"),
  acct("58", "Travel", "expense", "Expense"),
  acct("79", "Sales", "income", "Income"),
];
const ALLOWED = ["13", "62", "15", "58", "79", "41"];
const NEVER = ["35", "36", "84", "33", "3", "89", "90"];

/** A fake AI: answers with these ids (any, even forbidden ones), and remembers what it was sent. */
function fakeAi(ids: string[] | ((input: AiInput) => string[]), opts: { hang?: boolean } = {}) {
  const calls: AiInput[] = [];
  const picker: AiPicker = {
    model: "fake:model-1",
    async pick(input) {
      calls.push(input);
      if (opts.hang) await new Promise(() => {});
      const list = typeof ids === "function" ? ids(input) : ids;
      return { raw: { picks: list.map((id) => ({ account_id: id, reason: "Looks like a courier service." })) }, usage: { input: 900, output: 60 } };
    },
  };
  return { picker, calls };
}

describe("step 4: what is sent and what is kept", () => {
  it("never offers Bank, Cash, receivable, payable, equity or tax accounts", () => {
    const ids = aiAllowedAccounts(CHART, new Set(["35"])).map((a) => a.id);
    for (const id of NEVER) assert.equal(ids.includes(id), false, `account ${id} must not be offered`);
    assert.deepEqual(ids.sort(), [...ALLOWED].sort());
    assert.equal(aiAllowedAccounts(CHART, new Set(["41"])).some((a) => a.id === "41"), false, "the line's own card account is left out");
  });

  it("drops an id that isn't in the allowed list, and keeps at most 3, each once", () => {
    const allowed = new Set(ALLOWED);
    const picks = validPicks({ picks: [{ account_id: "89", reason: "x" }, { account_id: "62", reason: "Looks like a courier." }, { account_id: "62", reason: "again" }, { account_id: "999", reason: "x" }, { account_id: "13", reason: "y" }, { account_id: "15", reason: "z" }, { account_id: "58", reason: "w" }] }, allowed);
    assert.deepEqual(picks.map((p) => p.accountId), ["62", "13", "15"]);
    assert.equal(picks[0].reason, "looks like a courier.".replace(/\.$/, ""));
    assert.deepEqual(validPicks("not json", allowed), []);
    assert.deepEqual(validPicks({ picks: [{ account_id: "35", reason: "bank" }] }, allowed), [], "nothing valid: nothing shown");
  });

  it("never sends a card number longer than the last 4 digits", () => {
    const msg = aiUserMessage({
      line: { payee: "PURO 4520 1234 5678 9012", description: "PURCHASE 4520123456789012 PUROLATOR COURIER", category: null, out: true, amount: 42.5, currency: "CAD" },
      accounts: [{ id: "62", name: "Shipping", type: "Expense", description: null }],
      past: [{ label: "VISA 4111-1111-1111-1111 CANPAR", accountId: "62" }],
    });
    // Cut to the last 4 first, then store and card numbers are dropped from the text altogether.
    assert.doesNotMatch(msg, /\d{5,}|\d{4}[ -]\d{4}[ -]\d{4}|4520|1234|4111/);
    assert.match(msg, /PURCHASE PUROLATOR COURIER/);
  });

  it("reads like an AI pick, with the account named", () => {
    assert.equal(pickReason({ step: "ai", subject: "Purolator", lines: 0, aiReason: "looks like a courier service" }, "Shipping and delivery"), "AI pick: looks like a courier service → Shipping and delivery");
  });

  it("runs only when steps 2 and 3 have nothing, or step 3 is below Medium", () => {
    assert.equal(needsAi(null), true);
    assert.equal(needsAi({ kind: null, step: "history" }), true);
    assert.equal(needsAi({ kind: "expense", step: "similar", confidence: "low" }), true);
    assert.equal(needsAi({ kind: "expense", step: "similar", confidence: "medium" }), false);
    assert.equal(needsAi({ kind: "expense", step: "history", confidence: "low" }), false, "step 2 found something");
  });
});

describe("step 4 on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  const QB = "qb-ai";
  const OTHER = "qb-other-company";
  let db: Db;

  before(async () => {
    await resetBankTestDatabase(URL!);
    db = await openTestDb(URL!);
  });
  after(async () => {
    await __closeBankDbForTests();
  });
  beforeEach(async () => {
    await clearBankTestData(db);
    for (const q of [QB, OTHER]) await db.companyLists.updateOne({ _id: q }, { $set: { chart: CHART, chartSource: "ledger", chartAt: new Date(), environment: "sandbox", provider: "quickbooks" } }, { upsert: true });
  });

  const line = async (description: string, amount = -42.5, q = QB, label = "Chequing") => {
    await importCsv(db, { qbConnectionId: q, userId: "u1", accountLabel: label, rows: [{ date: "2026-11-18", description, amount }], currency: "CAD" });
    await refreshSuggestions(db, q);
    const rows = await listTransactions(db, q, {});
    return rows.find((r) => r.description === description)!;
  };
  const view = async (id: string, q = QB) => (await listTransactions(db, q, {})).find((r) => r.id === id) as unknown as BankTransaction;
  const run = (picker: AiPicker, opts: Parameters<typeof runAiPicks>[3] = {}, q = QB) => runAiPicks(db, q, picker, { refresh: (keys) => refreshSuggestions(db, q, keys), ...opts });

  it("a company with no history gets three picks, all its own allowed accounts, all Low, never filled in", async () => {
    const t = await line("PUROLATOR 2231 MISSISSAUGA");
    const { picker, calls } = fakeAi(["62", "15", "58"]);
    const out = await run(picker);
    assert.equal(out.asked, 1);
    assert.deepEqual(calls[0].accounts.map((a) => a.id).sort(), [...ALLOWED].sort(), "only this company's allowed accounts are sent");
    const v = await view(t.id);
    const s = v.suggestion as Suggestion;
    assert.equal(s.step, "ai");
    assert.equal(s.model, "fake:model-1", "the model is stored on the suggestion");
    assert.deepEqual(s.picks?.map((p) => [p.glAccountId, p.confidence, p.step]), [["62", "low", "ai"], ["15", "low", "ai"], ["58", "low", "ai"]]);
    assert.equal(s.confidence, "low");
    assert.equal(s.autoCoded, false);
    assert.equal(v.categoryId, undefined, "never filled in");
    assert.equal(s.taxCodeId, undefined, "tax never comes from the AI");
    assert.equal(s.payee, "Purolator", "offered as a new vendor with the clean name");
    assert.match(s.reason, /^AI pick: looks like a courier service → Shipping and delivery expense$/);
    // The audit trail says which step, and the model.
    const ev = await db.events.findOne({ qbConnectionId: QB, transactionId: t.id, action: "suggestion.shown", "detail.step": "ai" });
    assert.equal((ev?.detail as { model?: string })?.model, "fake:model-1");
  });

  it("drops forbidden ids even when the AI returns them; with none left, shows nothing", async () => {
    const t = await line("ODD PAYMENT 77");
    await run(fakeAi(["35", "89", "3", "33", "84", "36"]).picker);
    const s = (await view(t.id)).suggestion as Suggestion;
    assert.equal(s.kind, null, "nothing valid: no suggestion");
    assert.equal(s.picks?.length ?? 0, 0);
  });

  it("a timeout shows nothing, blocks nothing, and posting by hand still works", async () => {
    const t = await line("SLOW COURIER 12");
    const out = await run(fakeAi(["62"], { hang: true }).picker, { timeoutMs: 50 });
    assert.equal(out.failed, 1);
    const v = await view(t.id);
    assert.equal((v.suggestion as Suggestion).kind, null);
    await decideAndPost(db, { qbConnectionId: QB, id: t.id, userId: "u1", patch: { status: "ready", glAccountId: "62" } });
    assert.equal((await db.txns.findOne({ _id: t.id }))?.postingStatus, "posted");
  });

  it("Off sends nothing; Suggest only and Fill in when sure both show the picks, never filled in", async () => {
    const t = await line("PUROLATOR 2231 MISSISSAUGA");
    await db.suggestionSettings.updateOne({ _id: QB }, { $set: { autoClassification: "off" } }, { upsert: true });
    const off = fakeAi(["62"]);
    assert.equal((await run(off.picker)).skipped, "off");
    assert.equal(off.calls.length, 0, "nothing goes to the AI with Auto-classification Off");
    for (const mode of ["suggest", "fill"] as const) {
      await db.suggestionSettings.updateOne({ _id: QB }, { $set: { autoClassification: mode } });
      await refreshSuggestions(db, QB);
      await run(fakeAi(["62"]).picker);
      const v = await view(t.id);
      assert.equal((v.suggestion as Suggestion).step, "ai", mode);
      assert.equal(v.categoryId, undefined, `${mode}: never filled in`);
      // "Post all" in "ScanTrix is sure" (and its accept) never takes a step 4 pick.
      assert.equal(isSureLine(v), false);
      assert.equal(surePatch(v), null);
    }
  });

  it("asks once: the saved answer is kept, lines with the same payee share it, and it is asked again only when the chart or the closest past items change", async () => {
    const a = await line("PUROLATOR 2231 MISSISSAUGA");
    const b = await line("PUROLATOR 2231 MISSISSAUGA", -18.2, QB, "Visa file");
    const ai = fakeAi(["62"]);
    const first = await run(ai.picker);
    assert.equal(first.asked, 1, "one question for both lines");
    assert.equal(ai.calls.length, 1);
    assert.equal(((await view(b.id)).suggestion as Suggestion).step, "ai");
    const second = await run(ai.picker);
    assert.equal(second.asked, 0, "opening the page again sends nothing");
    assert.equal(second.kept, 2);
    // A new account in the chart: asked again.
    await db.companyLists.updateOne({ _id: QB }, { $push: { chart: acct("70", "Courier", "expense", "Expense") } });
    assert.equal((await run(ai.picker)).asked, 1);
    // A similar line posted (a new closest past item): asked again.
    await db.vectors.insertMany([
      { _id: `${QB}:bank:q-a`, qbConnectionId: QB, kind: "bank", role: "query", ref: a.id, text: "PUROLATOR", textHash: "h", model: "m", vector: [1, 0, 0], out: true, glAccountId: null, taxCodeId: null, label: "Purolator", date: "2026-11-18", amountCents: 4250, decidedAt: new Date().toISOString(), source: "bank", embeddedAt: new Date() },
      { _id: `${QB}:bank:m-1`, qbConnectionId: QB, kind: "bank", role: "memory", ref: "m-1", text: "CANPAR", textHash: "h", model: "m", vector: [0.9, 0.1, 0], out: true, glAccountId: "62", taxCodeId: null, label: "Canpar", date: "2026-11-19", amountCents: 1200, decidedAt: new Date().toISOString(), source: "bank", embeddedAt: new Date() },
    ]);
    const again = await run(ai.picker);
    assert.equal(again.asked, 0, "the same payee asked within the day shares the answer");
    assert.equal(again.reused, 1);
    assert.deepEqual(ai.calls.at(-1)?.past ?? [], [], "the earlier call had no past items");
  });

  it("when step 3 is only Low, the AI's pick leads and step 3's still shows", async () => {
    const t = await line("HONK MOBILE PARKING");
    const vec = (id: string, role: "memory" | "query", ref: string, vector: number[], gl: string | null, label: string) => ({
      _id: `${QB}:bank:${id}`, qbConnectionId: QB, kind: "bank" as const, role, ref, text: label, textHash: "h", model: "m", vector, out: true, glAccountId: gl, taxCodeId: null, label, date: "2026-11-10", amountCents: 500, decidedAt: new Date().toISOString(), source: "bank" as const, embeddedAt: new Date(),
    });
    await db.vectors.insertMany([vec("q", "query", t.id, [1, 0, 0], null, "HONK"), vec("m1", "memory", "m1", [0.6, 0.8, 0], "13", "Tim Hortons")]);
    await refreshSuggestions(db, QB);
    assert.equal(((await view(t.id)).suggestion as Suggestion).step, "similar", "step 3 found one loosely alike item: Low");
    await run(fakeAi(["62", "15"]).picker);
    const s = (await view(t.id)).suggestion as Suggestion;
    assert.equal(s.step, "ai");
    assert.equal(s.glAccountId, "62");
    assert.deepEqual(s.picks?.map((p) => `${p.glAccountId}/${p.step}`), ["62/ai", "13/similar", "15/ai"]);
  });

  it("sends only this company's own past items, never another company's", async () => {
    const t = await line("NEWCO SUPPLIES 9");
    await db.vectors.insertMany([
      { _id: `${QB}:bank:q`, qbConnectionId: QB, kind: "bank", role: "query", ref: t.id, text: "NEWCO", textHash: "h", model: "m", vector: [1, 0], out: true, glAccountId: null, taxCodeId: null, label: "Newco", date: "2026-11-18", amountCents: 4250, decidedAt: new Date().toISOString(), source: "bank", embeddedAt: new Date() },
      { _id: `${QB}:bank:mine`, qbConnectionId: QB, kind: "bank", role: "memory", ref: "mine", text: "STAPLES", textHash: "h", model: "m", vector: [0.2, 1], out: true, glAccountId: "15", taxCodeId: null, label: "Staples (ours)", date: "2026-11-10", amountCents: 900, decidedAt: new Date().toISOString(), source: "bank", embeddedAt: new Date() },
      { _id: `${OTHER}:bank:theirs`, qbConnectionId: OTHER, kind: "bank", role: "memory", ref: "theirs", text: "NEWCO", textHash: "h", model: "m", vector: [1, 0], out: true, glAccountId: "15", taxCodeId: null, label: "Secret Other Co item", date: "2026-11-10", amountCents: 900, decidedAt: new Date().toISOString(), source: "bank", embeddedAt: new Date() },
    ]);
    const ai = fakeAi(["15"]);
    await run(ai.picker);
    assert.deepEqual(ai.calls[0].past.map((p) => p.label), ["Staples (ours)"]);
    assert.doesNotMatch(aiUserMessage(ai.calls[0]), /Secret Other Co/);
  });
});
