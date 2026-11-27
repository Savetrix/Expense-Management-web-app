// Smart Suggestions, step 3, against the real OpenAI embedder: Feature 5's
// test set. Made-up items only, no client data. Skipped unless
// RUN_OPENAI_EVAL=1 (and OPENAI_API_KEY is set), so the normal test run never
// calls OpenAI.
//
//   RUN_OPENAI_EVAL=1 node --env-file=.env.local --import tsx --test src/test/suggestionsSimilarLive.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openAiEmbedder } from "../lib/bankFeeds/embeddings";
import { openAiLabeller } from "../lib/bankFeeds/shopKind";
import { bankText, CLOSE_SIMILARITY, cosine, similarPicks, type MemoryItem } from "../lib/suggestions/similar";

const run = process.env.RUN_OPENAI_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY);
const NOW = Date.now();
const recent = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const GAS = "TRANSPORTATION_GAS";
const COFFEE = "FOOD_AND_DRINK_COFFEE";
const FAST = "FOOD_AND_DRINK_FAST_FOOD";
const SOFTWARE = "GENERAL_SERVICES_OTHER_GENERAL_SERVICES";
const OFFICE = "GENERAL_MERCHANDISE_OFFICE_SUPPLIES";

/** What the company coded before (3 lines a kind), and the account it chose. */
const PAST: { text: string; category: string; kind: "fuel" | "meals" | "software" | "office" }[] = [
  { text: "PETRO-CANADA 1234 TORONTO ON", category: GAS, kind: "fuel" },
  { text: "SHELL 0042 OTTAWA ON", category: GAS, kind: "fuel" },
  { text: "PETRO-CANADA 88 MONTREAL QC", category: GAS, kind: "fuel" },
  { text: "STARBUCKS STORE 1234 SEATTLE", category: COFFEE, kind: "meals" },
  { text: "TIM HORTONS 4411 TORONTO", category: COFFEE, kind: "meals" },
  { text: "MCDONALDS #3322 TORONTO ON", category: FAST, kind: "meals" },
  { text: "ADOBE *CREATIVE CLOUD 800-833-6687", category: SOFTWARE, kind: "software" },
  { text: "MICROSOFT*365 BUSINESS MSBILL.INFO", category: SOFTWARE, kind: "software" },
  { text: "GOOGLE *GSUITE_SCANTRIX", category: SOFTWARE, kind: "software" },
  { text: "STAPLES 112 TORONTO ON", category: OFFICE, kind: "office" },
  { text: "OFFICE DEPOT #556 BUFFALO", category: OFFICE, kind: "office" },
  { text: "STAPLES.CA ONLINE ORDER", category: OFFICE, kind: "office" },
];

/** Feature 5's set: 20 vendors new to the company, each like one it coded before. */
const NEW: { text: string; category: string; kind: "fuel" | "meals" | "software" | "office" }[] = [
  { text: "ESSO 5521 MISSISSAUGA ON", category: GAS, kind: "fuel" },
  { text: "CHEVRON 0091 VANCOUVER BC", category: GAS, kind: "fuel" },
  { text: "HUSKY 77 KINGSTON ON", category: GAS, kind: "fuel" },
  { text: "ULTRAMAR 4410 QUEBEC QC", category: GAS, kind: "fuel" },
  { text: "PIONEER 233 HAMILTON ON", category: GAS, kind: "fuel" },
  { text: "SECOND CUP 22 TORONTO", category: COFFEE, kind: "meals" },
  { text: "SUBWAY 1192 OTTAWA ON", category: FAST, kind: "meals" },
  { text: "A&W #445 CALGARY AB", category: FAST, kind: "meals" },
  { text: "WENDYS 812 TORONTO ON", category: FAST, kind: "meals" },
  { text: "COUNTRY STYLE 19 BARRIE", category: COFFEE, kind: "meals" },
  { text: "SLACK T0123ABC SAN FRANCISCO", category: SOFTWARE, kind: "software" },
  { text: "DROPBOX*8GH2KLM SUBSCR", category: SOFTWARE, kind: "software" },
  { text: "ZOOM.US 888-799-9666", category: SOFTWARE, kind: "software" },
  { text: "ATLASSIAN SYDNEY AU", category: SOFTWARE, kind: "software" },
  { text: "CANVA* 104-2938 SYDNEY", category: SOFTWARE, kind: "software" },
  { text: "GRAND & TOY 019 TORONTO", category: OFFICE, kind: "office" },
  { text: "BUREAU EN GROS 223 LAVAL QC", category: OFFICE, kind: "office" },
  { text: "ULINE *SHIP SUPPLIES 800-295", category: OFFICE, kind: "office" },
  { text: "VISTAPRINT.CA BUSINESS CARDS", category: OFFICE, kind: "office" },
  { text: "AMAZON.CA*ZX12 OFFICE PRODUCTS", category: OFFICE, kind: "office" },
];

const ACCOUNT = { fuel: "Travel", meals: "Meals", software: "Software", office: "Office supplies" } as const;

