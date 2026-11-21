// Fixes from the 21 Nov end-to-end review of Smart Suggestions (steps 1-4).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { runAiPicks, type AiPicker } from "../lib/bankFeeds/aiPick";
import type { ChartAccount } from "../lib/bankFeeds/companyLists";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { refreshSuggestions, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv } from "../lib/bankFeeds/transactions";
import type { AiInput } from "../lib/suggestions/aiPick";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";
import { decideAndPost } from "./helpers/posted";

const QB = "qb-review";
const acct = (id: string, name: string, kind: ChartAccount["kind"] = "expense", type = "Expense"): ChartAccount => ({ id, name, kind, type, currency: "CAD", parentId: null });
const CHART = [acct("35", "Chequing", "bank", "Bank"), acct("sales", "Sales", "income", "Income"), acct("travel", "Travel"), acct("meals", "Meals"), acct("office", "Office")];

describe("21 Nov review fixes", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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
    await saveLists([{ id: "v-shop", tax: "gst", currency: "CAD" }, { id: "v-uber", tax: "gst", currency: "CAD" }]);
  });

  async function saveLists(vendors: { id: string; tax: string | null; currency: string | null }[], chart: ChartAccount[] = CHART) {
    await db.companyLists.updateOne(
      { _id: QB },
      { $set: { chart, chartSource: "ledger", chartAt: new Date(), environment: "sandbox", provider: "quickbooks", vendors: vendors.map((v) => ({ id: v.id, name: v.id, taxCodeId: v.tax, glAccountId: null, currency: v.currency })), vendorsAt: new Date() } },
      { upsert: true },
    );
  }
  const line = async (description: string, amount: number, date = "2026-11-18") => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "Chequing", rows: [{ date, description, amount }], currency: "CAD" });
    await refreshSuggestions(db, QB);
    const row = await db.txns.findOne({ qbConnectionId: QB, description, amountCents: Math.round(amount * 100) });
    assert.ok(row, description);
    return row;
  };
  const post = async (description: string, amount: number, date: string, glAccountId: string, vendorId: string) => {
    const t = await line(description, amount, date);
    await decideAndPost(db, { qbConnectionId: QB, id: t._id, userId: "u1", patch: { status: "ready", glAccountId, vendorId } });
  };
  const fresh = (id: string) => db.txns.findOne({ _id: id, qbConnectionId: QB });

  it("money in never speaks for money out: Shopify payouts to Sales don't fill a Shopify charge", async () => {
    for (const [i, d] of ["2026-11-02", "2026-11-09", "2026-11-16"].entries()) await post(`SHOPIFY ${1000 + i}`, 500, d, "sales", "v-shop");
    const payout = await line("SHOPIFY 1009", 480, "2026-11-19");
    assert.equal(((await fresh(payout._id))?.suggestion as Suggestion).autoCoded, true, "the same direction is still learned");
    const charge = await line("SHOPIFY 1010", -29, "2026-11-19");
    const s = (await fresh(charge._id))?.suggestion as Suggestion;
    assert.notEqual(s.glAccountId, "sales");
    assert.equal(s.autoCoded, false);
    assert.equal((await fresh(charge._id))?.glAccountId, null, "nothing filled in");
  });

  it("scoring a line ScanTrix filled again doesn't change its version, so a Post sent with it isn't refused", async () => {
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) await post("UBER TRIP", -20, d, "travel", "v-uber");
    const t = await line("UBER TRIP", -18, "2026-11-19");
    const v1 = (await fresh(t._id))?.version;
    assert.equal((await fresh(t._id))?.decidedBy, "autopilot");
    await refreshSuggestions(db, QB);
    await refreshSuggestions(db, QB);
    assert.equal((await fresh(t._id))?.version, v1);
  });

  it("a line put back in To review is scored again; clearing boxes on a review line stays a person's choice", async () => {
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) await post("UBER TRIP", -20, d, "travel", "v-uber");
    const t = await line("UBER TRIP", -18, "2026-11-19");
    const excluded = await decide(db, { qbConnectionId: QB, id: t._id, userId: "u1", patch: { status: "excluded" } });
    assert.ok(excluded.ok);
    const restored = await decide(db, { qbConnectionId: QB, id: t._id, userId: "u1", patch: { status: "review", glAccountId: null, vendorId: null, taxCodeId: null } });
    assert.ok(restored.ok);
    assert.equal((await fresh(t._id))?.decidedBy, null, "undecided again");
    await refreshSuggestions(db, QB);
    assert.equal((await fresh(t._id))?.glAccountId, "travel", "scored and filled again");
  });

  it("an account made inactive since is never suggested", async () => {
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) await post("UBER TRIP", -20, d, "travel", "v-uber");
    await saveLists([{ id: "v-uber", tax: "gst", currency: "CAD" }], CHART.filter((a) => a.id !== "travel"));
    const t = await line("UBER TRIP", -18, "2026-11-19");
    const row = await fresh(t._id);
    assert.notEqual((row?.suggestion as Suggestion).glAccountId, "travel");
    assert.equal(row?.glAccountId, null);
  });

  it("a vendor in another currency than the bank account can't make a line sure", async () => {
    await saveLists([{ id: "v-uber", tax: "gst", currency: "USD" }]);
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) await post("UBER TRIP", -20, d, "travel", "v-uber");
    const t = await line("UBER TRIP", -18, "2026-11-19");
    const s = (await fresh(t._id))?.suggestion as Suggestion;
    assert.equal(s.autoCoded, false);
    assert.match(s.checks.completeness.detail, /USD.*CAD/);
  });

  it("Off clears the suggestion on lines a person coded too, and keeps their coding", async () => {
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) await post("UBER TRIP", -20, d, "travel", "v-uber");
    const t = await line("UBER TRIP", -18, "2026-11-19");
    await decide(db, { qbConnectionId: QB, id: t._id, userId: "u1", patch: { glAccountId: "meals" } });
    await db.suggestionSettings.updateOne({ _id: QB }, { $set: { autoClassification: "off" } }, { upsert: true });
    await refreshSuggestions(db, QB);
    const row = await fresh(t._id);
    assert.equal(row?.suggestion, null);
    assert.equal(row?.glAccountId, "meals", "the person's coding stays");
  });

  describe("step 4", () => {
    const fake = (ids: string[], opts: { fail?: boolean } = {}) => {
      const calls: AiInput[] = [];
      const picker: AiPicker = {
        model: "fake:1",
        async pick(input) {
          calls.push(input);
          if (opts.fail) throw new Error("down");
          return { raw: { picks: ids.map((id) => ({ account_id: id, reason: "looks like it" })) } };
        },
      };
      return { picker, calls };
    };
    const run = (picker: AiPicker) => runAiPicks(db, QB, picker, { refresh: (keys) => refreshSuggestions(db, QB, keys) });

    it("lines with no payee name get their own question, and their picks show", async () => {
      const a = await line("POS PURCHASE 4521", -20);
      const b = await line("ONLINE TRANSFER 99812", -800);
      const ai = fake(["office"]);
      const out = await run(ai.picker);
      assert.equal(out.asked, 2, "one question per line");
      for (const t of [a, b]) assert.equal(((await fresh(t._id))?.suggestion as Suggestion).step, "ai");
    });

    it("a failed re-ask keeps the earlier good answer and waits before asking again", async () => {
      const t = await line("PUROLATOR 2231", -42.5);
      await run(fake(["office"]).picker);
      assert.equal(((await fresh(t._id))?.suggestion as Suggestion).glAccountId, "office");
      await saveLists([], [...CHART, acct("courier", "Courier")]);
      const down = fake([], { fail: true });
      await run(down.picker);
      const row = await fresh(t._id);
      assert.equal(row?.aiPick?.status, "ok", "the good answer is kept");
      assert.ok(row?.aiPick?.retryAfter, "and it waits");
      assert.equal((row?.suggestion as Suggestion).glAccountId, "office", "still shown");
      await run(down.picker);
      assert.equal(down.calls.length, 1, "not asked again within the hour");
    });
  });
});
