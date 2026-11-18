// Bank lines after the 18 Nov call with Saurabh: the GL list is the other side
// of the entry (no Bank accounts), one vendor box with "Add as vendor", tax
// only from the vendor, currency from the bank account, and the bank side of
// every post is the line's own mapped account.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { bankLineGlChoices, currencyMismatch, lineCurrency, lineLedgerId, newVendorPatch, vendorFormDefaults } from "../components/v2/bankTransactions/glList";
import type { BankAccount } from "../components/v2/bankTransactions/types";
import { addRow } from "../components/v2/ui/CreatableCombobox";
import { accountCurrency } from "../lib/bankFeeds/companyLists";
import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { setNamedMapping } from "../lib/bankFeeds/ledgerMappings";
import type { LedgerAccount, LedgerAdapter, LedgerContext, Posting } from "../lib/bankFeeds/ledger/types";
import { postLines, type PostingServices } from "../lib/bankFeeds/posting";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";
import type { GLAccount } from "../store/quickBooks/quickBooksSlice";

import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";
import { saveChart } from "./helpers/posted";

const CHART = [
  { id: "1", name: "Cash on hand", kind: "bank" as const, type: "Bank", currency: "CAD" },
  { id: "35", name: "Business Chequing", kind: "bank" as const, type: "Bank", currency: "CAD" },
  { id: "41", name: "Visa", kind: "card" as const, type: "Credit Card", currency: "CAD" },
  { id: "50", name: "Accounts Payable (A/P)", kind: "payable" as const, type: "Accounts Payable", currency: "CAD" },
  { id: "51", name: "Accounts Receivable (A/R)", kind: "receivable" as const, type: "Accounts Receivable", currency: "CAD" },
  { id: "7", name: "Meals", kind: "expense" as const, type: "Expense", currency: null },
  { id: "8", name: "Vehicles:Fuel", kind: "expense" as const, type: "Expense", currency: null, parentId: "9" },
  { id: "9", name: "Vehicles", kind: "expense" as const, type: "Expense", currency: null },
  { id: "60", name: "Computer equipment", kind: "other" as const, type: "Fixed Asset", currency: null },
  { id: "70", name: "Sales", kind: "income" as const, type: "Income", currency: null },
];

describe("the GL list on a bank line", () => {
  it("is the full chart without Bank accounts (Cash included) and without the line's own account", () => {
    const ids = bankLineGlChoices({ chart: CHART, backendGl: [], lineLedgerId: "41", moneyIn: false }).map((c) => c.id);
    assert.ok(!ids.includes("1"), "no Cash");
    assert.ok(!ids.includes("35"), "no Bank account");
    assert.ok(!ids.includes("41"), "not the card the line belongs to");
    assert.ok(ids.includes("60"), "an asset, like computer equipment");
    assert.ok(ids.includes("70") && ids.includes("7"));
  });

  it("offers Accounts Payable as paying a bill, and leaves out Accounts Receivable", () => {
    const choices = bankLineGlChoices({ chart: CHART, backendGl: [], lineLedgerId: null, moneyIn: false });
    assert.equal(choices.find((c) => c.id === "50")?.label, "Accounts Payable (A/P) (pay a bill)");
    assert.equal(choices.find((c) => c.id === "50")?.kind, "payable");
    assert.ok(!choices.some((c) => c.id === "51"));
  });

  it("shows a sub-account under its parent, and lists income first for money in", () => {
    const out = bankLineGlChoices({ chart: CHART, backendGl: [], lineLedgerId: null, moneyIn: false });
    const labels = out.map((c) => c.label);
    assert.equal(labels[labels.indexOf("Vehicles") + 1], "Vehicles › Fuel");
    assert.equal(bankLineGlChoices({ chart: CHART, backendGl: [], lineLedgerId: null, moneyIn: true })[0].id, "70");
  });

  it("without the chart, uses the backend's list without Bank or deleted accounts", () => {
    const gl = (id: string, name: string, accountType: string, isDeleted = false): GLAccount => ({ _id: id, qbAccountId: id, qbConnectionId: "qb", accountType, accountSubType: "", name, realmId: "r", isDeleted });
    const ids = bankLineGlChoices({ chart: [], backendGl: [gl("1", "Cash", "Bank"), gl("7", "Meals", "Expense"), gl("6", "Old meals", "Expense", true)], lineLedgerId: null, moneyIn: false }).map((c) => c.id);
    assert.deepEqual(ids, ["7"]);
  });
});

