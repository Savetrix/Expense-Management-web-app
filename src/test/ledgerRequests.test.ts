// What a bank line becomes in QuickBooks and Xero: the exact request bodies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQbBillBalanceQueries, buildQbEntryQuery, buildQbRequest, entriesFromQbAnswer, paidFromQbAnswer } from "../lib/bankFeeds/ledger/quickbooks";
import type { Posting } from "../lib/bankFeeds/ledger/types";
import { buildXeroBillRequests, buildXeroEntryRequest, buildXeroRequest, entriesFromXeroAnswer, paidFromXeroAnswer, xeroDay } from "../lib/bankFeeds/ledger/xero";

/** A JSON body, read loosely in assertions. */
type Json = { [key: string]: Json } & { [index: number]: Json };

const bank = { id: "35", isCard: false };
const card = { id: "41", isCard: true };
const base = { date: "2026-10-02", amount: 112, memo: "UBER *TRIP" };
const expense = (over: Partial<Extract<Posting, { kind: "expense" }>> = {}): Posting => ({ kind: "expense", ...base, bankAccount: bank, vendorId: "56", glAccountId: "7", taxCodeId: null, taxRate: null, ...over });

describe("QuickBooks requests", () => {
  it("money out from a bank account is a cash Purchase with the vendor and GL, and a requestid", () => {
    const { entity, request } = buildQbRequest(expense(), "sx-abc-1");
    assert.equal(entity, "Purchase");
    assert.equal(request.path, "/purchase");
    assert.deepEqual(request.query, { requestid: "sx-abc-1" });
    const b = request.body as unknown as Json;
    assert.equal(b.PaymentType, "Cash");
    assert.deepEqual(b.AccountRef, { value: "35" });
    assert.deepEqual(b.EntityRef, { value: "56", type: "Vendor" });
    assert.equal(b.TxnDate, "2026-10-02");
    assert.equal(b.Line[0].Amount, 112);
    assert.deepEqual(b.Line[0].AccountBasedExpenseLineDetail, { AccountRef: { value: "7" } });
    assert.equal(b.GlobalTaxCalculation, undefined, "no tax code, no tax mode");
  });

  it("splits tax out of the bank's gross amount when a tax code is set", () => {
    const b = buildQbRequest(expense({ taxCodeId: "5", taxRate: 5 }), "k").request.body as unknown as Json;
    assert.equal(b.GlobalTaxCalculation, "TaxInclusive");
    assert.equal(b.Line[0].Amount, 106.67);
    assert.deepEqual(b.Line[0].AccountBasedExpenseLineDetail.TaxCodeRef, { value: "5" });
    assert.equal(b.Line[0].AccountBasedExpenseLineDetail.TaxInclusiveAmt, 112);
  });

  it("money out on a card is a CreditCard purchase; a card refund is a credit", () => {
    assert.equal((buildQbRequest(expense({ bankAccount: card }), "k").request.body as unknown as Json).PaymentType, "CreditCard");
    const refund = buildQbRequest({ ...expense({ bankAccount: card }), kind: "deposit" } as Posting, "k");
    assert.equal(refund.entity, "Purchase");
    assert.equal((refund.request.body as unknown as Json).Credit, true);
  });

  it("money in to a bank account is a Deposit to that account", () => {
    const { entity, request } = buildQbRequest({ ...expense(), kind: "deposit", glAccountId: "79" } as Posting, "k");
    assert.equal(entity, "Deposit");
    const b = request.body as unknown as Json;
    assert.deepEqual(b.DepositToAccountRef, { value: "35" });
    assert.deepEqual(b.Line[0].DepositLineDetail.AccountRef, { value: "79" });
    assert.equal(b.Line[0].DetailType, "DepositLineDetail");
  });

  it("a matched line is a BillPayment linked to the bill, paid by cheque or card", () => {
    const pay = (bankAccount: { id: string; isCard: boolean }) => buildQbRequest({ kind: "billPayment", ...base, bankAccount, vendorId: "56", billId: "145" }, "k");
    const byBank = pay(bank).request.body as unknown as Json;
    assert.equal(byBank.PayType, "Check");
    assert.deepEqual(byBank.CheckPayment, { BankAccountRef: { value: "35" } });
    assert.deepEqual(byBank.Line, [{ Amount: 112, LinkedTxn: [{ TxnId: "145", TxnType: "Bill" }] }]);
    assert.equal(byBank.TotalAmt, 112);
    const byCard = pay(card).request.body as unknown as Json;
    assert.deepEqual(byCard.CreditCardPayment, { CCAccountRef: { value: "41" } });
  });

  it("a transfer goes from one account to the other", () => {
    const { entity, request } = buildQbRequest({ kind: "transfer", ...base, fromAccountId: "35", toAccountId: "36" }, "k");
    assert.equal(entity, "Transfer");
    assert.deepEqual(request.body, { FromAccountRef: { value: "35" }, ToAccountRef: { value: "36" }, Amount: 112, TxnDate: "2026-10-02", PrivateNote: "UBER *TRIP" });
  });

  it("keeps requestid within QuickBooks' 50 characters", () => {
    const key = `sx-${"a".repeat(36)}-12`;
    assert.ok((buildQbRequest(expense(), key).request.query?.requestid ?? "").length <= 50);
  });
});

