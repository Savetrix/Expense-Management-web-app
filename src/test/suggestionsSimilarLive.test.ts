// Smart Suggestions, step 3, against the real OpenAI embedder: Feature 5's
// test set. Made-up items only, no client data. Skipped unless
// RUN_OPENAI_EVAL=1 (and OPENAI_API_KEY is set), so the normal test run never
// calls OpenAI.
//
//   RUN_OPENAI_EVAL=1 node --env-file=.env.local --import tsx --test src/test/suggestionsSimilarLive.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openAiEmbedder } from "../lib/bankFeeds/embeddings";
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
});