describe("step 3 with the real embedder (Feature 5's test set)", { skip: run ? false : "set RUN_OPENAI_EVAL=1 to call OpenAI" }, () => {
  it("gets the right account in the top 3 for at least 18 of the 20, and the Esso and Vehicle examples work", async () => {
    const embedder = openAiEmbedder();
    assert.ok(embedder);
    const texts = [...PAST, ...NEW].map((x) => bankText({ description: x.text, category: x.category }));
    const vectors = await embedder.embed(texts);
    const memory = (accounts: Record<string, string>): MemoryItem[] =>
      PAST.map((p, i) => ({
        vector: vectors[i],
        out: true,
        glAccountId: accounts[p.kind],
        taxCodeId: null,
        decidedAt: recent(10 + i),
        evidence: { label: p.text.split(" ")[0], date: recent(10 + i).slice(0, 10), amountCents: 1000, source: "bank" },
      }));

    const company = memory(ACCOUNT);
    let right = 0;
    const report: string[] = [];
    NEW.forEach((n, j) => {
      const v = vectors[PAST.length + j];
      const picks = similarPicks({ vector: v, out: true }, company, NOW);
      const sims = company.map((m) => cosine(v, m.vector)).sort((a, b) => b - a);
      const ok = picks.slice(0, 3).some((p) => p.glAccountId === ACCOUNT[n.kind]);
      if (ok) right++;
      report.push(`${ok ? "OK  " : "MISS"} ${n.text.padEnd(32)} best similarity ${sims[0].toFixed(3)}  picks: ${picks.map((p) => `${p.glAccountId}/${p.confidence}`).join(", ") || "none"}`);
    });
    console.log(`\nStep 3, threshold ${CLOSE_SIMILARITY}: ${right} of ${NEW.length} right in the top 3\n${report.join("\n")}`);

    // The Esso example: Petro Canada fuel coded to Travel → Esso gets Travel.
    const esso = vectors[PAST.length];
    const essoPicks = similarPicks({ vector: esso, out: true }, company, NOW);
    console.log(`Esso → ${essoPicks.map((p) => p.glAccountId).join(", ") || "none"}`);
    // The same company coding fuel to Vehicle expense gets Vehicle expense.
    const vehicle = similarPicks({ vector: esso, out: true }, memory({ ...ACCOUNT, fuel: "Vehicle expense" }), NOW);
    console.log(`Esso, fuel coded to Vehicle expense → ${vehicle.map((p) => p.glAccountId).join(", ") || "none"}`);

    assert.ok(right >= 18, `${right} of 20 right; at least 18 needed`);
    assert.equal(essoPicks[0]?.glAccountId, "Travel");
    assert.equal(vehicle[0]?.glAccountId, "Vehicle expense");
  });

  it("imported files (no bank category): with the kind of business, still at least 18 of 20, and the same-town trap at least 8 of 10", async () => {
    const embedder = openAiEmbedder();
    const labeller = openAiLabeller();
    assert.ok(embedder && labeller);
    const score = async (past: typeof PAST, news: typeof NEW, accounts: Record<string, string>) => {
      const all = [...past, ...news].map((x) => x.text);
      const kinds = await labeller.label(all.map((t) => bankText({ description: t })));
      const texts = all.map((t, i) => bankText({ description: t, category: kinds[i] }));
      const vectors = await embedder.embed(texts);
      const memory: MemoryItem[] = past.map((p, i) => ({
        vector: vectors[i],
        out: true,
        glAccountId: accounts[p.kind],
        taxCodeId: null,
        decidedAt: recent(10 + i),
        evidence: { label: p.text.split(" ")[0], date: recent(10 + i).slice(0, 10), amountCents: 1000, source: "bank" },
      }));
      let right = 0;
      const report: string[] = [];
      news.forEach((n, j) => {
        const picks = similarPicks({ vector: vectors[past.length + j], out: true }, memory, NOW);
        const ok = picks[0]?.glAccountId === accounts[n.kind];
        if (ok) right++;
        report.push(`${ok ? "OK  " : "MISS"} ${texts[past.length + j].padEnd(48)} first: ${picks[0] ? `${picks[0].glAccountId}/${picks[0].confidence}` : "none"}`);
      });
      return { right, report };
    };
    const csv = await score(PAST, NEW, ACCOUNT);
    console.log(`\nImported files, right account first: ${csv.right} of ${NEW.length}\n${csv.report.join("\n")}`);

    // One town everywhere, and fuel has the most past lines.
    const T = (text: string, kind: "fuel" | "meals" | "software" | "office") => ({ text, category: "", kind });
    const trapPast = [T("PETRO-CANADA 1234 TORONTO ON", "fuel"), T("PETRO-CANADA 1235 TORONTO ON", "fuel"), T("PETRO-CANADA 88 TORONTO ON", "fuel"), T("ESSO 5521 TORONTO ON", "fuel"), T("MCDONALDS #3322 TORONTO ON", "meals"), T("MCDONALDS #3329 TORONTO ON", "meals"), T("STAPLES 112 TORONTO ON", "office"), T("ADOBE *CREATIVE CLOUD 800-833-6687", "software")];
    const trapNew = [T("BURGER KING 22 TORONTO ON", "meals"), T("WENDYS 812 TORONTO ON", "meals"), T("TIM HORTONS 4411 TORONTO ON", "meals"), T("A&W 445 TORONTO ON", "meals"), T("SUBWAY 1192 TORONTO ON", "meals"), T("SHELL 0042 TORONTO ON", "fuel"), T("HUSKY 77 TORONTO ON", "fuel"), T("GRAND & TOY 019 TORONTO ON", "office"), T("BEST BUY 940 TORONTO ON", "office"), T("ZOOM.US 888-799-9666", "software")];
    const trap = await score(trapPast, trapNew, ACCOUNT);
    console.log(`\nSame town, right account first: ${trap.right} of ${trapNew.length}\n${trap.report.join("\n")}`);

    assert.ok(csv.right >= 18, `${csv.right} of 20 on imported files; at least 18 needed`);
    assert.ok(trap.right >= 8, `${trap.right} of 10 on the same-town set; at least 8 needed`);
  });
});