describe("Xero requests", () => {
  it("money out is SPEND money with the contact, bank account and an Idempotency-Key", () => {
    const { collection, request } = buildXeroRequest(expense({ vendorId: "c-1", glAccountId: "a-7", bankAccount: { id: "b-1", isCard: false } }), "sx-abc-1");
    assert.equal(collection, "BankTransactions");
    assert.equal(request.method, "PUT");
    assert.equal(request.headers?.["Idempotency-Key"], "sx-abc-1");
    const t = (request.body as unknown as Json).BankTransactions[0];
    assert.equal(t.Type, "SPEND");
    assert.deepEqual(t.Contact, { ContactID: "c-1" });
    assert.deepEqual(t.BankAccount, { AccountID: "b-1" });
    assert.equal(t.LineAmountTypes, "NoTax");
    assert.deepEqual(t.LineItems[0], { Description: "UBER *TRIP", Quantity: 1, UnitAmount: 112, AccountID: "a-7" });
  });

  it("with a tax type, the gross amount is tax-inclusive", () => {
    const t = (buildXeroRequest(expense({ taxCodeId: "INPUT2" }), "k").request.body as unknown as Json).BankTransactions[0];
    assert.equal(t.LineAmountTypes, "Inclusive");
    assert.equal(t.LineItems[0].TaxType, "INPUT2");
  });

  it("money in is RECEIVE money", () => {
    const t = (buildXeroRequest({ ...expense(), kind: "deposit" } as Posting, "k").request.body as unknown as Json).BankTransactions[0];
    assert.equal(t.Type, "RECEIVE");
  });

  it("refuses a spend without a contact, before calling Xero", () => {
    assert.throws(() => buildXeroRequest(expense({ vendorId: null }), "k"), /needs a contact/);
  });

  it("a matched line is a Payment on the bill; a transfer is a BankTransfer", () => {
    const pay = buildXeroRequest({ kind: "billPayment", ...base, bankAccount: { id: "b-1", isCard: false }, vendorId: "c-1", billId: "inv-9" }, "k");
    assert.deepEqual((pay.request.body as unknown as Json).Payments[0], { Invoice: { InvoiceID: "inv-9" }, Account: { AccountID: "b-1" }, Date: "2026-10-02", Amount: 112, Reference: "UBER *TRIP" });
    const tr = buildXeroRequest({ kind: "transfer", ...base, fromAccountId: "b-1", toAccountId: "b-2" }, "k");
    assert.deepEqual((tr.request.body as unknown as Json).BankTransfers[0], { FromBankAccount: { AccountID: "b-1" }, ToBankAccount: { AccountID: "b-2" }, Amount: 112, Date: "2026-10-02" });
  });
});

