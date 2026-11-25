// The 24 Nov call with Saurabh: receipt warning, AI pre-fill, Match made more
// automatic, suggested transfers, lines arriving without "Sync now", and the
// per-company switches. Pure parts always run; database parts need the local
// test replica set (BANK_TEST_MONGODB_URI), like the other bank tests.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AccountBase, Transaction } from "plaid";

import { billReadiness } from "../components/v2/bankTransactions/billPay";
import { aiFillReport, isSureLine, prefillFor, shownCoding, surePatch, type PrefillContext } from "../components/v2/bankTransactions/lineCoding";
import { findStrongSuggestions, vendorAgrees, withLedgerBills } from "../components/v2/bankTransactions/matching";
import { confirmThenPost, postDialog, withoutReceipt } from "../components/v2/bankTransactions/postWarning";
import { findTransferPairs, pairPatches } from "../components/v2/bankTransactions/transferPairs";
import type { BankTransaction, InvoiceCandidate } from "../components/v2/bankTransactions/types";
import { runAiPicks, type AiPicker } from "../lib/bankFeeds/aiPick";
import type { BankFeedsConfig } from "../lib/bankFeeds/config";
import { connectItem } from "../lib/bankFeeds/connect";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import { buildQbOpenBillsQuery, openBillsFromQbAnswer } from "../lib/bankFeeds/ledger/quickbooks";
import { ledgerBillRef, parseLedgerBillRef, type LedgerAccount, type LedgerAdapter, type LedgerContext, type Posting } from "../lib/bankFeeds/ledger/types";
import { buildXeroOpenBillsRequest, openBillsFromXeroAnswer } from "../lib/bankFeeds/ledger/xero";
import type { PlaidGateway, SyncPage } from "../lib/bankFeeds/plaid";
import { postLines, type PostingServices } from "../lib/bankFeeds/posting";
import { readFeatures, setFeatures } from "../lib/bankFeeds/settings";
import { syncDueItems, SYNC_DUE_MS } from "../lib/bankFeeds/sync";
import { decide, getTransaction, importCsv, listTransactions, readAiFill, readPatch, refuseTransferPair } from "../lib/bankFeeds/transactions";
import { agreedTaxCode, prefillTaxCode } from "../lib/suggestions/prefill";
import type { InvoiceRecord } from "../store/invoice/invoiceSlice";

import { BANK_TEST_DB_NAME, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

// ------------------------------------------------------------------ helpers

const line = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  id: over.id ?? "t1",
  date: "2026-11-20",
  description: "INDEED JOB POSTING 8812",
  accountName: "SCANTRIX TEST Chequing",
  amount: -150,
  status: "review",
  source: "csv",
  ...over,
});
const suggestion = (over: Record<string, unknown> = {}) => ({
  kind: "expense",
  glAccountId: "adv",
  confidence: "low",
  reason: "AI pick: looks like job posting advertising",
  checks: { legibility: { ok: true, detail: "" }, completeness: { ok: false, detail: "" }, history: { ok: false, detail: "" } },
  autoCoded: false,
  basis: { agreeing: 0, total: 0, lines: 0 },
  step: "ai",
  payee: "Indeed",
  picks: [{ glAccountId: "adv", confidence: "low", step: "ai", subject: "Indeed", lines: 0, weight: 0, evidence: [] }],
  ...over,
});
const ctx = (over: Partial<PrefillContext> = {}): PrefillContext => ({
  mode: "fill",
  enabled: true,
  vendorTax: (id) => ({ "v-indeed": "hst", "v-notax": null })[id] ?? undefined,
  vendorIdByName: (name) => (name.toLowerCase() === "petro canada" ? "v-petro" : undefined),
  ...over,
});

// ------------------------------------------------------------------ Part 1

