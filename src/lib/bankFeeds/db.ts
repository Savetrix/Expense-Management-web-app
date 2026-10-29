// SERVER-ONLY. The bank-feeds database: MongoDB (a cluster of its own on Atlas,
// separate from the Savetrix backend's database), reached with the official
// driver.
//
// WHY NOT VERCEL BLOB. Email forwarding and chat history keep their records in
// Blob, but the project is on Vercel Hobby, where Blob allows 2,000 writes a
// month and locks the whole store for 30 days once that is exceeded
// (vercel.com/docs/vercel-blob/usage-and-pricing). A single synced bank writes
// hundreds of rows on its first pull, and every review click is a write.
//
// The client is cached on globalThis so dev hot reloads and warm serverless
// instances reuse one connection pool. Indexes are created once per instance
// (createIndex is idempotent); they carry the rules the code relies on — one
// row per Plaid transaction, a CSV line imported once — so they are created
// before the first read or write.
import { MongoClient, MongoError, type Collection, type Db as MongoDatabase } from "mongodb";

import type { AccountDoc, EventDoc, InsightDoc, ItemDoc, LedgerMappingDoc, TxnDoc, WebhookLogDoc } from "./schema";
import { ensureIndexes } from "./schema";

export interface Db {
  database: MongoDatabase;
  items: Collection<ItemDoc>;
  accounts: Collection<AccountDoc>;
  txns: Collection<TxnDoc>;
  events: Collection<EventDoc>;
  webhooks: Collection<WebhookLogDoc>;
  insights: Collection<InsightDoc>;
  ledgerMappings: Collection<LedgerMappingDoc>;
}

/** Thrown when the database can't be reached; routes map it to 503. */
export class BankStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BankStoreError";
  }
}

/** Any driver error (network, server selection, server) counts as "store unavailable". */
export function isStoreError(error: unknown): boolean {
  return error instanceof BankStoreError || error instanceof MongoError;
}

interface DbGlobal {
  __bankMongoClients?: Map<string, MongoClient>;
  __bankMongoReady?: Map<string, Promise<void>>;
}
const g = globalThis as DbGlobal;

function clientFor(uri: string): MongoClient {
  g.__bankMongoClients ??= new Map();
  let client = g.__bankMongoClients.get(uri);
  if (!client) {
    client = new MongoClient(uri, {
      // Serverless instances are many and short-lived; a small pool per
      // instance keeps the cluster's connection limit safe.
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10_000,
      appName: "scantrix-web-bank-feeds",
    });
    g.__bankMongoClients.set(uri, client);
  }
  return client;
}

export function openDb(uri: string, dbName: string): Db {
  const database = clientFor(uri).db(dbName);
  return {
    database,
    items: database.collection<ItemDoc>("bank_items"),
    accounts: database.collection<AccountDoc>("bank_accounts"),
    txns: database.collection<TxnDoc>("bank_transactions"),
    events: database.collection<EventDoc>("bank_events"),
    webhooks: database.collection<WebhookLogDoc>("bank_webhook_log"),
    insights: database.collection<InsightDoc>("invoice_insights"),
    ledgerMappings: database.collection<LedgerMappingDoc>("bank_ledger_mappings"),
  };
}

/** Opens the database and makes sure its indexes exist (once per instance). */
export async function readyDb(uri: string, dbName: string): Promise<Db> {
  const db = openDb(uri, dbName);
  g.__bankMongoReady ??= new Map();
  const key = `${uri}#${dbName}`;
  let ready = g.__bankMongoReady.get(key);
  if (!ready) {
    ready = ensureIndexes(db);
    // A failed attempt must not be cached, or one network blip would leave the
    // instance unable to use the database until it is recycled.
    ready.catch(() => g.__bankMongoReady?.delete(key));
    g.__bankMongoReady.set(key, ready);
  }
  try {
    await ready;
  } catch (error) {
    throw new BankStoreError("database unavailable", error);
  }
  return db;
}

/** Tests only: close every client so the process can exit. */
export async function __closeBankDbForTests(): Promise<void> {
  const clients = g.__bankMongoClients;
  g.__bankMongoClients = new Map();
  g.__bankMongoReady = new Map();
  if (clients) await Promise.all([...clients.values()].map((c) => c.close().catch(() => {})));
}
