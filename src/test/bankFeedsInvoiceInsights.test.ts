// Invoice insights: the period read once per invoice version, "Not a
// prepayment" remembered, and the bank line that paid the bill.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { bankInsight, periodInsight, setPrepaymentDismissed, toIsoDate } from "../lib/bankFeeds/invoiceInsights";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const atlassian = (updatedAt = "2026-09-02T10:00:00Z") => ({
  _id: "inv-atl",
  updatedAt,
  extractedData: {
    invoiceDate: "2026-09-01",
    dueDate: "2026-09-01",
    totalAmount: 3600,
    currency: "GBP",
    lineItems: [{ description: "Jira and Confluence Premium (Cloud), annual subscription, up to 15 users" }],
  },
  pipelineLog: { ocrText: "INVOICE IN-003-751-338 ... Service period: 01/09/2026 - 31/08/2027 ... PAID" },
});

describe("toIsoDate", () => {
  it("normalises the dates the backend sends", () => {
    assert.equal(toIsoDate("2026-09-01"), "2026-09-01");
    assert.equal(toIsoDate("2026-09-01T00:00:00.000Z"), "2026-09-01");
    assert.equal(toIsoDate(null), null);
    assert.equal(toIsoDate("not a date"), null);
  });
});

describe("invoice insights", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  it("detects a yearly plan as a prepayment and remembers the reading", async () => {
    const first = await periodInsight(db, "qb-1", atlassian());
    assert.deepEqual([first.period?.start, first.period?.end, first.period?.months, first.prepayment], ["2026-09-01", "2027-08-31", 12, true]);
    // Same invoice version: served from the saved reading, even if the text were gone.
    const again = await periodInsight(db, "qb-1", { ...atlassian(), pipelineLog: { ocrText: "" }, extractedData: { ...atlassian().extractedData, lineItems: [] } });
    assert.equal(again.period?.months, 12);
    // Edited invoice (new updatedAt): read again.
    const edited = await periodInsight(db, "qb-1", { ...atlassian("2026-09-05T00:00:00Z"), pipelineLog: { ocrText: "Printer paper" }, extractedData: { ...atlassian().extractedData, lineItems: [] } });
    assert.equal(edited.period, null);
  });

  it("remembers 'Not a prepayment', per company", async () => {
    await periodInsight(db, "qb-1", atlassian());
    await setPrepaymentDismissed(db, "qb-1", "inv-atl", "u1", true);
    assert.equal((await periodInsight(db, "qb-1", atlassian())).dismissed, true);
    assert.equal((await periodInsight(db, "qb-2", atlassian())).dismissed, false);
    await setPrepaymentDismissed(db, "qb-1", "inv-atl", "u1", false);
    assert.equal((await periodInsight(db, "qb-1", atlassian())).dismissed, false);
  });

  it("finds the bank line that paid the bill, then shows it as matched", async () => {
    await importCsv(db, {
      qbConnectionId: "qb-1",
      userId: "u1",
      accountLabel: "Lloyds",
      rows: [
        { date: "2026-09-03", description: "ATLASSIAN SYDNEY", amount: -3600 },
        { date: "2026-12-01", description: "ATLASSIAN SYDNEY", amount: -3600 },
        { date: "2026-09-03", description: "REFUND", amount: 3600 },
        { date: "2026-09-04", description: "OTHER", amount: -3599.99 },
      ],
    });
    const found = await bankInsight(db, "qb-1", atlassian());
    assert.deepEqual(
      found.candidates.map((c) => [c.date, c.amount]),
      [["2026-09-03", -3600]],
      "only money out, exact amount, inside the window",
    );
    await decide(db, { qbConnectionId: "qb-1", id: found.candidates[0].id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-atl" } });
    const after = await bankInsight(db, "qb-1", atlassian());
    assert.equal(after.matched.length, 1);
    assert.equal(after.candidates.length, 0);
    assert.deepEqual(await bankInsight(db, "qb-2", atlassian()), { matched: [], candidates: [] });
    assert.equal((await listTransactions(db, "qb-1", { invoiceId: "inv-atl" })).length, 1);
  });
});
