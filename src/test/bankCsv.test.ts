// Bank statement CSV parsing used by the Bank Transactions import wizard.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRows, detectColumns, parseAmount, parseCsv, parseDate, splitDuplicates } from "../components/v2/bankTransactions/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n');
    assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"]]);
  });

  it("handles CRLF, a BOM, a missing final newline and blank lines", () => {
    const rows = parseCsv("﻿d,e\r\n1,2\r\n\r\n3,4");
    assert.deepEqual(rows, [["d", "e"], ["1", "2"], ["3", "4"]]);
  });

  it("keeps empty fields", () => {
    assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
  });
});

describe("parseAmount", () => {
  it("strips currency symbols and thousands separators", () => {
    assert.equal(parseAmount("$1,234.50"), 1234.5);
    assert.equal(parseAmount("EUR2000.00"), 2000);
    assert.equal(parseAmount("1.234,56"), 1234.56);
  });

  it("treats parentheses and trailing minus as negative", () => {
    assert.equal(parseAmount("(45.00)"), -45);
    assert.equal(parseAmount("($1,000.10)"), -1000.1);
    assert.equal(parseAmount("12.5-"), -12.5);
    assert.equal(parseAmount("-7"), -7);
  });

  it("rejects non-numbers", () => {
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount("1.2.3"), null);
  });
});

describe("parseDate", () => {
  it("distinguishes DD/MM from MM/DD", () => {
    assert.equal(parseDate("03/04/2024", "MM/DD/YYYY"), "2024-03-04");
    assert.equal(parseDate("03/04/2024", "DD/MM/YYYY"), "2024-04-03");
    assert.equal(parseDate("2024-03-04", "YYYY-MM-DD"), "2024-03-04");
  });

  it("rejects impossible dates and wrong formats", () => {
    assert.equal(parseDate("31/02/2024", "DD/MM/YYYY"), null);
    assert.equal(parseDate("13/01/2024", "MM/DD/YYYY"), null);
    assert.equal(parseDate("2024-03-04", "DD/MM/YYYY"), null);
    assert.equal(parseDate("", "YYYY-MM-DD"), null);
  });
});

describe("buildRows", () => {
  it("detects columns from headers", () => {
    const m = detectColumns(["Date", "Memo", "Debit", "Credit"]);
    assert.deepEqual(m, { date: 0, description: 1, amount: -1, debit: 2, credit: 3 });
  });

  it("reads separate debit/credit columns as money out/in", () => {
    const rows = parseCsv("Date,Memo,Debit,Credit\n2024-01-02,Rent,500.00,\n2024-01-03,Refund,,20\n2024-01-04,Bad,,\n");
    const mapping = detectColumns(rows[0]);
    const { valid, skipped } = buildRows(rows.slice(1), mapping, { dateFormat: "YYYY-MM-DD", outflowMode: "debit" });
    assert.deepEqual(valid.map((r) => r.amount), [-500, 20]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].line, 4);
  });

  it("flips signs when positive numbers are outflows, and skips bad rows with reasons", () => {
    const rows = parseCsv("Date,Description,Amount\n01/02/2024,Coffee,4.50\nnope,X,1\n05/02/2024,Y,abc\n");
    const { valid, skipped } = buildRows(rows.slice(1), detectColumns(rows[0]), { dateFormat: "DD/MM/YYYY", outflowMode: "positive" });
    assert.deepEqual(valid, [{ line: 2, date: "2024-02-01", description: "Coffee", amount: -4.5 }]);
    assert.match(skipped[0].reason, /Date/);
    assert.match(skipped[1].reason, /Amount/);
  });
});

describe("splitDuplicates", () => {
  it("flags rows matching an existing date + amount + description", () => {
    const existing = [{ date: "2024-01-02", amount: -500, description: "Rent" }];
    const rows = [
      { line: 2, date: "2024-01-02", description: "  rent ", amount: -500 },
      { line: 3, date: "2024-01-02", description: "Rent", amount: -501 },
    ];
    const { fresh, duplicates } = splitDuplicates(rows, existing);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].line, 2);
    assert.equal(fresh[0].line, 3);
  });
});
