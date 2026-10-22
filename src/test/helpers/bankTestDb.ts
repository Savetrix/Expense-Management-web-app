// Bank-feeds tests run against a real, throwaway Postgres named by
// BANK_TEST_DATABASE_URL (they are skipped without it). Run them one file at a
// time (--test-concurrency=1): they share that database.
import { Pool } from "pg";

export const BANK_TEST_DATABASE_URL = process.env.BANK_TEST_DATABASE_URL;

export async function resetBankTestDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  await pool.query(
    "DROP TABLE IF EXISTS bank_webhook_log, bank_events, bank_transactions, bank_accounts, bank_items, bank_schema_migrations CASCADE",
  );
  await pool.end();
}
