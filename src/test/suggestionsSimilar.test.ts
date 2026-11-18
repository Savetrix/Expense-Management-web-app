// Smart Suggestions, step 3: similar past items (lib/suggestions/similar.ts,
// lib/bankFeeds/similarSync.ts). A fake embedder stands in for OpenAI here, so
// these tests never call it; the live check is suggestionsSimilarLive.test.ts.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import type { Embedder } from "../lib/bankFeeds/embeddings";
import { setAutoClassification } from "../lib/bankFeeds/settings";
import type { Labeller } from "../lib/bankFeeds/shopKind";
import { cleanKind } from "../lib/bankFeeds/shopKind";
import { embedNewDecision, syncVectors } from "../lib/bankFeeds/similarSync";
import { refreshSuggestions, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import { pickReason } from "../lib/suggestions/picks";
import { bankText, cleanText, maskCardNumbers, similarPicks, suggestedVendorName, type MemoryItem } from "../lib/suggestions/similar";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const unit = (...xs: number[]) => {
  const n = Math.sqrt(xs.reduce((s, x) => s + x * x, 0));
  return xs.map((x) => x / n);
};
const item = (vector: number[], gl: string, days = 5, over: Partial<MemoryItem> = {}): MemoryItem => ({
  vector,
  out: true,
  glAccountId: gl,
  taxCodeId: null,
  decidedAt: daysAgo(days),
  evidence: { label: "Petro Canada", date: daysAgo(days).slice(0, 10), amountCents: 5000, source: "bank" },
  ...over,
});

describe("the text that is compared", () => {
  it("cuts card numbers to the last 4 and drops store numbers", () => {
    assert.equal(maskCardNumbers("PAYMENT 4520 1234 5678 9012 THANK YOU"), "PAYMENT ****9012 THANK YOU");
    assert.equal(cleanText("PETRO-CANADA 1234 TORONTO ON"), "PETRO-CANADA TORONTO ON");
    assert.doesNotMatch(bankText({ description: "VISA 4520123456789012 ESSO" }), /4520123456789012/);
  });

  it("joins the payee, the description and Plaid's category", () => {
    assert.equal(bankText({ payee: "Esso", description: "ESSO 5521 MISSISSAUGA", category: "TRANSPORTATION_GAS" }), "ESSO MISSISSAUGA | transportation gas");
    assert.equal(bankText({ payee: "Coffee shop", description: "SQ *BLUE BEAN" }), "Coffee shop | SQ BLUE BEAN");
  });

  it("offers a vendor name from the bank text", () => {
    assert.equal(suggestedVendorName(null, "PETRO-CANADA 1234 TORONTO ON"), "Petro-canada");
    assert.equal(suggestedVendorName(null, "UBER *TRIP HELP.UBER.COM"), "Uber");
    assert.equal(suggestedVendorName("Esso", "ESSO 5521"), "Esso");
  });
});

describe("similar items vote", () => {
  const fuel = unit(1, 0.05, 0);
  const coffee = unit(0, 1, 0);

  it("counts only items at the cut-off or above, in the same direction", () => {
    const picks = similarPicks({ vector: fuel, out: true }, [item(fuel, "travel"), item(coffee, "meals"), item(fuel, "refunds", 5, { out: false })], NOW);
    assert.deepEqual(picks.map((p) => p.glAccountId), ["travel"]);
    assert.equal(similarPicks({ vector: coffee, out: false }, [item(fuel, "travel")], NOW).length, 0, "nothing close: step 4's case");
  });

  it("is Medium with 3 close items and 60% of the vote, Low otherwise, never High", () => {
    const medium = similarPicks({ vector: fuel, out: true }, [item(fuel, "travel"), item(fuel, "travel", 6), item(fuel, "travel", 7), item(fuel, "vehicle", 8)], NOW);
    assert.equal(medium[0].glAccountId, "travel");
    assert.equal(medium[0].confidence, "medium");
    assert.equal(medium[1].confidence, "low");
    const two = similarPicks({ vector: fuel, out: true }, [item(fuel, "travel"), item(fuel, "travel", 6)], NOW);
    assert.equal(two[0].confidence, "low", "only 2 close items");
    assert.ok(medium.every((p) => p.step === "similar"));
  });

  it("counts recent items fully and older ones half, and lets only the nearest 20 vote", () => {
    const old = Array.from({ length: 3 }, (_, i) => item(fuel, "vehicle", 120 + i));
    const recent = Array.from({ length: 2 }, (_, i) => item(fuel, "travel", 5 + i));
    assert.equal(similarPicks({ vector: fuel, out: true }, [...old, ...recent], NOW)[0].glAccountId, "travel", "2 × 1.0 beats 3 × 0.5");
    const many = Array.from({ length: 30 }, (_, i) => item(fuel, "travel", 5 + i));
    assert.equal(similarPicks({ vector: fuel, out: true }, many, NOW)[0].lines, 20);
  });

  it("lets only items nearly as close as the closest one vote (the same-town case)", () => {
    // 2 really alike items (0.95) and 3 loosely alike ones (0.65, the town is the same).
    const q = unit(1, 0, 0);
    const meals = unit(1, 0.33, 0);
    const fuel = unit(1, 1.17, 0);
    const picks = similarPicks({ vector: q, out: true }, [item(meals, "meals"), item(meals, "meals", 6), item(fuel, "fuel"), item(fuel, "fuel", 6), item(fuel, "fuel", 7)], NOW);
    assert.equal(picks[0].glAccountId, "meals", "3 loose votes don't beat 2 close ones");
    assert.equal(picks.length, 1);
    assert.equal(picks[0].confidence, "low", "only 2 voted");
  });

  it("names the past items in the reason", () => {
    const picks = similarPicks(
      { vector: fuel, out: true },
      [
        item(fuel, "travel", 34, { evidence: { label: "Petro Canada", date: "2026-10-12", amountCents: 1, source: "bank" } }),
        item(fuel, "travel", 73, { evidence: { label: "Shell", date: "2026-09-03", amountCents: 1, source: "quickbooks" } }),
        item(fuel, "travel", 80, { evidence: { label: "Husky", date: "2026-08-27", amountCents: 1, source: "bank" } }),
      ],
      NOW,
    );
    assert.equal(pickReason(picks[0], "Travel"), "3 similar items went to Travel: Petro Canada 12 Oct, Shell 3 Sep, Husky 27 Aug");
  });
});

/** A fake embedder: fuel, coffee and software words each point one way. Counts what it was sent. */
function fakeEmbedder() {
  const sent: string[] = [];
  const embedder: Embedder = {
    model: "fake:words@3",
    async embed(texts) {
      sent.push(...texts);
      return texts.map((t) => {
        const s = t.toLowerCase();
        return unit(/petro|esso|shell|husky|fuel|gas/.test(s) ? 1 : 0.01, /coffee|starbucks|bean|tim/.test(s) ? 1 : 0.01, /adobe|zoom|slack/.test(s) ? 1 : 0.01);
      });
    },
  };
  return { embedder, sent };
}

/** A fake shop labeller: fuel words are a gas station. Counts what it was sent. */
function fakeLabeller(over: Partial<Labeller> = {}) {
  const sent: string[] = [];
  const labeller: Labeller = {
    model: "fake:kinds",
    async label(texts) {
      sent.push(...texts);
      return texts.map((t) => (/petro|esso|shell|husky/i.test(t) ? "gas station" : null));
    },
    ...over,
  };
  return { labeller, sent };
}

describe("shop kinds", () => {
  it("keeps a label short and plain", () => {
    assert.equal(cleanKind(" Gas Station "), "gas station");
    assert.equal(cleanKind("unknown"), null);
    assert.equal(cleanKind(42), null);
    assert.equal(cleanKind("a very long answer that is not a short kind of business"), null);
  });
});

describe("step 3 on real lines", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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
  async function company(qb: string, glForFuel: string) {
    await importCsv(db, {
      qbConnectionId: qb,
      userId: "u1",
      accountLabel: "RBC",
      rows: [
        { date: today, description: "PETRO-CANADA 1234 TORONTO ON", amount: -54.2 },
        { date: today, description: "SHELL 0042 OTTAWA", amount: -48.1 },
        { date: today, description: "HUSKY 77 KINGSTON", amount: -61.5 },
        { date: today, description: "ESSO 5521 MISSISSAUGA", amount: -50 },
      ],
    });
    const lines = await listTransactions(db, qb);
    for (const l of lines.filter((x) => !x.description.startsWith("ESSO"))) {
      assert.ok((await decide(db, { qbConnectionId: qb, id: l.id, userId: "u1", patch: { glAccountId: glForFuel, payee: l.description.split(" ")[0] } })).ok);
    }
    return lines.find((x) => x.description.startsWith("ESSO"))!;
  }
  const read = async (qb: string, id: string) => (await listTransactions(db, qb)).find((l) => l.id === id);

  it("suggests the company's own account for a new payee, Medium, never filled in", async () => {
    const { embedder, sent } = fakeEmbedder();
    const esso = await company("qb-a", "gl-travel");
    const out = await syncVectors(db, "qb-a", embedder);
    assert.equal(out.embedded, 4, "3 coded lines and the one to review");
    assert.ok(sent.every((t) => !/\d{5,}/.test(t)), "no long numbers are sent");
    await refreshSuggestions(db, "qb-a");
    const line = await read("qb-a", esso.id);
    const s = line?.suggestion as Suggestion;
    assert.equal(s.step, "similar");
    assert.equal(s.glAccountId, "gl-travel");
    assert.equal(s.confidence, "medium");
    assert.equal(s.autoCoded, false);
    assert.equal(line?.categoryId, undefined, "never filled in");
    assert.equal(s.payee, "Esso", "the vendor name to create");
    const vectors = await db.vectors.find({ qbConnectionId: "qb-a" }).toArray();
    assert.ok(vectors.every((v) => v.model === "fake:words@3"), "the model is stored on every vector");
  });

  it("follows the company's choice: fuel to Vehicle expense gives Vehicle expense", async () => {
    const { embedder } = fakeEmbedder();
    const esso = await company("qb-b", "gl-vehicle");
    await syncVectors(db, "qb-b", embedder);
    await refreshSuggestions(db, "qb-b");
    assert.equal(((await read("qb-b", esso.id))?.suggestion as Suggestion).glAccountId, "gl-vehicle");
  });

  it("never uses another company's items", async () => {
    const { embedder } = fakeEmbedder();
    await company("qb-a", "gl-travel");
    await importCsv(db, { qbConnectionId: "qb-c", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "ESSO 9 OTTAWA", amount: -40 }] });
    await syncVectors(db, "qb-a", embedder);
    await syncVectors(db, "qb-c", embedder);
    await refreshSuggestions(db, "qb-c");
    const [line] = await listTransactions(db, "qb-c");
    assert.notEqual((line.suggestion as Suggestion | undefined)?.step, "similar", "company C has no memory of its own");
  });

  it("sends only new or changed text the next time", async () => {
    const { embedder, sent } = fakeEmbedder();
    await company("qb-a", "gl-travel");
    await syncVectors(db, "qb-a", embedder);
    const before_ = sent.length;
    const again = await syncVectors(db, "qb-a", embedder);
    assert.equal(again.embedded, 0);
    assert.equal(sent.length, before_);
  });

  it("with Auto-classification Off, nothing is sent to the embedder", async () => {
    const { embedder, sent } = fakeEmbedder();
    await company("qb-a", "gl-travel");
    await setAutoClassification(db, { qbConnectionId: "qb-a", userId: "admin", mode: "off" });
    const out = await syncVectors(db, "qb-a", embedder);
    assert.equal(out.skipped, "off");
    assert.equal(sent.length, 0);
  });

  it("imported lines get the kind of business once, and it goes into the compared text", async () => {
    const { embedder, sent: embedded } = fakeEmbedder();
    const { labeller, sent } = fakeLabeller();
    await company("qb-a", "gl-travel");
    await syncVectors(db, "qb-a", embedder, { labeller });
    assert.equal(sent.length, 4, "the 3 coded lines and the one to review");
    assert.ok(sent.every((t) => !/\d{4}/.test(t)), "store numbers are not sent");
    const lines = await db.txns.find({ qbConnectionId: "qb-a" }).toArray();
    assert.ok(lines.every((l) => l.shopKind === "gas station"));
    assert.ok(embedded.some((t) => t.endsWith("| gas station")));
    await syncVectors(db, "qb-a", embedder, { labeller });
    assert.equal(sent.length, 4, "not asked again");
  });

  it("lines with the bank's category are never labelled, and Off sends nothing", async () => {
    const { embedder } = fakeEmbedder();
    const { labeller, sent } = fakeLabeller();
    await company("qb-a", "gl-travel");
    await db.txns.updateMany({ qbConnectionId: "qb-a" }, { $set: { categoryDetailed: "TRANSPORTATION_GAS" } });
    await syncVectors(db, "qb-a", embedder, { labeller });
    assert.equal(sent.length, 0);
    await db.txns.updateMany({ qbConnectionId: "qb-a" }, { $set: { categoryDetailed: null } });
    await setAutoClassification(db, { qbConnectionId: "qb-a", userId: "admin", mode: "off" });
    await syncVectors(db, "qb-a", embedder, { labeller });
    assert.equal(sent.length, 0);
  });

  it("a failed label call doesn't stop the sync, and is tried again next time", async () => {
    const { embedder } = fakeEmbedder();
    await company("qb-a", "gl-travel");
    const broken = fakeLabeller({ label: async () => Promise.reject(new Error("timeout")) });
    const out = await syncVectors(db, "qb-a", embedder, { labeller: broken.labeller });
    assert.equal(out.embedded, 4);
    assert.ok((await db.txns.find({ qbConnectionId: "qb-a" }).toArray()).every((l) => l.shopKind === undefined));
    const { labeller, sent } = fakeLabeller();
    await syncVectors(db, "qb-a", embedder, { labeller });
    assert.equal(sent.length, 4);
  });

  it("a line coded with only a GL account teaches the other new payees at once", async () => {
    const { embedder } = fakeEmbedder();
    await importCsv(db, {
      qbConnectionId: "qb-a",
      userId: "u1",
      accountLabel: "RBC",
      rows: [
        { date: today, description: "ADOBE CREATIVE CLOUD", amount: -89.99 },
        { date: today, description: "ZOOM.US 888-799-9666", amount: -21 },
      ],
    });
    await syncVectors(db, "qb-a", embedder);
    await refreshSuggestions(db, "qb-a");
    const lines = await listTransactions(db, "qb-a");
    const adobe = lines.find((l) => l.description.startsWith("ADOBE"))!;
    const zoom = lines.find((l) => l.description.startsWith("ZOOM"))!;
    assert.notEqual((zoom.suggestion as Suggestion | undefined)?.step, "similar", "nothing coded yet");

    // Same text, so nothing is embedded again: only the line's role and account change.
    assert.ok((await decide(db, { qbConnectionId: "qb-a", id: adobe.id, userId: "u1", patch: { glAccountId: "gl-software" } })).ok);
    const out = await embedNewDecision(db, "qb-a", embedder, null);
    assert.equal(out.embedded, 0);
    assert.equal(out.recoded, 1);
    const s = (await read("qb-a", zoom.id))?.suggestion as Suggestion;
    assert.equal(s.step, "similar");
    assert.equal(s.glAccountId, "gl-software");
  });

  it("step 2 wins for a payee the company already coded", async () => {
    const { embedder } = fakeEmbedder();
    await company("qb-a", "gl-travel");
    await importCsv(db, { qbConnectionId: "qb-a", userId: "u1", accountLabel: "RBC", rows: [{ date: today, description: "PETRO-CANADA 9999 TORONTO ON", amount: -30 }] });
    await syncVectors(db, "qb-a", embedder);
    await refreshSuggestions(db, "qb-a");
    const petro = (await listTransactions(db, "qb-a")).find((l) => l.description === "PETRO-CANADA 9999 TORONTO ON");
    assert.equal((petro?.suggestion as Suggestion).step, "history");
  });
});