describe("Part 1: warning before posting without a receipt", () => {
  const item = (amount: number, over: Partial<BankTransaction> = {}, status: BankTransaction["status"] = "ready") => ({ txn: line({ amount, ...over }), patch: { status } });
  const opts = { providerName: "QuickBooks", sendsNow: true, warnReceipts: true };

  it("one line with nothing attached asks 'Post it anyway?'", () => {
    const d = postDialog([item(-50)], opts);
    assert.equal(d?.message, "No receipt or invoice is attached to this line. Post it anyway?");
    assert.equal(d?.confirmLabel, "Post anyway");
    assert.equal(d?.cancelLabel, "Go back");
  });

  it("no popup with a receipt, for money in, for a match or a transfer, or when switched off", () => {
    assert.equal(postDialog([item(-50, { attachments: [{ id: "a", name: "r.pdf", mimeType: "application/pdf", size: 1, uploadedAt: "" }] })], opts), null);
    assert.equal(postDialog([item(80)], opts), null);
    assert.equal(withoutReceipt([item(-50, {}, "matched"), item(-50, {}, "transfer"), item(-50, { matchedInvoiceId: "inv1" })]), 0);
    assert.equal(postDialog([item(-50)], { ...opts, warnReceipts: false }), null);
  });

  it("several lines: one popup with the count of lines without a receipt", () => {
    const d = postDialog([item(-50), item(-20), item(-5, { attachments: [{ id: "a", name: "r", mimeType: "image/png", size: 1, uploadedAt: "" }] })], opts);
    assert.match(d?.message ?? "", /2 of them have no receipt or invoice attached\./);
    assert.equal(d?.confirmLabel, "Post anyway");
  });

  it("'Post anyway' posts exactly once; 'Go back' posts nothing", async () => {
    let posted = 0;
    let asked = 0;
    const post = () => {
      posted += 1;
    };
    assert.equal(await confirmThenPost([item(-50)], opts, async () => (asked++, true), post), true);
    assert.equal(posted, 1);
    assert.equal(await confirmThenPost([item(-50)], opts, async () => (asked++, false), post), false);
    assert.equal(posted, 1, "Go back posted nothing");
    assert.equal(asked, 2, "one popup per click");
  });
});

// ------------------------------------------------------------------ Part 2