describe("Reading which bills are paid", () => {
  it("QuickBooks: one query per 100 bills, only numeric ids, no repeats", () => {
    const ids = [...Array.from({ length: 150 }, (_, i) => String(i + 1)), "1", "9' or 1=1", "abc"];
    const reqs = buildQbBillBalanceQueries(ids);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].path, "/query");
    assert.match(reqs[0].query?.query ?? "", /^select Id, Balance from Bill where Id in \('1','2',.*'100'\) MAXRESULTS 1000$/);
    assert.ok(!(reqs[1].query?.query ?? "").includes("or 1=1"));
    assert.deepEqual(buildQbBillBalanceQueries([]), []);
  });
  it("QuickBooks: a bill is paid when its balance is zero", () => {
    const answer = { QueryResponse: { Bill: [{ Id: "145", Balance: 0 }, { Id: "146", Balance: 12.5 }, { Id: "147" }] } };
    assert.deepEqual(paidFromQbAnswer(answer), ["145"]);
    assert.deepEqual(paidFromQbAnswer({ QueryResponse: {} }), []);
  });
  it("Xero: one request per 40 bills, only Xero ids", () => {
    const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    const reqs = buildXeroBillRequests([...Array.from({ length: 41 }, (_, i) => id(i)), "145"]);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].path, "/Invoices");
    assert.equal(reqs[0].query?.IDs.split(",").length, 40);
    assert.equal(reqs[1].query?.IDs, id(40));
  });
  it("Xero: paid, voided or deleted bills, or nothing left due, can't be paid", () => {
    const answer = {
      Invoices: [
        { InvoiceID: "a", Status: "PAID", AmountDue: 0 },
        { InvoiceID: "b", Status: "AUTHORISED", AmountDue: 30 },
        { InvoiceID: "c", Status: "AUTHORISED", AmountDue: 0 },
        { InvoiceID: "d", Status: "VOIDED" },
        { InvoiceID: "e", Status: "DRAFT", AmountDue: 0 },
      ],
    };
    assert.deepEqual(paidFromXeroAnswer(answer), ["a", "c", "d"]);
  });
});

