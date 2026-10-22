// Decisions on bank lines and the CSV import, against a real Postgres.
// Skipped unless BANK_TEST_DATABASE_URL points at a throwaway database.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { decide, importCsv, listTransactions, readPatch } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

describe("bank line decisions", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const seed = async (qb = "qb-1") => {
    await importCsv(db, {
      qbConnectionId: qb,
      userId: "u1",
      accountLabel: "Chase ••4421",
      rows: [
        { date: "2026-09-28", description: "UBER *TRIP HELP.UBER.COM", amount: -34.15 },
        { date: "2026-09-02", description: "ATLASSIAN SYDNEY", amount: -3600 },
        { date: "2026-09-30", description: "TRANSFER TO SAVINGS", amount: -1000 },
      ],
    });
    return listTransactions(db, qb);
  };

  it("imports a CSV once: a second import of the same file adds nothing", async () => {
    await seed();
    const again = await importCsv(db, {
      qbConnectionId: "qb-1",
      userId: "u1",
      accountLabel: "Chase ••4421",
      rows: [{ date: "2026-09-28", description: "uber *trip  help.uber.com", amount: -34.15 }],
    });
    assert.deepEqual(again, { added: 0, duplicates: 1 });
    assert.equal((await listTransactions(db, "qb-1")).length, 3);
  });

  it("keeps two identical lines that really happened twice in one file", async () => {
    const r = await importCsv(db, {
      qbConnectionId: "qb-1",
      userId: "u1",
      accountLabel: "Amex",
      rows: [
        { date: "2026-10-01", description: "STARBUCKS", amount: -4.5 },
        { date: "2026-10-01", description: "STARBUCKS", amount: -4.5 },
      ],
    });
    assert.deepEqual(r, { added: 2, duplicates: 0 });
  });

  it("stores amounts to the cent and lists newest first", async () => {
    const list = await seed();
    assert.deepEqual(
      list.map((t) => [t.date, t.amount]),
      [
        ["2026-09-30", -1000],
        ["2026-09-28", -34.15],
        ["2026-09-02", -3600],
      ],
    );
    assert.equal(list[0].source, "csv");
    assert.equal(list[0].status, "review");
  });

  it("records a decision, bumps the version, and survives a re-read", async () => {
    const [, uber] = await seed();
    const r = await decide(db, { qbConnectionId: "qb-1", id: uber.id, userId: "u1", patch: { glAccountId: "gl-430", payee: "Uber", vendorId: "v-uber" }, expectedVersion: uber.version });
    assert.ok(r.ok);
    const [, fresh] = await listTransactions(db, "qb-1");
    assert.equal(fresh.categoryId, "gl-430");
    assert.equal(fresh.payee, "Uber");
    assert.equal(fresh.version, uber.version + 1);
  });

  it("refuses a stale write from another tab and returns the current line", async () => {
    const [, uber] = await seed();
    await decide(db, { qbConnectionId: "qb-1", id: uber.id, userId: "u1", patch: { payee: "Uber" }, expectedVersion: uber.version });
    const stale = await decide(db, { qbConnectionId: "qb-1", id: uber.id, userId: "u2", patch: { status: "excluded" }, expectedVersion: uber.version });
    assert.equal(!stale.ok && stale.status, 409);
    assert.equal(!stale.ok && stale.current?.payee, "Uber");
  });

  it("needs a bill to match and the other account to mark a transfer, and keeps them exclusive", async () => {
    const [savings, , atlassian] = await seed();
    const noBill = await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "matched" } });
    assert.equal(!noBill.ok && noBill.status, 400);
    const matched = await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-1" } });
    assert.ok(matched.ok && matched.txn.matchedInvoiceId === "inv-1");
    const toTransfer = await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "transfer", transferLabel: "Savings" } });
    assert.ok(toTransfer.ok && toTransfer.txn.matchedInvoiceId === undefined && toTransfer.txn.transferAccount === "Savings");
    const restored = await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "review" } });
    assert.ok(restored.ok && restored.txn.transferAccount === undefined);
    const noLabel = await decide(db, { qbConnectionId: "qb-1", id: savings.id, userId: "u1", patch: { status: "transfer" } });
    assert.equal(!noLabel.ok && noLabel.status, 400);
  });

  it("matches a bill to one bank line only", async () => {
    const [savings, , atlassian] = await seed();
    assert.ok((await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-1" } })).ok);
    const second = await decide(db, { qbConnectionId: "qb-1", id: savings.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-1" } });
    assert.equal(!second.ok && second.status, 409);
  });

  it("keeps companies apart", async () => {
    const [line] = await seed("qb-1");
    const other = await decide(db, { qbConnectionId: "qb-2", id: line.id, userId: "u9", patch: { status: "excluded" } });
    assert.equal(!other.ok && other.status, 404);
    assert.deepEqual(await listTransactions(db, "qb-2"), []);
  });

  it("refuses to change a line that is already in the accounting software", async () => {
    const [line] = await seed();
    await db.txns.updateOne({ _id: line.id }, { $set: { postingStatus: "posted" } });
    const r = await decide(db, { qbConnectionId: "qb-1", id: line.id, userId: "u1", patch: { status: "excluded" } });
    assert.equal(!r.ok && r.status, 409);
  });

  it("writes an audit event with before and after", async () => {
    const [line] = await seed();
    await decide(db, { qbConnectionId: "qb-1", id: line.id, userId: "u1", patch: { status: "excluded" }, action: "bank.excluded" });
    const ev = (await db.events.findOne({ transactionId: line.id })) as unknown as { action: string; detail: { before: { status: string }; after: { status: string } } };
    assert.equal(ev.action, "bank.excluded");
    assert.deepEqual([ev.detail.before.status, ev.detail.after.status], ["review", "excluded"]);
  });

  it("Post (ready) needs a GL account, keeps the coding and clears a bill match", async () => {
    const [, uber, atlassian] = await seed();
    const noGl = await decide(db, { qbConnectionId: "qb-1", id: uber.id, userId: "u1", patch: { status: "ready" } });
    assert.equal(!noGl.ok && noGl.status, 400);
    const posted = await decide(db, { qbConnectionId: "qb-1", id: uber.id, userId: "u1", patch: { status: "ready", glAccountId: "gl-travel", vendorId: "v-uber", payee: "Uber" } });
    assert.ok(posted.ok && posted.txn.status === "ready" && posted.txn.categoryId === "gl-travel");
    await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-9" } });
    const repost = await decide(db, { qbConnectionId: "qb-1", id: atlassian.id, userId: "u1", patch: { status: "ready", glAccountId: "gl-software" } });
    assert.ok(repost.ok && repost.txn.matchedInvoiceId === undefined);
    assert.equal((await listTransactions(db, "qb-1", { status: "ready" })).length, 2);
  });

  it("reads only known fields from a request body", () => {
    assert.equal(readPatch({ status: "posted" }), "Unknown status.");
    const p = readPatch({ status: "excluded", categoryId: " gl-1 ", sealed_access_token: "x", payee: "" });
    assert.ok(typeof p !== "string");
    if (typeof p !== "string") {
      assert.equal(p.glAccountId, "gl-1");
      assert.equal(p.payee, null);
      assert.equal((p as Record<string, unknown>).sealed_access_token, undefined);
    }
  });
});