describe("Part 2: AI pick filled in", () => {
  it("tax: the vendor's code, else what 3+ similar posted items agree on (90%), else blank", () => {
    assert.deepEqual(prefillTaxCode({ vendorTaxCodeId: "hst", similarTaxCodes: ["gst", "gst", "gst"] }), { taxCodeId: "hst", source: "vendor" });
    assert.deepEqual(prefillTaxCode({ similarTaxCodes: ["gst", "gst", "gst"] }), { taxCodeId: "gst", source: "similar" });
    assert.equal(prefillTaxCode({ similarTaxCodes: ["gst", "gst"] }), null, "fewer than 3");
    assert.equal(agreedTaxCode(["gst", "gst", "gst", "hst"]), null, "75% isn't enough");
    assert.equal(agreedTaxCode(["gst", "gst", "gst", null]), null, "an item without a code disagrees");
    assert.equal(agreedTaxCode(Array(9).fill("gst").concat(["hst"])), "gst", "90%");
    assert.equal(prefillTaxCode({}), null);
  });

  it("a step 4 line gets GL, '+ Add' for a new vendor and no tax (the AI never picks tax)", () => {
    const p = prefillFor(line({ suggestion: suggestion() }), ctx());
    assert.equal(p?.glAccountId, "adv");
    assert.equal(p?.newVendorName, "Indeed");
    assert.equal(p?.vendorId, undefined);
    assert.equal(p?.taxCodeId, undefined);
    const shown = shownCoding(line({ suggestion: suggestion() }), p);
    assert.deepEqual([...shown.ai], ["glAccountId"]);
  });

  it("a step 3 line takes the tax its similar posted items agree on; an existing vendor's own code wins", () => {
    const s3 = suggestion({ step: "similar", glAccountId: "fuel", payee: "Petro Canada", picks: [{ glAccountId: "fuel", confidence: "medium", step: "similar", subject: "similar items", lines: 3, weight: 3, evidence: [], taxVotes: ["gst", "gst", "gst"] }] });
    const p = prefillFor(line({ suggestion: s3 }), ctx());
    assert.equal(p?.vendorId, "v-petro");
    assert.equal(p?.taxCodeId, "gst");
    assert.equal(p?.taxSource, "similar");
    const withVendorTax = prefillFor(line({ suggestion: { ...s3, vendorId: "v-indeed" } }), ctx());
    assert.equal(withVendorTax?.taxCodeId, "hst");
  });

  it("a changed box loses its AI sign; the others keep theirs", () => {
    const s3 = suggestion({ step: "similar", vendorId: "v-indeed" });
    const p = prefillFor(line({ suggestion: s3 }), ctx());
    const shown = shownCoding(line({ suggestion: s3, categoryId: "office" }), p);
    assert.equal(shown.glAccountId, "office");
    assert.equal(shown.ai.has("glAccountId"), false);
    assert.equal(shown.ai.has("vendorId"), true);
    assert.deepEqual(aiFillReport(p, shown), { gl: "changed", vendor: "kept", tax: "kept" });
  });

  it("modes: Off fills nothing; Suggest only fills a High line in place (no sure group); Fill in when sure keeps it in the sure group", () => {
    const high = line({ suggestion: suggestion({ step: "history", confidence: "high", vendorId: "v-indeed", taxCodeId: "hst" }) });
    assert.equal(prefillFor(high, ctx({ mode: "off" })), null);
    assert.equal(isSureLine(high, "suggest"), false);
    assert.equal(surePatch(high, "suggest"), null, "Post all never includes it");
    assert.equal(prefillFor(high, ctx({ mode: "suggest" }))?.glAccountId, "adv");
    assert.equal(isSureLine(high, "fill"), true);
    assert.equal(prefillFor(high, ctx({ mode: "fill" })), null, "the sure group shows it instead");
    const medium = line({ suggestion: suggestion({ step: "history", confidence: "medium" }) });
    assert.equal(prefillFor(medium, ctx({ mode: "fill" }))?.step, "history", "every other suggestion is filled in place");
  });

  it("an AI-filled line is never a sure line, so 'Post all' skips it; switched off fills nothing", () => {
    const ai = line({ suggestion: suggestion() });
    assert.equal(isSureLine(ai, "fill"), false);
    assert.equal(surePatch(ai, "fill"), null);
    assert.equal(prefillFor(ai, ctx({ enabled: false })), null);
  });

  it("the audit field only takes known boxes and outcomes", () => {
    assert.deepEqual(readAiFill({ aiFill: { gl: "kept", vendor: "added", tax: "bogus", other: "kept" } }), { gl: "kept", vendor: "added" });
    assert.equal(readAiFill({}), null);
  });
});

// ------------------------------------------------------------------ Part 3

