// Prepayments on the web side: the review screen's service-period checks and
// the Month-End display helpers. The schedule maths itself is the backend's.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PREPAYMENT_MIN_DAYS, prepaymentError, servicePeriodDays } from "../components/v2/invoices/PrepaymentFields";
import { dateLabel, periodCoveredLabel, rangeLabel } from "../components/v2/monthEnd/format";

describe("service period", () => {
  it("counts days inclusively and refuses backwards or unreadable periods", () => {
    assert.equal(servicePeriodDays("2026-11-13", "2027-11-12"), 365);
    assert.equal(servicePeriodDays("2027-01-01", "2027-01-31"), 31);
    assert.equal(servicePeriodDays("2027-02-01", "2027-01-31"), null);
    assert.equal(servicePeriodDays("2027-02-30", "2027-03-31"), null);
    assert.equal(servicePeriodDays("", "2027-03-31"), null);
  });

  it("uses the backend's threshold: more than 31 days is a prepayment", () => {
    assert.equal(PREPAYMENT_MIN_DAYS, 32);
    assert.ok((servicePeriodDays("2027-01-01", "2027-01-31") ?? 0) < PREPAYMENT_MIN_DAYS);
    assert.ok((servicePeriodDays("2027-01-01", "2027-02-01") ?? 0) >= PREPAYMENT_MIN_DAYS);
  });

  it("only blocks posting when the invoice is a prepayment without a usable period", () => {
    assert.equal(prepaymentError(false, "", ""), "");
    assert.match(prepaymentError(true, "", "2027-01-01"), /start and end/);
    assert.match(prepaymentError(true, "2027-02-01", "2027-01-01"), /ends before/);
    assert.equal(prepaymentError(true, "2026-11-13", "2027-11-12"), "");
    // Same rule as the backend (PERIOD_TOO_SHORT): a month or less isn't a prepayment.
    assert.match(prepaymentError(true, "2027-01-01", "2027-01-31"), /month or less/);
  });
});

describe("month-end labels", () => {
  it("formats dates in UTC so the day never shifts", () => {
    assert.equal(dateLabel("2026-11-13"), "Nov 13, 2026");
    assert.equal(dateLabel(null), "—");
    assert.equal(rangeLabel("2026-11-13", "2027-11-12"), "Nov 13, 2026 – Nov 12, 2027");
  });

  it("names a whole month by its month, a part month by its days", () => {
    assert.equal(periodCoveredLabel("2026-12-01", "2026-12-31", 31), "Dec 2026");
    assert.equal(periodCoveredLabel("2026-11-13", "2026-11-30", 18), "13–30 Nov 2026 (18 days)");
    assert.equal(periodCoveredLabel("2027-11-01", "2027-11-12", 12), "1–12 Nov 2027 (12 days)");
  });
});
