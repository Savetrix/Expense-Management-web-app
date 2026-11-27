// Bank screen tabs and date filter (components/v2/bankTransactions/listView.ts),
// from the 20 Nov call with Saurabh.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dateBounds, inDates, inTab, periodRange, tabOf } from "../components/v2/bankTransactions/listView";

describe("bank screen tabs", () => {
  it("puts a line sent to QuickBooks in Posted, and one that failed or wasn't sent back in To review", () => {
    assert.equal(tabOf({ status: "review" }), "review");
    assert.equal(tabOf({ status: "ready", postingStatus: "posted" }), "posted");
    assert.equal(tabOf({ status: "ready", postingStatus: "processing" }), "posted", "being sent now");
    assert.equal(tabOf({ status: "ready", postingStatus: "failed" }), "review", "a failed post is never in Posted");
    assert.equal(tabOf({ status: "ready" }), "review", "saved as ready while sending is off: still to handle");
  });

  it("keeps matched lines in Matched, and transfers with excluded lines in one tab", () => {
    assert.equal(tabOf({ status: "matched", postingStatus: "posted" }), "matched");
    assert.equal(tabOf({ status: "matched" }), "matched");
    assert.equal(tabOf({ status: "transfer" }), "transfers");
    assert.equal(tabOf({ status: "excluded" }), "transfers");
    assert.equal(inTab({ status: "excluded" }, "all"), true);
    assert.equal(inTab({ status: "ready", postingStatus: "failed" }, "posted"), false);
  });
});

describe("date filter periods, QuickBooks style", () => {
  it("uses full calendar periods before the current one", () => {
    const today = "2026-11-21";
    assert.deepEqual(periodRange("last_month", today), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(periodRange("last_quarter", today), { from: "2026-07-01", to: "2026-09-30" });
    assert.deepEqual(periodRange("last_year", today), { from: "2025-01-01", to: "2025-12-31" });
  });

  it("crosses the year and knows month lengths", () => {
    assert.deepEqual(periodRange("last_month", "2027-01-05"), { from: "2026-12-01", to: "2026-12-31" });
    assert.deepEqual(periodRange("last_quarter", "2027-02-10"), { from: "2026-10-01", to: "2026-12-31" });
    assert.deepEqual(periodRange("last_quarter", "2026-04-01"), { from: "2026-01-01", to: "2026-03-31" });
    assert.deepEqual(periodRange("last_month", "2028-03-15"), { from: "2028-02-01", to: "2028-02-29" }, "leap year");
    assert.deepEqual(periodRange("last_month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  });

  it("Custom uses the person's own dates; All dates filters nothing", () => {
    assert.deepEqual(dateBounds("custom", { from: "2026-11-01", to: "2026-11-15" }, "2026-11-21"), { from: "2026-11-01", to: "2026-11-15" });
    assert.equal(dateBounds("custom", { from: "", to: "" }, "2026-11-21"), null);
    assert.equal(dateBounds("all", { from: "2026-11-01", to: "" }, "2026-11-21"), null);
    const b = dateBounds("last_quarter", { from: "", to: "" }, "2026-11-21");
    assert.equal(inDates("2026-09-30", b), true);
    assert.equal(inDates("2026-10-01", b), false);
    assert.equal(inDates("2026-06-30", b), false);
    assert.equal(inDates("2026-11-05", dateBounds("custom", { from: "2026-11-01", to: "" }, "2026-11-21")), true, "an open end");
  });
});