describe("Part 3: Match", () => {
  const bill = (over: Partial<InvoiceCandidate> = {}): InvoiceCandidate => ({ id: "inv-1", vendor: "Petro-Canada", number: "0000499102", date: "2026-11-10", total: 50, billId: "499", ...over });
  const pay = (over: Partial<BankTransaction> = {}) => line({ id: "p1", description: "PETRO-CANADA 0123 TORONTO ON", amount: -50, date: "2026-11-10", suggestion: undefined, ...over });

  it("vendor names that don't match exactly still agree", () => {
    assert.equal(vendorAgrees(pay(), bill({ vendor: "Petro Canada" })), true);
    assert.equal(vendorAgrees(pay({ description: "PETROCAN 0123" }), bill({ vendor: "Petro-Canada" })), true);
    assert.equal(vendorAgrees(pay({ description: "POS 4521", suggestion: { payee: "Petro Canada" } }), bill({ vendor: "Petro-Canada" })), true, "the payee steps 2/3 found");
    assert.equal(vendorAgrees(pay({ description: "SHELL 0441" }), bill()), false);
  });

  it("exactly one bill fits: suggested; two fit: none suggested (the person picks); a different amount: never", () => {
    assert.equal(findStrongSuggestions([pay()], [bill()]).length, 1);
    assert.equal(findStrongSuggestions([pay()], [bill(), bill({ id: "inv-2", number: "0000499103" })]).length, 0);
    assert.equal(findStrongSuggestions([pay({ amount: -45 })], [bill()]).length, 0);
  });

  it("an open bill that exists only in QuickBooks is found and matched by its ids", () => {
    const candidates = withLedgerBills([], [{ billId: "88", vendorId: "56", vendorName: "Petro Canada", number: "PC-1", date: "2026-11-09", balance: 50 }]);
    const [s] = findStrongSuggestions([pay()], candidates);
    assert.equal(s?.invoice.id, "ledger:88:56");
    assert.deepEqual(parseLedgerBillRef(s.invoice.id), { billId: "88", vendorId: "56" });
    assert.equal(ledgerBillRef({ billId: "88", vendorId: "56" }), "ledger:88:56");
    assert.equal(withLedgerBills([bill({ billId: "88" })], [{ billId: "88", vendorId: "56", vendorName: "x", number: "", date: "", balance: 1 }]).length, 1, "a ScanTrix bill isn't listed twice");
  });

  it("reads open bills from QuickBooks and Xero answers", () => {
    assert.match(buildQbOpenBillsQuery("2025-11-24").query?.query ?? "", /from Bill where TxnDate >= '2025-11-24'/);
    const qb = openBillsFromQbAnswer({ QueryResponse: { Bill: [{ Id: "88", VendorRef: { value: "56", name: "Petro Canada" }, DocNumber: "PC-1", TxnDate: "2026-11-09", Balance: 50, CurrencyRef: { value: "CAD" } }, { Id: "89", VendorRef: { value: "56" }, Balance: 0 }] } });
    assert.deepEqual(qb.map((b) => b.billId), ["88"]);
    assert.match(String(buildXeroOpenBillsRequest().query?.where), /ACCPAY/);
    const xe = openBillsFromXeroAnswer({ Invoices: [{ InvoiceID: "x1", Type: "ACCPAY", Status: "AUTHORISED", Contact: { ContactID: "c1", Name: "Bayside" }, AmountDue: 12.5, DateString: "2026-11-01T00:00:00" }, { InvoiceID: "x2", Type: "ACCPAY", Status: "PAID", Contact: { ContactID: "c1" }, AmountDue: 0 }] });
    assert.deepEqual(xe.map((b) => [b.billId, b.date]), [["x1", "2026-11-01"]]);
  });

  it("'Bill not in QuickBooks yet': posted from here only when the bill is ready", () => {
    const inv = (over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
      _id: "inv-9",
      vendor: { vendorDbId: "v1", resolutionStatus: "exact" },
      extractedData: { vendorName: "Pioneer", currency: "CAD", invoiceNumber: "P-71", totalAmount: 71.2, amountBeforeTax: 63, taxAmount: 8.2, glAccountId: "fuel", lineItems: [] } as InvoiceRecord["extractedData"],
      ...over,
    });
    const ok = billReadiness(inv());
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.payload.vendorId, "v1");
    assert.deepEqual(billReadiness(inv({ vendor: { vendorDbId: "v1", resolutionStatus: "suggested" } })), { ok: false, reason: "Its vendor isn't confirmed yet." });
    assert.equal(billReadiness(inv({ quickbooks: { billId: "5" } as InvoiceRecord["quickbooks"] })).ok, false, "never posted twice");
    assert.equal(billReadiness(inv({ extractedData: { ...inv().extractedData, glAccountId: null } as InvoiceRecord["extractedData"] })).ok, false);
    // A person created or picked the vendor on the invoice screen and saved: the record still says "suggested".
    const saved = inv({ vendor: { vendorDbId: "v-old", resolutionStatus: "suggested" } });
    const byName = (name: string) => (name.toLowerCase().replace(/[^a-z0-9]/g, "") === "pioneer" ? "v-pioneer" : undefined);
    const r = billReadiness(saved, { vendorIdByName: byName });
    assert.equal(r.ok && r.payload.vendorId, "v-pioneer");
    assert.equal(billReadiness(saved, { vendorIdByName: () => undefined }).ok, false, "no company vendor of that name: still waiting");
  });
});

