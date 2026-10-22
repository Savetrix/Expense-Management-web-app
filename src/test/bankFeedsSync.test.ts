// Connect + sync against a real Postgres with Plaid replaced by a fake.
// Skipped unless BANK_TEST_DATABASE_URL points at a throwaway database.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { AccountBase, Transaction } from "plaid";

import type { BankFeedsConfig } from "../lib/bankFeeds/config";
import { connectItem, findDuplicateItem } from "../lib/bankFeeds/connect";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { PlaidCallError, type PlaidGateway, type SyncPage } from "../lib/bankFeeds/plaid";
import { listAccountViews, markItemRemoved, removeAccount } from "../lib/bankFeeds/store";
import { openAccessToken, syncItem } from "../lib/bankFeeds/sync";
import { __seedWebhookKeyForTests, actionFor, verifyPlaidWebhook } from "../lib/bankFeeds/webhook";

import { BANK_TEST_DB_NAME, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

const URL = process.env.BANK_TEST_MONGODB_URI;

const config: BankFeedsConfig = {
  enabled: true,
  plaidEnv: "sandbox",
  plaidClientId: "client",
  plaidSecret: "secret",
  webhookUrl: null,
  tokenEncryptionKey: Buffer.alloc(32, 7),
  mongoUri: URL ?? "",
  mongoDbName: BANK_TEST_DB_NAME,
  historyDays: 365,
};

const account = (id: string, mask: string, name = "Plaid Checking"): AccountBase =>
  ({ account_id: id, name, mask, type: "depository", subtype: "checking", balances: { current: 1200.5, available: 1100, iso_currency_code: "USD" } }) as unknown as AccountBase;

const txn = (id: string, accountId: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    transaction_id: id,
    account_id: accountId,
    amount,
    date: "2026-10-01",
    name: "UBER 063015 SF**POOL**",
    original_description: "UBER *TRIP HELP.UBER.COM",
    merchant_name: "Uber",
    iso_currency_code: "USD",
    pending: false,
    payment_channel: "online",
    personal_finance_category: { primary: "TRANSPORTATION", detailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", confidence_level: "VERY_HIGH" },
    ...extra,
  }) as unknown as Transaction;

class FakePlaid implements PlaidGateway {
  pages: SyncPage[] = [];
  syncCalls: (string | null)[] = [];
  failNext: PlaidCallError | null = null;
  removed: string[] = [];
  accounts = [account("acc-1", "0000"), account("acc-2", "1111", "Plaid Saving")];
  async createLinkToken() {
    return { linkToken: "link-sandbox-1", expiration: "2026-10-21T00:00:00Z" };
  }
  async exchangePublicToken(publicToken: string) {
    return { accessToken: `access-sandbox-${publicToken}`, itemId: `item-${publicToken}` };
  }
  async getAccounts() {
    return { institutionId: "ins_109508", consentExpiresAt: null, accounts: this.accounts };
  }
  async syncTransactions(_token: string, cursor: string | null) {
    this.syncCalls.push(cursor);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const page = this.pages.shift();
    return page ?? { added: [], modified: [], removed: [], accounts: [], nextCursor: cursor ?? "c0", hasMore: false };
  }
  async removeItem(token: string) {
    this.removed.push(token);
  }
  async itemError() {
    return null;
  }
  async institutionName() {
    return "First Platypus Bank";
  }
  async webhookKey() {
    return null;
  }
  async sandboxPublicToken() {
    return "public-sandbox";
  }
  async sandboxFireWebhook() {}
  async sandboxResetLogin() {}
}

const page = (p: Partial<SyncPage>): SyncPage => ({ added: [], modified: [], removed: [], accounts: [], nextCursor: "c", hasMore: false, ...p });

describe("bank connect and sync", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  let db: Db;
  let plaid: FakePlaid;

  before(async () => {
    await resetBankTestDatabase(URL as string);
    await __closeBankDbForTests();
    db = await openTestDb(URL as string);
  });
  after(async () => {
    await __closeBankDbForTests();
  });
  beforeEach(async () => {
    plaid = new FakePlaid();
    await clearBankTestData(db);
  });

  const connect = (qb = "qb-1", token = "p1") =>
    connectItem(db, plaid, config, { qbConnectionId: qb, userId: "u1", publicToken: token, meta: { institutionId: "ins_109508", institutionName: "First Platypus Bank", accountMasks: ["0000", "1111"] } });

  it("seals the access token and never stores it in the clear", async () => {
    const item = await connect();
    assert.notEqual(item.sealedAccessToken, "access-sandbox-p1");
    assert.doesNotMatch(item.sealedAccessToken, /access-sandbox/);
    assert.equal(openAccessToken(config, item), "access-sandbox-p1");
    // Bound to its item: the same sealed value under another item id does not open.
    assert.equal(openAccessToken(config, { ...item, plaidItemId: "item-other" }), null);
  });

  it("lists the accounts for the company that connected them, and no one else", async () => {
    await connect("qb-1");
    const views = await listAccountViews(db, "qb-1");
    assert.equal(views.length, 2);
    assert.equal(views[0].institutionName, "First Platypus Bank");
    assert.equal(views[0].currentBalance, 1200.5);
    assert.equal(views[0].status, "connected");
    assert.deepEqual(await listAccountViews(db, "qb-2"), []);
  });

  it("refuses to connect the same bank accounts twice", async () => {
    await connect();
    const dup = await findDuplicateItem(db, "qb-1", { institutionId: "ins_109508", institutionName: null, accountMasks: ["0000"] });
    assert.ok(dup);
    const otherCompany = await findDuplicateItem(db, "qb-2", { institutionId: "ins_109508", institutionName: null, accountMasks: ["0000"] });
    assert.equal(otherCompany, null);
  });

  it("pages through a sync, flips the sign, skips pending, and saves the cursor at the end", async () => {
    const item = await connect();
    plaid.pages = [
      page({ added: [txn("t1", "acc-1", 12.4), txn("t2", "acc-1", -2500, { merchant_name: null, original_description: "ACME PAYROLL" })], nextCursor: "c1", hasMore: true }),
      page({ added: [txn("t3", "acc-2", 5, { pending: true })], nextCursor: "c2", hasMore: false }),
    ];
    const out = await syncItem(db, plaid, config, item._id);
    assert.deepEqual(out, { status: "synced", added: 2, modified: 0, removed: 0 });
    const rows = (await db.txns.find({}).sort({ plaidTransactionId: 1 }).toArray()).map((r) => ({
      plaid_transaction_id: r.plaidTransactionId,
      amount_cents: r.amountCents,
      description: r.description,
      merchant_name: r.merchantName,
      account_label: r.accountLabel,
    }));
    assert.deepEqual(
      rows.map((r) => [r.plaid_transaction_id, Number(r.amount_cents)]),
      [
        ["t1", -1240],
        ["t2", 250000],
      ],
    );
    assert.equal(rows[0].description, "UBER *TRIP HELP.UBER.COM");
    assert.equal(rows[0].merchant_name, "Uber");
    assert.equal(rows[0].account_label, "First Platypus Bank Plaid Checking ••0000");
    const saved = await db.items.findOne({ _id: item._id });
    assert.equal(saved?.syncCursor, "c2");
  });

  it("restarts from the starting cursor when Plaid's data changes mid-pagination", async () => {
    const item = await connect();
    plaid.pages = [page({ added: [txn("t1", "acc-1", 10)], nextCursor: "c1", hasMore: true })];
    plaid.failNext = null;
    // First page ok, second call fails with the mutation error, then a clean run.
    const realSync = plaid.syncTransactions.bind(plaid);
    let n = 0;
    plaid.syncTransactions = async (token, cursor) => {
      n += 1;
      if (n === 2) throw new PlaidCallError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "TRANSACTIONS_ERROR", "x", null, 400, "r");
      if (n === 3) return page({ added: [txn("t1", "acc-1", 10), txn("t4", "acc-1", 20)], nextCursor: "c9" });
      return realSync(token, cursor);
    };
    const out = await syncItem(db, plaid, config, item._id);
    assert.equal(out.status, "synced");
    const count = await db.txns.countDocuments({});
    assert.equal(Number(count), 2, "t1 re-applied, not duplicated");
  });

  it("never overwrites the user's decision when Plaid sends a change", async () => {
    const item = await connect();
    plaid.pages = [page({ added: [txn("t1", "acc-1", 12.4)], nextCursor: "c1" })];
    await syncItem(db, plaid, config, item._id);
    await db.txns.updateOne({ plaidTransactionId: "t1" }, { $set: { status: "excluded", payee: "Uber", glAccountId: "gl-430" } });
    plaid.pages = [page({ modified: [txn("t1", "acc-1", 13.1)], nextCursor: "c2" })];
    await syncItem(db, plaid, config, item._id);
    const row = (await db.txns.findOne({ plaidTransactionId: "t1" }))!;
    assert.deepEqual([row.status, row.payee, row.glAccountId, row.amountCents], ["excluded", "Uber", "gl-430", -1310]);
  });

  it("hides a transaction Plaid removes", async () => {
    const item = await connect();
    plaid.pages = [page({ added: [txn("t1", "acc-1", 1)], nextCursor: "c1" })];
    await syncItem(db, plaid, config, item._id);
    plaid.pages = [page({ removed: [{ transaction_id: "t1", account_id: "acc-1" }], nextCursor: "c2" })];
    const out = await syncItem(db, plaid, config, item._id);
    assert.equal(out.status === "synced" && out.removed, 1);
    const row = await db.txns.findOne({ plaidTransactionId: "t1" });
    assert.ok(row?.removedAt);
  });

  it("marks the login as needing re-login when the bank asks for it", async () => {
    const item = await connect();
    plaid.failNext = new PlaidCallError("ITEM_LOGIN_REQUIRED", "ITEM_ERROR", "login required", null, 400, "r");
    const out = await syncItem(db, plaid, config, item._id);
    assert.deepEqual(out, { status: "login_required", code: "ITEM_LOGIN_REQUIRED" });
    const [view] = await listAccountViews(db, "qb-1");
    assert.equal(view.status, "needs_relogin");
    assert.match(view.statusDetail ?? "", /sign in again/i);
    // The next clean sync clears it.
    await syncItem(db, plaid, config, item._id);
    assert.equal((await listAccountViews(db, "qb-1"))[0].status, "connected");
  });

  it("lets only one sync run per login; a second request is folded into the running one", async () => {
    const item = await connect();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    plaid.syncTransactions = async () => {
      calls += 1;
      if (calls === 1) await gate;
      return page({ nextCursor: `c${calls}` });
    };
    const first = syncItem(db, plaid, config, item._id);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await syncItem(db, plaid, config, item._id), { status: "busy" });
    release();
    assert.equal((await first).status, "synced");
    assert.equal(calls, 2, "the folded request ran as a second round");
  });

  it("disconnecting the last account removes the login", async () => {
    const item = await connect();
    const [a, b] = await listAccountViews(db, "qb-1");
    assert.equal(await removeAccount(db, "qb-1", a.id), 1);
    assert.equal(await removeAccount(db, "qb-1", b.id), 0);
    await markItemRemoved(db, item._id);
    const row = (await db.items.findOne({ _id: item._id }))!;
    assert.ok(row.removedAt);
    assert.equal(row.sealedAccessToken, "removed");
    assert.equal(await removeAccount(db, "qb-2", a.id), -1, "another company cannot touch it");
  });
});

