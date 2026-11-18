// Smart Suggestions after the 18 Nov call with Saurabh:
//   - a bank line is never coded to a Bank-type account (Cash included), by
//     any step: that side of the entry is the line's own bank account;
//   - only POSTED lines teach: a choice nobody posted changes nothing.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { bankSideIds, kindOfType } from "../lib/bankFeeds/companyLists";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import { refreshSuggestions, type Suggestion } from "../lib/bankFeeds/suggest";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";
import { decideAndPost, markPosted, saveChart, saveVendorTax } from "./helpers/posted";

describe("account types", () => {
  it("reads the backend's account types, Bank and Credit Card included", () => {
    assert.equal(kindOfType("Bank"), "bank");
    assert.equal(kindOfType("BANK"), "bank");
    assert.equal(kindOfType("Credit Card"), "card");
    assert.equal(kindOfType("Accounts Payable"), "payable");
    assert.equal(kindOfType("Expense"), "expense");
    assert.equal(kindOfType("Other Current Asset"), "other");
  });
});

describe("posted lines only, never Cash or Bank", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const QB = "qb-posted";
  const today = new Date().toISOString().slice(0, 10);
  const lines = async (n: number) => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "RBC", rows: Array.from({ length: n }, (_, i) => ({ date: today, description: `TIM HORTONS 0412 ${i}`, amount: -(5 + i) })) });
    await saveVendorTax(db, QB, { "v-tims": "gst" });
    await saveChart(db, QB, [
      { id: "gl-cash", name: "Cash", kind: "bank", type: "Bank" },
      { id: "gl-chequing", name: "RBC Chequing", kind: "bank", type: "Bank" },
      { id: "gl-meals", name: "Meals", kind: "expense", type: "Expense" },
    ]);
    return listTransactions(db, QB);
  };
  const read = async (id: string) => (await listTransactions(db, QB)).find((l) => l.id === id)?.suggestion as Suggestion | undefined;

  it("skips Cash: lines posted to Cash don't vote, and the next best account wins", async () => {
    const all = await lines(6);
    for (const l of all.slice(0, 3)) await decideAndPost(db, { qbConnectionId: QB, id: l.id, userId: "u1", patch: { vendorId: "v-tims", glAccountId: "gl-cash" } });
    await decideAndPost(db, { qbConnectionId: QB, id: all[3].id, userId: "u1", patch: { vendorId: "v-tims", glAccountId: "gl-meals" } });
    await refreshSuggestions(db, QB);
    const s = await read(all[5].id);
    assert.equal(s?.glAccountId, "gl-meals", "Meals, not Cash");
    assert.ok(!(s?.picks ?? []).some((p) => p.glAccountId === "gl-cash"), "Cash isn't even among the picks");
    assert.equal(s?.autoCoded, false, "one posted line only suggests");
  });

  it("shows nothing when every past line went to a Bank account", async () => {
    const all = await lines(4);
    for (const l of all.slice(0, 3)) await decideAndPost(db, { qbConnectionId: QB, id: l.id, userId: "u1", patch: { vendorId: "v-tims", glAccountId: "gl-cash" } });
    await refreshSuggestions(db, QB);
    const s = await read(all[3].id);
    assert.ok(!s?.glAccountId, "no account suggested");
    assert.deepEqual(s?.picks ?? [], []);
  });

  it("leaves out the account a bank line is mapped to, even before the chart is known", async () => {
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "RBC", ledger: { id: "gl-chequing-2", name: "RBC Chequing" }, userId: "u1" });
    assert.ok((await bankSideIds(db, QB)).has("gl-chequing-2"));
  });

  it("an unposted choice never changes a suggestion; once the same line is posted, it does", async () => {
    const all = await lines(3);
    await refreshSuggestions(db, QB);
    assert.ok(!(await read(all[2].id))?.glAccountId, "nothing to learn from yet");
    assert.ok((await decide(db, { qbConnectionId: QB, id: all[0].id, userId: "u1", patch: { vendorId: "v-tims", glAccountId: "gl-meals" } })).ok);
    await refreshSuggestions(db, QB);
    assert.ok(!(await read(all[2].id))?.glAccountId, "a choice nobody posted teaches nothing");
    await markPosted(db, QB, [all[0].id]);
    await refreshSuggestions(db, QB);
    assert.equal((await read(all[2].id))?.glAccountId, "gl-meals", "posted: now it counts");
  });

  it("a line ScanTrix filled in by itself never teaches, even after it would have", async () => {
    const all = await lines(6);
    for (const l of all.slice(0, 3)) await decideAndPost(db, { qbConnectionId: QB, id: l.id, userId: "u1", patch: { vendorId: "v-tims", glAccountId: "gl-meals" } });
    const out = await refreshSuggestions(db, QB);
    assert.equal(out.autoCoded, 3, "the other 3 are filled in");
    const s = await read(all[5].id);
    assert.equal(s?.basis.lines, 3, "only the 3 posted lines vote, not ScanTrix's own fills");
  });
});
