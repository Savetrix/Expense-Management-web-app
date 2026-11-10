// What a bank line becomes in QuickBooks and Xero: the exact request bodies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQbRequest } from "../lib/bankFeeds/ledger/quickbooks";
import type { Posting } from "../lib/bankFeeds/ledger/types";
import { buildXeroRequest } from "../lib/bankFeeds/ledger/xero";

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