describe("which account and currency a line belongs to", () => {
  const plaid: BankAccount = { id: "acc-1", institutionName: "RBC", name: "Chequing", lastSyncedAt: null, status: "connected", mappedGlAccountId: "35", currency: "CAD" };
  const named = [{ accountLabel: "Amex file", lines: 3, mappedLedgerAccountId: "41" }];

  it("finds the mapped account for a connected account and for an imported file", () => {
    assert.equal(lineLedgerId({ accountId: "acc-1", accountName: "RBC Chequing" }, [plaid], named), "35");
    assert.equal(lineLedgerId({ accountId: null, accountName: "Amex file" }, [plaid], named), "41");
    assert.equal(lineLedgerId({ accountId: null, accountName: "Unmapped" }, [plaid], named), null);
  });

  it("takes the currency from the bank account: the line's own, the mapped account's, else the home currency", () => {
    const ctx = { bankAccounts: [plaid], named, chart: [{ ...CHART[2], currency: "USD" }], homeCurrency: "CAD" };
    assert.equal(lineCurrency({ accountId: "acc-1", accountName: "RBC Chequing", currency: "cad" }, ctx), "CAD", "a bank line");
    assert.equal(lineCurrency({ accountId: null, accountName: "Amex file", currency: null }, ctx), "USD", "an imported file mapped to a USD card");
    assert.equal(lineCurrency({ accountId: null, accountName: "Unmapped", currency: null }, ctx), "CAD", "else the company's home currency");
  });

  it("flags a vendor in another currency than the bank account", () => {
    assert.equal(currencyMismatch("USD", "CAD"), true);
    assert.equal(currencyMismatch("cad", "CAD"), false);
    assert.equal(currencyMismatch(null, "CAD"), false, "unknown is not a mismatch");
  });
});

describe("one vendor box, like the invoice screen", () => {
  const options = [{ id: "v1", label: "Petro Canada" }];

  it("typing an unknown name offers to add it as a vendor", () => {
    assert.equal(addRow({ typed: "Tim Hortons", value: "", options, noun: "vendor" }).label, 'Add "Tim Hortons" as new vendor');
  });

  it("offers ScanTrix's clean name before anything is typed, unless it already is a vendor", () => {
    assert.equal(addRow({ typed: "", value: "", suggestedNew: "Tim Hortons", options, noun: "vendor" }).label, 'Add "Tim Hortons" as new vendor');
    assert.equal(addRow({ typed: "", value: "", suggestedNew: "Petro Canada", options, noun: "vendor" }).label, "Add new vendor");
    assert.equal(addRow({ typed: "", value: "v1", suggestedNew: "Tim Hortons", options, noun: "vendor" }).offerName, "", "not when a vendor is picked");
  });

  it("opens the form with a clean name, the bank account's currency, the suggested GL and no tax", () => {
    assert.deepEqual(vendorFormDefaults({ typed: "", suggestedName: "Tim Hortons", glAccountId: "7", currency: "CAD" }), { name: "Tim Hortons", currency: "CAD", glAccountId: "7", taxCodeId: "" });
    assert.equal(vendorFormDefaults({ typed: "Tims Coffee ", suggestedName: "Tim Hortons", glAccountId: null, currency: null }).name, "Tims Coffee");
  });

  it("after saving, the line shows the new vendor, with its defaults only where the line has nothing", () => {
    const vendor = { _id: "v-tims", displayName: "Tim Hortons", glAccountId: "7", taxCodeId: "gst" };
    assert.deepEqual(newVendorPatch(vendor, {}), { vendorId: "v-tims", payee: "Tim Hortons", categoryId: "7", taxCodeId: "gst" });
    assert.deepEqual(newVendorPatch(vendor, { glAccountId: "8" }), { vendorId: "v-tims", payee: "Tim Hortons", taxCodeId: "gst" });
  });
});

