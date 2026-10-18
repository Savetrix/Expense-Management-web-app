// Pure aggregation + CSV for the Reports page.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customRange,
  filterInvoices,
  groupByGlAccount,
  groupByMonth,
  groupByVendor,
  parseDay,
  presetRange,
  totalsByCurrency,
} from "../components/v2/reports/aggregate";
import { escapeCsvCell, toCsv } from "../components/v2/reports/csv";
import type { InvoiceRecord } from "../store/invoice/invoiceSlice";

function inv(id: string, data: InvoiceRecord["extractedData"], extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return { _id: id, postedStatus: "pending", extractedData: data, ...extra };
}

describe("parseDay", () => {
  it("parses a day-only date as local midnight", () => {
    const d = parseDay("2025-03-01")!;
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 0);
  });
  it("returns null for junk", () => {
    assert.equal(parseDay("nope"), null);
    assert.equal(parseDay(undefined), null);
  });
});

describe("currency separation", () => {
  it("never mixes currencies in vendor rows", () => {
    const rows = groupByVendor([
      inv("1", { vendorName: "Acme", currency: "CAD", totalAmount: 100 }),
      inv("2", { vendorName: "acme", currency: "USD", totalAmount: 50 }),
      inv("3", { vendorName: "Acme", currency: "CAD", totalAmount: 20.1 }),
    ]);
    assert.equal(rows.length, 2);
    const cad = rows.find((r) => r.currency === "CAD")!;
    assert.equal(cad.total, 120.1);
    assert.equal(cad.count, 2);
    assert.equal(cad.average, 60.05);
    assert.equal(rows.find((r) => r.currency === "USD")!.total, 50);
  });

  it("sorts by total desc with share relative to the largest in the currency", () => {
    const rows = groupByVendor([
      inv("1", { vendorName: "A", currency: "CAD", totalAmount: 50 }),
      inv("2", { vendorName: "B", currency: "CAD", totalAmount: 200 }),
    ]);
    assert.deepEqual(rows.map((r) => r.label), ["B", "A"]);
    assert.equal(rows[0].share, 100);
    assert.equal(rows[1].share, 25);
  });
});

describe("groupByMonth", () => {
  it("buckets by invoiceDate, falls back to createdAt, per currency", () => {
    const rows = groupByMonth([
      inv("1", { invoiceDate: "2025-01-31", currency: "CAD", totalAmount: 10, taxAmount: 1, amountBeforeTax: 9 }),
      inv("2", { invoiceDate: "2025-02-01", currency: "CAD", totalAmount: 20 }),
      inv("3", { currency: "USD", totalAmount: 5 }, { createdAt: "2025-02-10T12:00:00" }),
      inv("4", { currency: "CAD", totalAmount: 7 }),
    ]);
    assert.deepEqual(rows.map((r) => r.key), ["2025-01", "2025-02", "undated"]);
    assert.equal(rows[0].byCurrency.CAD.tax, 1);
    assert.equal(rows[1].byCurrency.CAD.total, 20);
    assert.equal(rows[1].byCurrency.USD.total, 5);
    assert.deepEqual(totalsByCurrency(rows, "total"), { CAD: 37, USD: 5 });
  });
});

describe("filterInvoices", () => {
  const list = [
    inv("a", { invoiceDate: "2025-03-01", totalAmount: 1 }, { postedStatus: "auto" }),
    inv("b", { invoiceDate: "2025-03-31", totalAmount: 1 }, { postedStatus: "pending" }),
    inv("c", { invoiceDate: "2025-04-01", totalAmount: 1 }, { postedStatus: "manual" }),
    inv("d", { totalAmount: 1 }),
  ];
  it("keeps both ends of a custom range inclusive", () => {
    const out = filterInvoices(list, { range: customRange("2025-03-01", "2025-03-31"), postedOnly: false });
    assert.deepEqual(out.map((i) => i._id), ["a", "b"]);
  });
  it("posted only keeps auto and manual", () => {
    const out = filterInvoices(list, { range: presetRange("all"), postedOnly: true });
    assert.deepEqual(out.map((i) => i._id), ["a", "c"]);
  });
  it("preset ranges bound by calendar month", () => {
    const r = presetRange("last_month", new Date(2025, 0, 15));
    assert.equal(r.from!.getFullYear(), 2024);
    assert.equal(r.from!.getMonth(), 11);
    assert.equal(r.to!.getDate(), 31);
  });
});

describe("groupByGlAccount", () => {
  const names = { gl1: "Office", gl2: "Travel" };
  it("groups unresolved and missing ids as Uncoded", () => {
    const rows = groupByGlAccount(
      [
        inv("1", { currency: "CAD", totalAmount: 10, glAccountId: "gl1" }),
        inv("2", { currency: "CAD", totalAmount: 5, glAccountId: "gone" }),
        inv("3", { currency: "CAD", totalAmount: 7 }),
      ],
      names,
    );
    assert.deepEqual(rows.map((r) => [r.label, r.total]), [["Uncoded", 12], ["Office", 10]]);
    assert.equal(rows[0].count, 2);
  });
  it("uses line amounts when lines carry glAccountId", () => {
    const rows = groupByGlAccount(
      [
        inv("1", {
          currency: "CAD",
          totalAmount: 100,
          glAccountId: "gl1",
          lineItems: [
            { description: "a", quantity: 1, unitPrice: 30, amount: 30, glAccountId: "gl2" },
            { description: "b", quantity: 1, unitPrice: 60, amount: 60 },
          ],
        }),
      ],
      names,
    );
    assert.deepEqual(rows.map((r) => [r.label, r.total]), [["Office", 60], ["Travel", 30]]);
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    assert.equal(escapeCsvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(escapeCsvCell("a\nb"), '"a\nb"');
    assert.equal(escapeCsvCell(null), "");
    assert.equal(escapeCsvCell(12.5), "12.5");
  });
  it("neutralises formula-looking text and joins with CRLF, no BOM", () => {
    assert.equal(escapeCsvCell("=SUM(A1)"), "'=SUM(A1)");
    const out = toCsv(["a", "b"], [["x", 1]]);
    assert.equal(out, "a,b\r\nx,1");
    assert.notEqual(out.charCodeAt(0), 0xfeff);
  });
});
