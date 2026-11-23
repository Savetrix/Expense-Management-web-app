// Strong-match suggestions and paperwork links used by the Bank Transactions page.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { billsFor, closedBills, findStrongSuggestions, isStrongMatch, paperworkHref, rankInvoices, vendorAgrees } from "../components/v2/bankTransactions/matching";
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
  it("refuses the same amount and date from a vendor the bank text doesn't name", () => {
    assert.equal(isStrongMatch(txn({ description: "UBER *TRIP" }), inv()), false);
  });
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
  it("skips closed bills", () => {
    assert.equal(findStrongSuggestions([txn()], [inv()], new Set(["i1"])).length, 0);
  });
  it("needs the vendor named in the bank text", () => {
    assert.equal(findStrongSuggestions([txn({ description: "POS 4411" })], [inv()]).length, 0);
  });
  it("picks the named vendor's bill when two bills have the same amount", () => {
    const out = findStrongSuggestions([txn({ description: "STAPLES 0042" })], [inv(), inv({ id: "i2", vendor: "Staples" })]);
    assert.deepEqual(out.map((s) => s.invoice.id), ["i2"]);
  });
  it("never offers a bill to money coming in", () => {
    assert.equal(findStrongSuggestions([txn({ amount: 120.5 })], [inv()]).length, 0);
  });
});

describe("vendorAgrees", () => {
  it("finds the vendor's first real word, or the whole name, in the bank text", () => {
    assert.equal(vendorAgrees(txn({ description: "UBER *TRIP HELP.UBER.COM" }), inv({ vendor: "Uber Technologies Inc" })), true);
    assert.equal(vendorAgrees(txn({ description: "HOMEDEPOT #1234" }), inv({ vendor: "Home Depot" })), true);
    assert.equal(vendorAgrees(txn({ description: "POS 4411", merchantName: "Staples" }), inv({ vendor: "Staples Canada Ltd" })), true);
    assert.equal(vendorAgrees(txn({ description: "x", payee: "The Acme Co" }), inv({ vendor: "Acme" })), true);
  });
  it("says no for another vendor, an unknown vendor, or filler words only", () => {
    assert.equal(vendorAgrees(txn({ description: "UBER *TRIP" }), inv({ vendor: "Staples" })), false);
    assert.equal(vendorAgrees(txn({ description: "UNKNOWN VENDOR" }), inv({ vendor: "Unknown vendor" })), false);
    assert.equal(vendorAgrees(txn({ description: "LTD INC" }), inv({ vendor: "The Ltd Inc" })), false);
  });
});

describe("rankInvoices", () => {
  it("puts the bill from the named vendor first when two bills have the same amount", () => {
    const line = txn({ description: "STAPLES 0042" });
    const ranked = rankInvoices(line, [inv({ id: "acme", vendor: "Acme", date: "2025-03-10" }), inv({ id: "staples", vendor: "Staples", date: "2025-03-04" })]);
    assert.deepEqual(ranked.map((c) => c.id), ["staples", "acme"]);
  });
  it("still puts the closer amount before the vendor name", () => {
    const ranked = rankInvoices(txn(), [inv({ id: "named", total: 99 }), inv({ id: "exact", vendor: "Other" })]);
    assert.equal(ranked[0].id, "exact");
  });
});

describe("closedBills and billsFor", () => {
  const lines = [txn({ id: "t9", status: "matched", matchedInvoiceId: "i2" }), txn({ id: "t8", status: "review", matchedInvoiceId: "i3" })];
  const bills = [inv(), inv({ id: "i2" }), inv({ id: "i3", billId: "145" }), inv({ id: "i4", billId: "146" })];
  it("closes bills matched to a line and bills paid in the accounting software", () => {
    assert.deepEqual([...closedBills(lines, bills, new Set(["145"]))].sort(), ["i2", "i3"]);
  });
  it("keeps the line's own bill even when it is closed", () => {
    const closed = closedBills(lines, bills, new Set(["145"]));
    assert.deepEqual(billsFor({ matchedInvoiceId: "i2" }, bills, closed).map((c) => c.id), ["i1", "i2", "i4"]);
    assert.deepEqual(billsFor({}, bills, closed).map((c) => c.id), ["i1", "i4"]);
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