// ------------------------------------------------------------------ Part 4

describe("Part 4: suggested transfers", () => {
  const ledgerIdOf = (t: BankTransaction) => ({ "SCANTRIX TEST Chequing": "38", "SCANTRIX TEST Visa": "79", "Wise USD": "90" })[t.accountName] ?? null;
  const currencyOf = (t: BankTransaction) => (t.accountName === "Wise USD" ? "USD" : "CAD");
  const pc = { ledgerIdOf, currencyOf };
  const out = (over: Partial<BankTransaction> = {}) => line({ id: "o1", description: "ONLINE PAYMENT - VISA", amount: -500, date: "2026-11-21", ...over });
  const inn = (over: Partial<BankTransaction> = {}) => line({ id: "i1", description: "PAYMENT RECEIVED - THANK YOU", accountName: "SCANTRIX TEST Visa", amount: 500, date: "2026-11-23", ...over });

  it("a clean pair is suggested", () => {
    const [p] = findTransferPairs([out(), inn()], pc);
    assert.equal(p.out.id, "o1");
    assert.equal(p.in.id, "i1");
    assert.deepEqual(pairPatches(p).map((x) => [x.id, x.patch.transferAccount]), [["o1", "SCANTRIX TEST Visa"], ["i1", "SCANTRIX TEST Chequing"]]);
  });

  it("4 days apart, two possible partners, another currency, an unmapped account or a refused pair: nothing", () => {
    assert.equal(findTransferPairs([out(), inn({ date: "2026-11-25" })], pc).length, 0);
    assert.equal(findTransferPairs([out(), inn(), inn({ id: "i2", date: "2026-11-22" })], pc).length, 0);
    assert.equal(findTransferPairs([out(), inn({ accountName: "Wise USD" })], pc).length, 0);
    assert.equal(findTransferPairs([out(), inn({ accountName: "Unmapped" })], pc).length, 0);
    assert.equal(findTransferPairs([out({ notTransferWith: ["i1"] }), inn()], pc).length, 0);
    assert.equal(findTransferPairs([out({ amount: -500.01 }), inn()], pc).length, 0, "to the cent");
  });
});

// ------------------------------------------------------------------ database

const URL = process.env.BANK_TEST_MONGODB_URI;