describe("plaid webhook verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const fake = { webhookKey: async () => jwk } as unknown as PlaidGateway;

  const signed = (body: string, opts: { iat?: number; alg?: string; hash?: string } = {}) => {
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const header = enc({ alg: opts.alg ?? "ES256", kid: "kid-1", typ: "JWT" });
    const claims = enc({ iat: opts.iat ?? Math.floor(Date.now() / 1000), request_body_sha256: opts.hash ?? createHash("sha256").update(body).digest("hex") });
    const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return `${header}.${claims}.${sig}`;
  };
  const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" }, null, 2);

  beforeEach(() => __seedWebhookKeyForTests("", null));

  it("accepts a genuine webhook", async () => {
    assert.deepEqual(await verifyPlaidWebhook(fake, body, signed(body)), { ok: true });
  });
  it("refuses a missing header, another algorithm, a stale call, a changed body or a forged signature", async () => {
    assert.equal((await verifyPlaidWebhook(fake, body, null)).ok, false);
    assert.equal((await verifyPlaidWebhook(fake, body, signed(body, { alg: "HS256" }))).ok, false);
    assert.equal((await verifyPlaidWebhook(fake, body, signed(body, { iat: Math.floor(Date.now() / 1000) - 600 }))).ok, false);
    assert.equal((await verifyPlaidWebhook(fake, body + " ", signed(body))).ok, false);
    const forged = signed(body).replace(/\.[^.]+$/, ".AAAA");
    assert.equal((await verifyPlaidWebhook(fake, body, forged)).ok, false);
  });
  it("maps webhook codes to actions", () => {
    assert.deepEqual(actionFor({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", historical_update_complete: true }), {
      kind: "sync",
      initialComplete: undefined,
      historicalComplete: true,
    });
    assert.deepEqual(actionFor({ webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "ITEM_LOGIN_REQUIRED" } }), {
      kind: "status",
      status: "login_required",
      code: "ITEM_LOGIN_REQUIRED",
    });
    assert.equal(actionFor({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT" }).kind, "status");
    assert.equal(actionFor({ webhook_type: "TRANSACTIONS", webhook_code: "DEFAULT_UPDATE" }).kind, "ignore");
  });
});