describe("posting and importing", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
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

  const QB = "qb-18nov";
  const ctx: LedgerContext = { provider: "quickbooks", tenantId: "R1", accessToken: "at", environment: "sandbox", shortCode: null };
  function services(over: Partial<PostingServices> = {}) {
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
      ledger: { ...ctx },
      adapter,
      vendorIds: async () => new Map([["v-tims", "56"]]),
      taxRates: async () => new Map([["gst", 5]]),
      bill: async () => ({ billId: "145", vendorId: "56" }),
      ...over,
    };
    return { svc, calls };
  }
  const seed = async (rows: { date: string; description: string; amount: number }[]) => {
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "Chequing ••4421", rows });
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "Chequing ••4421", ledger: { id: "35", name: "Business Chequing" }, userId: "u1" });
    return listTransactions(db, QB);
  };

  it("QuickBooks outside the US: a line without a tax code isn't sent, and says to pick one", async () => {
    const [line] = await seed([{ date: "2026-11-10", description: "TIM HORTONS 0412", amount: -6.25 }]);
    assert.ok((await decide(db, { qbConnectionId: QB, id: line.id, userId: "u1", patch: { status: "ready", glAccountId: "7", vendorId: "v-tims" } })).ok);
    const { svc, calls } = services({ taxRequired: async () => true });
    const [r] = await postLines(db, svc, { qbConnectionId: QB, ids: [line.id], userId: "u1" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Pick a tax code/);
    assert.equal(calls.length, 0, "nothing was sent");
    const us = services({ taxRequired: async () => false });
    const [ok] = await postLines(db, us.svc, { qbConnectionId: QB, ids: [line.id], userId: "u1" });
    assert.equal(ok.ok, true, "a US company posts without one");
  });

  it("every post from a bank line uses the line's own mapped bank account: expense, deposit and bill payment", async () => {
    const [out, inLine, bill] = await seed([
      { date: "2026-11-10", description: "TIM HORTONS 0412", amount: -6.25 },
      { date: "2026-11-11", description: "CLIENT PAYMENT", amount: 500 },
      { date: "2026-11-12", description: "PAYMENT TO TIM HORTONS", amount: -70 },
    ]);
    await decide(db, { qbConnectionId: QB, id: out.id, userId: "u1", patch: { status: "ready", glAccountId: "7", vendorId: "v-tims", taxCodeId: "gst" } });
    await decide(db, { qbConnectionId: QB, id: inLine.id, userId: "u1", patch: { status: "ready", glAccountId: "70" } });
    await decide(db, { qbConnectionId: QB, id: bill.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-1" } });
    const { svc, calls } = services();
    const results = await postLines(db, svc, { qbConnectionId: QB, ids: [out.id, inLine.id, bill.id], userId: "u1" });
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error)));
    assert.deepEqual(
      calls.map((p) => [p.kind, (p as { bankAccount?: { id: string } }).bankAccount?.id]),
      [
        ["expense", "35"],
        ["deposit", "35"],
        ["billPayment", "35"],
      ],
    );
  });

  it("an imported file takes the currency of the bank account chosen at import", async () => {
    await saveChart(db, QB, [{ id: "41", name: "Visa USD", kind: "card", type: "Credit Card", currency: "USD" }]);
    await db.companyLists.updateOne({ _id: QB }, { $set: { homeCurrency: "CAD" } });
    await setNamedMapping(db, { qbConnectionId: QB, accountLabel: "Visa file", ledger: { id: "41", name: "Visa USD" }, userId: "u1" });
    assert.equal(await accountCurrency(db, QB, { label: "Visa file" }), "USD", "mapped to a USD card");
    assert.equal(await accountCurrency(db, QB, { label: "Some other file" }), "CAD", "else the home currency");
    await importCsv(db, { qbConnectionId: QB, userId: "u1", accountLabel: "Visa file", rows: [{ date: "2026-11-10", description: "AMAZON", amount: -20 }], currency: await accountCurrency(db, QB, { label: "Visa file" }) });
    const [line] = await listTransactions(db, QB);
    assert.equal(line.currency, "USD");
  });

  it("a connected bank account's lines keep that account's currency", async () => {
    await db.accounts.insertOne({ _id: "acc-1", qbConnectionId: QB, itemId: "item-1", plaidAccountId: "p-1", name: "Chequing", mask: "4421", type: "depository", subtype: "checking", currency: "cad", ledgerAccountId: "35", ledgerAccountName: "Business Chequing" } as never);
    assert.equal(await accountCurrency(db, QB, { accountId: "acc-1" }), "CAD");
  });
});
