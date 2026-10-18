import type { CsvCell } from "./csv";
import { currenciesOf, type MonthRow, type SpendRow } from "./aggregate";

export interface CsvTable {
  headers: string[];
  rows: CsvCell[][];
}

export function spendRowsCsv(firstHeader: string, rows: SpendRow[]): CsvTable {
  return {
    headers: [firstHeader, "Currency", "Bills", "Total", "Average bill"],
    rows: rows.map((r) => [r.label, r.currency, r.count, r.total.toFixed(2), r.average.toFixed(2)]),
  };
}

/** One line per month and currency, so no row ever mixes currencies. */
export function monthRowsCsv(rows: MonthRow[]): CsvTable {
  const out: CsvCell[][] = [];
  for (const row of rows) {
    for (const currency of currenciesOf([row])) {
      const m = row.byCurrency[currency];
      out.push([row.label, currency, m.count, m.total.toFixed(2)]);
    }
  }
  return { headers: ["Month", "Currency", "Bills", "Total"], rows: out };
}

export function taxRowsCsv(rows: MonthRow[]): CsvTable {
  const out: CsvCell[][] = [];
  for (const row of rows) {
    for (const currency of currenciesOf([row])) {
      const m = row.byCurrency[currency];
      out.push([row.label, currency, m.count, m.pretax.toFixed(2), m.tax.toFixed(2), m.total.toFixed(2)]);
    }
  }
  return { headers: ["Month", "Currency", "Bills", "Pre-tax", "Tax", "Total"], rows: out };
}
