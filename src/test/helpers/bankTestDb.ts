// Bank-feeds tests run against a real, throwaway MongoDB named by
// BANK_TEST_MONGODB_URI (they are skipped without it), in a database of their
// own that each file drops first. Run them one file at a time
// (--test-concurrency=1): they share that database.
import { MongoClient } from "mongodb";

import { readyDb, type Db } from "../../lib/bankFeeds/db";

export const BANK_TEST_DATABASE_URL = process.env.BANK_TEST_MONGODB_URI;
export const BANK_TEST_DB_NAME = "bank-transactions-test";

export async function resetBankTestDatabase(uri: string): Promise<void> {
  const client = new MongoClient(uri);
  try {
    await client.db(BANK_TEST_DB_NAME).dropDatabase();
  } finally {
    await client.close();
  }
}

export function openTestDb(uri: string): Promise<Db> {
  return readyDb(uri, BANK_TEST_DB_NAME);
}

export async function clearBankTestData(db: Db): Promise<void> {
  await Promise.all([db.items, db.accounts, db.txns, db.events, db.webhooks, db.insights, db.ledgerMappings].map((c) => c.deleteMany({})));
}