describe("24 Nov, on the database", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  let db: Db;
  before(async () => {
    await resetBankTestDatabase(URL!);
    db = await openTestDb(URL!);
  });
  after(async () => {
    await __closeBankDbForTests();
  });
  beforeEach(async () => {
    await clearBankTestData(db);
  });

  const QB = "qb-24nov";
  const OTHER = "qb-other-company";
  const CHART = [
    { id: "38", name: "Chequing", kind: "bank" as const, type: "Bank", currency: "CAD" },
    { id: "79", name: "Visa Credit Card", kind: "card" as const, type: "Credit Card", currency: "CAD" },
    { id: "7", name: "Meals", kind: "expense" as const, type: "Expense", currency: null },
  ];
  const lctx: LedgerContext = { provider: "quickbooks", tenantId: "R1", accessToken: "at", environment: "sandbox", shortCode: null };
  function services() {
    const calls: Posting[] = [];
    const adapter: LedgerAdapter = {
      listAccounts: async () => CHART as LedgerAccount[],
      paidBills: async () => [],
      entriesBetween: async () => [],
      post: async (_c, posting) => {
        calls.push(posting);
        return { externalId: `ext-${calls.length}`, url: null };
      },
    };
    const svc: PostingServices = {
      ledger: { ...lctx },
      adapter,
      vendorIds: async () => new Map([["v1", "56"]]),
      taxRates: async () => new Map(),
      bill: async (id) => parseLedgerBillRef(id) ?? { billId: "145", vendorId: "56" },
      taxRequired: async () => false,
    };
    return { svc, calls };
  }
  const seedTwoAccounts = async () => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "SCANTRIX TEST Chequing", rows: [{ date: "2026-11-21", description: "ONLINE PAYMENT - VISA", amount: -500 }], currency: "CAD" });
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "SCANTRIX TEST Visa", rows: [{ date: "2026-11-22", description: "PAYMENT RECEIVED - THANK YOU", amount: 500 }], currency: "CAD" });
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "SCANTRIX TEST Chequing", ledger: { id: "38", name: "Chequing" }, userId: "u1" });
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "SCANTRIX TEST Visa", ledger: { id: "79", name: "Visa Credit Card" }, userId: "u1" });
    return (await listTransactions(db, QB)) as unknown as BankTransaction[];
  };
  const mapping = { ledgerIdOf: (t: BankTransaction) => ({ "SCANTRIX TEST Chequing": "38", "SCANTRIX TEST Visa": "79" })[t.accountName] ?? null, currencyOf: () => "CAD" };

  it("posting a suggested transfer makes one entry and marks both lines; a line can't be sent again", async () => {
    const [pair] = findTransferPairs(await seedTwoAccounts(), mapping);
    assert.ok(pair);
    for (const x of pairPatches(pair)) {
      const patch = readPatch(x.patch as Record<string, unknown>);
      assert.equal(typeof patch, "object");
      assert.ok((await decide(db, { qbConnectionId: QB, id: x.id, userId: "u1", patch: patch as Exclude<typeof patch, string> })).ok);
    }
    const { svc, calls } = services();
    const [r] = await postLines(db, svc, { qbConnectionId: QB, ids: [pair.out.id], userId: "u1" });
    assert.equal(r.ok, true, r.error);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].kind, (calls[0] as { fromAccountId?: string }).fromAccountId, (calls[0] as { toAccountId?: string }).toAccountId], ["transfer", "38", "79"]);
    for (const id of [pair.out.id, pair.in.id]) {
      const t = await getTransaction(db, QB, id);
      assert.equal(t?.status, "transfer");
      assert.equal(t?.postingStatus, "posted");
    }
    const again = await postLines(db, svc, { qbConnectionId: QB, ids: [pair.out.id, pair.in.id], userId: "u1" });
    assert.equal(calls.length, 1, "nothing sent twice");
    assert.ok(again.every((x) => !x.ok || x.transaction?.postingStatus === "posted"));
  });

  it("'Not this' stops the pair coming back, and can't reach another company's lines", async () => {
    const txns = await seedTwoAccounts();
    const [pair] = findTransferPairs(txns, mapping);
    await importCsv(db, { qbConnectionId: OTHER, userId: "u9", accountLabel: "Other Bank", rows: [{ date: "2026-11-21", description: "X", amount: -1 }] });
    const [foreign] = await listTransactions(db, OTHER);
    assert.equal(await refuseTransferPair(db, { qbConnectionId: QB, ids: [pair.out.id, foreign.id], userId: "u1" }), false);
    assert.equal(await refuseTransferPair(db, { qbConnectionId: QB, ids: [pair.out.id, pair.in.id], userId: "u1" }), true);
    const after = (await listTransactions(db, QB)) as unknown as BankTransaction[];
    assert.equal(findTransferPairs(after, mapping).length, 0);
  });

  it("a match to a bill entered only in QuickBooks pays that bill once", async () => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "SCANTRIX TEST Chequing", rows: [{ date: "2026-11-10", description: "PETRO-CANADA 0123", amount: -50 }], currency: "CAD" });
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "SCANTRIX TEST Chequing", ledger: { id: "38", name: "Chequing" }, userId: "u1" });
    const [t] = await listTransactions(db, QB);
    const patch = readPatch({ status: "matched", matchedInvoiceId: "ledger:88:56" }) as Exclude<ReturnType<typeof readPatch>, string>;
    assert.ok((await decide(db, { qbConnectionId: QB, id: t.id, userId: "u1", patch })).ok);
    const { svc, calls } = services();
    await postLines(db, svc, { qbConnectionId: QB, ids: [t.id], userId: "u1" });
    await postLines(db, svc, { qbConnectionId: QB, ids: [t.id], userId: "u1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "billPayment");
    assert.equal((calls[0] as { billId?: string }).billId, "88");
  });

  it("a company's lines can't be read or changed through another company", async () => {
    await importCsv(db, { qbConnectionId: OTHER, userId: "u9", accountLabel: "Other Bank", rows: [{ date: "2026-11-21", description: "SECRET LINE", amount: -9 }] });
    const [foreign] = await listTransactions(db, OTHER);
    assert.equal(await getTransaction(db, QB, foreign.id), null);
    const r = await decide(db, { qbConnectionId: QB, id: foreign.id, userId: "u1", patch: { status: "excluded" } });
    assert.equal(r.ok, false);
    const { svc, calls } = services();
    const [p] = await postLines(db, svc, { qbConnectionId: QB, ids: [foreign.id], userId: "u1" });
    assert.equal(p.ok, false);
    assert.equal(calls.length, 0);
    assert.equal((await listTransactions(db, QB)).length, 0);
  });

  it("Off sends nothing to OpenAI", async () => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "SCANTRIX TEST Chequing", rows: [{ date: "2026-11-22", description: "WSIB PREMIUM 22041", amount: -312 }], currency: "CAD" });
    await db.companyLists.updateOne({ _id: QB }, { $set: { chart: CHART.map((a) => ({ ...a, parentId: null })), environment: "sandbox", provider: "quickbooks", chartAt: new Date(), vendors: [], vendorsAt: new Date() } }, { upsert: true });
    await db.suggestionSettings.updateOne({ _id: QB }, { $set: { autoClassification: "off" } }, { upsert: true });
    let asked = 0;
    const picker: AiPicker = {
      model: "fake:1",
      async pick() {
        asked += 1;
        return { raw: { picks: [] } };
      },
    };
    const outcome = await runAiPicks(db, QB, picker);
    assert.equal(outcome.skipped, "off");
    assert.equal(asked, 0);
  });

  it("feature switches: on by default, off per company, other companies untouched", async () => {
    assert.deepEqual(await readFeatures(db, QB), { aiPrefill: true, receiptWarning: true, autoMatch: true, transferSuggestions: true });
    await setFeatures(db, { qbConnectionId: QB, userId: "u1", features: { transferSuggestions: false, bogus: false } });
    assert.equal((await readFeatures(db, QB)).transferSuggestions, false);
    assert.equal((await readFeatures(db, QB)).aiPrefill, true);
    assert.equal((await readFeatures(db, OTHER)).transferSuggestions, true);
  });

  it("speed: 2,000 lines list in under 2 seconds, and the screen's matching, pairing and pre-fill run in well under a second", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ date: `2026-${String((i % 11) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`, description: `MERCHANT ${i % 300} STORE ${i}`, amount: -((i % 500) + 1) }));
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "SCANTRIX TEST Chequing", rows, currency: "CAD" });
    const t0 = performance.now();
    const listed = (await listTransactions(db, QB)) as unknown as BankTransaction[];
    const listMs = performance.now() - t0;
    assert.equal(listed.length, 2000);
    assert.ok(listMs < 2000, `listed in ${Math.round(listMs)} ms`);
    const bills = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, vendor: `Merchant ${i}`, number: String(i), date: "2026-06-01", total: i + 1, billId: String(i) }));
    const t1 = performance.now();
    findStrongSuggestions(listed, bills);
    findTransferPairs(listed, mapping);
    for (const t of listed) prefillFor(t, ctx());
    const screenMs = performance.now() - t1;
    assert.ok(screenMs < 1000, `screen work in ${Math.round(screenMs)} ms`);
    console.log(`# speed: list ${Math.round(listMs)} ms, matching + pairs + pre-fill ${Math.round(screenMs)} ms for 2,000 lines`);
  });

  describe("new lines arrive without 'Sync now'", () => {
    const config: BankFeedsConfig = {
      enabled: true,
      plaidEnv: "sandbox",
      plaidClientId: "client",
      plaidSecret: "secret",
      webhookUrl: "https://example.test/api/plaid/webhook",
      tokenEncryptionKey: Buffer.alloc(32, 7),
      mongoUri: URL ?? "",
      mongoDbName: BANK_TEST_DB_NAME,
      historyDays: 365,
    };
    const acct = { account_id: "acc-1", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { current: 1, available: 1, iso_currency_code: "CAD" } } as unknown as AccountBase;
    class Fake implements PlaidGateway {
      pages: SyncPage[] = [];
      webhooks: string[] = [];
      async createLinkToken() {
        return { linkToken: "l", expiration: "" };
      }
      async exchangePublicToken(t: string) {
        return { accessToken: `access-sandbox-${t}`, itemId: `item-${t}` };
      }
      async getAccounts() {
        return { institutionId: "ins_1", consentExpiresAt: null, accounts: [acct] };
      }
      async syncTransactions(_t: string, cursor: string | null) {
        return this.pages.shift() ?? { added: [], modified: [], removed: [], accounts: [], nextCursor: cursor ?? "c0", hasMore: false };
      }
      async removeItem() {}
      async itemError() {
        return null;
      }
      async institutionName() {
        return "Test Bank";
      }
      async webhookKey() {
        return null;
      }
      async sandboxPublicToken() {
        return "p";
      }
      async sandboxFireWebhook() {}
      async sandboxResetLogin() {}
      async updateWebhook(_t: string, url: string) {
        this.webhooks.push(url);
      }
    }
    const newLine = (id: string) =>
      ({ transaction_id: id, account_id: "acc-1", amount: 50, date: "2026-11-10", name: "PETRO-CANADA 0123", merchant_name: "Petro-Canada", iso_currency_code: "CAD", pending: false, payment_channel: "in store" }) as unknown as Transaction;

    it("a login not synced for 15 minutes is synced, its webhook set once; another company's login is not touched", async () => {
      const plaid = new Fake();
      await connectItem(db, plaid, config, { qbConnectionId: QB, userId: "u1", publicToken: "a", meta: { institutionId: "ins_1", institutionName: "Test Bank", accountMasks: ["0000"] } });
      await connectItem(db, plaid, config, { qbConnectionId: OTHER, userId: "u9", publicToken: "b", meta: { institutionId: "ins_1", institutionName: "Test Bank", accountMasks: ["0000"] } });
      await db.items.updateMany({}, { $set: { lastSyncedAt: new Date(Date.now() - SYNC_DUE_MS - 1000) } });
      plaid.pages.push({ added: [newLine("tx-new")], modified: [], removed: [], accounts: [acct], nextCursor: "c1", hasMore: false });
      const out = await syncDueItems(db, plaid, config, QB);
      assert.equal(out.added, 1);
      assert.equal(out.webhooksSet, 1);
      assert.equal((await listTransactions(db, QB)).length, 1);
      assert.equal((await listTransactions(db, OTHER)).length, 0, "only this company's logins");
      const again = await syncDueItems(db, plaid, config, QB);
      assert.equal(again.synced, 0, "synced a moment ago: not again");
      assert.equal(again.webhooksSet, 0, "the webhook is set once");
    });
  });
});