describe("reading entries already in the books", () => {
  const APP = "https://app.sandbox.qbo.intuit.com/app";

  it("QuickBooks: one dated query per entity, and bad dates are refused", () => {
    const q = buildQbEntryQuery("Purchase", "2026-11-01", "2026-11-14", 1001);
    assert.equal(q.path, "/query");
    assert.equal(q.query?.query, "select * from Purchase where TxnDate >= '2026-11-01' and TxnDate <= '2026-11-14' STARTPOSITION 1001 MAXRESULTS 1000");
    assert.throws(() => buildQbEntryQuery("Purchase", "2026-11-01' or 1=1", "2026-11-14"));
  });

  it("QuickBooks: an expense is money out of its account, a card credit is money in", () => {
    const rows = entriesFromQbAnswer(
      "Purchase",
      {
        QueryResponse: {
          Purchase: [
            { Id: "301", TxnDate: "2026-11-04", TotalAmt: 54.2, AccountRef: { value: "35" }, PaymentType: "Cash", EntityRef: { name: "Petro-Canada" } },
            { Id: "302", TxnDate: "2026-11-05", TotalAmt: 20, AccountRef: { value: "41" }, PaymentType: "CreditCard", Credit: true },
            { Id: "303", TxnDate: "2026-11-05", TotalAmt: 0, AccountRef: { value: "35" } },
          ],
        },
      },
      APP,
    );
    assert.equal(rows.length, 2, "a zero entry is left out");
    assert.deepEqual(rows[0], { key: "Purchase:301", entity: "Purchase", id: "301", accountId: "35", date: "2026-11-04", amountCents: -5420, label: "Expense", name: "Petro-Canada", url: `${APP}/expense?txnId=301` });
    assert.equal(rows[1].amountCents, 2000);
    assert.equal(rows[1].label, "Card credit");
  });

  it("QuickBooks: a transfer is two sides, a bill payment is money out of its bank or card", () => {
    const transfer = entriesFromQbAnswer("Transfer", { QueryResponse: { Transfer: [{ Id: "9", TxnDate: "2026-11-02", Amount: 500, FromAccountRef: { value: "35", name: "Chequing" }, ToAccountRef: { value: "36", name: "Savings" } }] } }, APP);
    assert.deepEqual(
      transfer.map((e) => [e.key, e.accountId, e.amountCents, e.name]),
      [
        ["Transfer:9:from", "35", -50000, "To Savings"],
        ["Transfer:9:to", "36", 50000, "From Chequing"],
      ],
    );
    const paid = entriesFromQbAnswer("BillPayment", { QueryResponse: { BillPayment: [{ Id: "77", TxnDate: "2026-11-03", TotalAmt: 99.99, PayType: "CreditCard", CreditCardPayment: { CCAccountRef: { value: "41" } }, VendorRef: { name: "Staples" } }] } }, APP);
    assert.deepEqual([paid[0].accountId, paid[0].amountCents, paid[0].label], ["41", -9999, "Bill payment"]);
    const deposit = entriesFromQbAnswer("Deposit", { QueryResponse: { Deposit: [{ Id: "5", TxnDate: "2026-11-03", TotalAmt: 1200, DepositToAccountRef: { value: "35" } }] } }, APP);
    assert.equal(deposit[0].amountCents, 120000);
  });

  it("Xero: dated filters, both date formats, and the right direction for each kind", () => {
    const req = buildXeroEntryRequest("BankTransactions", "2026-11-01", "2026-11-14", 2);
    assert.equal(req.path, "/BankTransactions");
    assert.deepEqual(req.query, { where: "Date >= DateTime(2026,11,1) && Date <= DateTime(2026,11,14)", page: "2" });
    assert.equal(xeroDay(undefined, "/Date(1762214400000+0000)/"), "2025-11-04");
    assert.equal(xeroDay("2026-11-04T00:00:00", "/Date(0)/"), "2026-11-04");

    const link = (path: string) => `https://go.xero.com${path}`;
    const bank = entriesFromXeroAnswer(
      "BankTransactions",
      {
        BankTransactions: [
          { BankTransactionID: "a1", Type: "SPEND", Status: "AUTHORISED", DateString: "2026-11-04T00:00:00", Total: 54.2, BankAccount: { AccountID: "acc-1" }, Contact: { Name: "Petro-Canada" } },
          { BankTransactionID: "a2", Type: "RECEIVE", Status: "AUTHORISED", DateString: "2026-11-05T00:00:00", Total: 10, BankAccount: { AccountID: "acc-1" } },
          { BankTransactionID: "a3", Type: "SPEND-TRANSFER", Status: "AUTHORISED", DateString: "2026-11-05T00:00:00", Total: 10, BankAccount: { AccountID: "acc-1" } },
          { BankTransactionID: "a4", Type: "SPEND", Status: "DELETED", DateString: "2026-11-05T00:00:00", Total: 10, BankAccount: { AccountID: "acc-1" } },
        ],
      },
      link,
    );
    assert.deepEqual(bank.map((e) => [e.key, e.amountCents, e.label]), [
      ["BankTransaction:a1", -5420, "Spend money"],
      ["BankTransaction:a2", 1000, "Receive money"],
    ]);
    const payments = entriesFromXeroAnswer(
      "Payments",
      {
        Payments: [
          { PaymentID: "p1", PaymentType: "ACCPAYPAYMENT", Status: "AUTHORISED", DateString: "2026-11-03T00:00:00", Amount: 99.99, Account: { AccountID: "acc-1" }, Invoice: { Contact: { Name: "Staples" } } },
          { PaymentID: "p2", PaymentType: "ACCRECPAYMENT", Status: "AUTHORISED", DateString: "2026-11-03T00:00:00", Amount: 40, Account: { AccountID: "acc-1" } },
        ],
      },
      link,
    );
    assert.deepEqual(payments.map((e) => [e.amountCents, e.label]), [
      [-9999, "Bill payment"],
      [4000, "Payment"],
    ]);
    const transfers = entriesFromXeroAnswer("BankTransfers", { BankTransfers: [{ BankTransferID: "t1", DateString: "2026-11-02T00:00:00", Amount: 500, FromBankAccount: { AccountID: "acc-1", Name: "Chequing" }, ToBankAccount: { AccountID: "acc-2", Name: "Savings" } }] }, link);
    assert.deepEqual(transfers.map((e) => [e.key, e.accountId, e.amountCents]), [
      ["BankTransfer:t1:from", "acc-1", -50000],
      ["BankTransfer:t1:to", "acc-2", 50000],
    ]);
  });
});
