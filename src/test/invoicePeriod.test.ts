// Reading the period an invoice covers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findPeriod, isPrepaymentPeriod, monthsBetween } from "../lib/bankFeeds/period";

describe("invoice period", () => {
  it("counts months inclusively", () => {
    assert.equal(monthsBetween("2026-09-01", "2027-08-31"), 12);
    assert.equal(monthsBetween("2026-09-01", "2026-09-30"), 1);
    assert.equal(monthsBetween("2026-01-01", "2026-03-31"), 3);
  });

  it("reads the Atlassian example (day-first dates that only make sense one way)", () => {
    const p = findPeriod(["Jira and Confluence Premium (Cloud), annual subscription, up to 15 users. Service period: 01/09/2026 - 31/08/2027"]);
    assert.deepEqual(p && [p.start, p.end, p.months, p.source], ["2026-09-01", "2027-08-31", 12, "range"]);
    assert.ok(isPrepaymentPeriod(p));
  });

  it("reads written-out and US-style dates", () => {
    const a = findPeriod(["Billing period Sep 1, 2026 to Aug 31, 2027"]);
    assert.deepEqual(a && [a.start, a.end], ["2026-09-01", "2027-08-31"]);
    const b = findPeriod(["Coverage: 1 Jan 2027 – 31 Dec 2027"]);
    assert.deepEqual(b && [b.start, b.end, b.months], ["2027-01-01", "2027-12-31", 12]);
    const c = findPeriod(["Service period 2026-10-01 through 2027-03-31"]);
    assert.deepEqual(c && [c.months], [6]);
    const d = findPeriod(["Term 10/01/2026 - 09/30/2027"], { preferMonthFirst: true });
    assert.deepEqual(d && [d.start, d.end], ["2026-10-01", "2027-09-30"]);
  });

  it("does not call a monthly plan a prepayment", () => {
    const p = findPeriod(["Service period: 01/10/2026 - 31/10/2026"]);
    assert.equal(p?.months, 1);
    assert.equal(isPrepaymentPeriod(p), false);
  });

  it("falls back to a stated term from the invoice date when no dates are written", () => {
    const p = findPeriod(["Microsoft 365 Business Standard — annual subscription"], { invoiceDate: "2026-09-15" });
    assert.deepEqual(p && [p.start, p.end, p.months, p.source], ["2026-09-15", "2027-09-14", 12, "duration"]);
  });

  it("ignores lone dates and ordinary invoices", () => {
    assert.equal(findPeriod(["Invoice date 01/09/2026", "Due 15/09/2026", "Printer paper x 10"]), null);
    assert.equal(findPeriod(["Office chairs, 12 units"], { invoiceDate: "2026-09-15" }), null);
    assert.equal(findPeriod([null, undefined, ""]), null);
  });
});
