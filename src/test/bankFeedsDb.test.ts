// Runs against a real Postgres. Skipped unless BANK_TEST_DATABASE_URL points at
// a throwaway database (every run drops the bank tables first).
//
//   BANK_TEST_DATABASE_URL=postgres://scantrix@localhost:54329/scantrix_test \
//     node --import tsx --test --test-concurrency=1 src/test/bankFeeds*.test.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { __closeBankDbForTests, openDb } from "../lib/bankFeeds/db";
import { MIGRATIONS } from "../lib/bankFeeds/schema";

import { resetBankTestDatabase } from "./helpers/bankTestDb";

const URL = process.env.BANK_TEST_DATABASE_URL;


describe("bank feeds database", { skip: URL ? false : "BANK_TEST_DATABASE_URL not set" }, () => {
  before(async () => {
    await resetBankTestDatabase(URL as string);
    await __closeBankDbForTests();
  });
  after(async () => {
    await __closeBankDbForTests();
  });

  it("applies every migration exactly once, even when two instances start together", async () => {
    // Two "instances" (separate schema-ready caches) racing on a cold database.
    const a = openDb(URL as string);
    await Promise.all([a.query("SELECT 1"), a.query("SELECT 1")]);
    await __closeBankDbForTests();
    const b = openDb(URL as string);
    const rows = await b.query<{ version: number }>("SELECT version FROM bank_schema_migrations ORDER BY version");
    assert.deepEqual(
      rows.map((r) => r.version),
      MIGRATIONS.map((m) => m.version),
    );
  });

  it("rolls a failed transaction back", async () => {
    const db = openDb(URL as string);
    await assert.rejects(
      db.tx(async (q) => {
        await q(
          "INSERT INTO bank_items (qb_connection_id, plaid_item_id, plaid_env, sealed_access_token, created_by) VALUES ('qb-1', 'item-rollback', 'sandbox', 'x', 'u1')",
        );
        throw new Error("boom");
      }),
    );
    const rows = await db.query("SELECT 1 FROM bank_items WHERE plaid_item_id = 'item-rollback'");
    assert.equal(rows.length, 0);
  });

  it("refuses a status outside the four the screens know", async () => {
    const db = openDb(URL as string);
    await assert.rejects(
      db.query(
        "INSERT INTO bank_transactions (qb_connection_id, account_label, source, date, amount_cents, status) VALUES ('qb-1', 'x', 'csv', '2026-10-01', -100, 'posted')",
      ),
    );
  });
});
