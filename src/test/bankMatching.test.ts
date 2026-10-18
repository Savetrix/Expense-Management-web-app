// Strong-match suggestions and paperwork links used by the Bank Transactions page.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findStrongSuggestions, isStrongMatch, paperworkHref } from "../components/v2/bankTransactions/matching";
import type { BankTransaction, InvoiceCandidate } from "../components/v2/bankTransactions/types";

const txn = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  id: "t1",
  date: "2025-03-10",
  description: "ACME LTD",
  accountName: "Chequing",
  amount: -120.5,
  status: "review",
  source: "csv",
  ...over,
});
const inv = (over: Partial<InvoiceCandidate> = {}): InvoiceCandidate => ({
  id: "i1",
  vendor: "Acme",
  number: "A-1",
  date: "2025-03-08",
  total: 120.5,
  ...over,
});

describe("isStrongMatch", () => {
  it("accepts the same amount within 7 days", () => {
    assert.equal(isStrongMatch(txn(), inv()), true);
    assert.equal(isStrongMatch(txn(), inv({ date: "2025-03-17" })), true);
  });
  it("rejects a different amount or a date more than 7 days away", () => {
    assert.equal(isStrongMatch(txn(), inv({ total: 120.51 })), false);
    assert.equal(isStrongMatch(txn(), inv({ date: "2025-03-18" })), false);
    assert.equal(isStrongMatch(txn(), inv({ total: null })), false);
    assert.equal(isStrongMatch(txn(), inv({ date: "" })), false);
  });
});

describe("findStrongSuggestions", () => {
  it("suggests only review lines and offers a bill once", () => {
    const out = findStrongSuggestions(
      [txn(), txn({ id: "t2" }), txn({ id: "t3", status: "excluded" })],
      [inv()],
    );
    assert.deepEqual(out.map((s) => s.txn.id), ["t1"]);
  });
  it("skips bills already matched to another line", () => {
    const out = findStrongSuggestions([txn(), txn({ id: "t9", status: "matched", matchedInvoiceId: "i1" })], [inv()]);
    assert.equal(out.length, 0);
  });
});

describe("paperworkHref", () => {
  it("builds the /requests prefill link with an absolute amount", () => {
    const url = new URL(paperworkHref(txn({ description: "A & B" })), "http://x");
    assert.equal(url.pathname, "/requests");
    assert.equal(url.searchParams.get("new"), "1");
    assert.equal(url.searchParams.get("item"), "A & B");
    assert.equal(url.searchParams.get("amount"), "120.5");
    assert.equal(url.searchParams.get("date"), "2025-03-10");
  });
});
