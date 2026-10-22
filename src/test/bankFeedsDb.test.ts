// The database rules the code relies on, enforced by MongoDB indexes. Runs
// against a real MongoDB; skipped unless BANK_TEST_MONGODB_URI is set.
//
//   BANK_TEST_MONGODB_URI=mongodb://127.0.0.1:27027/?replicaSet=testset \
//     node --import tsx --test --test-concurrency=1 src/test/bankFeeds*.test.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { __closeBankDbForTests } from "../lib/bankFeeds/db";
import { importCsv } from "../lib/bankFeeds/transactions";

import { BANK_TEST_DATABASE_URL as URL, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

describe("bank feeds database", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  before(async () => {
    await resetBankTestDatabase(URL as string);
    await __closeBankDbForTests();
  });
  after(async () => {
    await __closeBankDbForTests();
  });

  it("creates its indexes once, even when two requests start together", async () => {
    const [a, b] = await Promise.all([openTestDb(URL as string), openTestDb(URL as string)]);
    const names = (await a.txns.indexes()).map((i) => i.name);
    assert.ok(names.some((n) => n?.startsWith("plaidTransactionId")));
    assert.ok(names.some((n) => n?.includes("csvDedupeKey")));
    assert.equal(a.database.databaseName, b.database.databaseName);
  });

  it("keeps one row per Plaid transaction", async () => {
    const db = await openTestDb(URL as string);
    const doc = { qbConnectionId: "qb-1", plaidTransactionId: "t-unique", date: "2026-10-01", amountCents: -100 };
    await db.txns.insertOne({ ...doc, _id: "a" } as never);
    await assert.rejects(db.txns.insertOne({ ...doc, _id: "b" } as never), /duplicate key/);
  });

  it("lets CSV lines (which have no Plaid id) coexist, but never twice with the same key", async () => {
    const db = await openTestDb(URL as string);
    const rows = [{ date: "2026-10-01", description: "A", amount: -1 }];
    const first = await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "x", rows });
    const second = await importCsv(db, { qbConnectionId: "qb-1", userId: "u1", accountLabel: "x", rows });
    const otherCompany = await importCsv(db, { qbConnectionId: "qb-2", userId: "u1", accountLabel: "x", rows });
    assert.deepEqual([first.added, second.added, otherCompany.added], [1, 0, 1]);
  });
});
