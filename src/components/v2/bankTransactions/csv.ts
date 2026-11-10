import type { BankTransaction, ColumnMapping, DateFormat, OutflowMode, ParsedRow, SkippedRow } from "./types";

/** RFC 4180-style parser: quoted fields, "" escapes, CRLF/LF/CR, embedded newlines. Blank rows are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Parses "$1,234.50", "(45.00)", "-12", "12-", "1.234,56" into a number, or null if not numeric. */
export function parseAmount(raw: string): number | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,+-]/g, "");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  if ((s.match(/\./g) ?? []).length > 1) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Returns an ISO YYYY-MM-DD string, or null if the text is not a real calendar date in that format. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const s = (raw ?? "").trim().replace(/[T ]\d{1,2}:\d{2}.*$/, "");
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(s);
  if (!m) return null;
  let y: number;
  let mo: number;
  let d: number;
  if (format === "YYYY-MM-DD") {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if (format === "MM/DD/YYYY") {
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (format !== "YYYY-MM-DD" && m[3].length === 2) y += 2000;
  if (y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/** Guesses which column holds what from header names. */
export function detectColumns(headers: string[]): ColumnMapping {
  const find = (names: string[], exact = false) =>
    headers.findIndex((h) => names.some((n) => (exact ? norm(h) === n : norm(h).includes(n))));
  const date = (() => {
    const i = find(["date", "posted", "transactiondate"]);
    return i;
  })();
  const description = find(["description", "memo", "payee", "details", "narrative", "name", "reference"]);
  const debit = find(["debit", "withdrawal", "moneyout", "paidout"]);
  const credit = find(["credit", "deposit", "moneyin", "paidin"]);
  const amount = find(["amount", "value"], false);
  return { date, description, amount: amount === debit || amount === credit ? -1 : amount, debit, credit };
}

export interface BuildOptions {
  dateFormat: DateFormat;
  outflowMode: OutflowMode;
}

/** Turns data rows (header excluded; row 0 = file line 2) into transactions plus the rows that had to be skipped. */
export function buildRows(
  dataRows: string[][],
  mapping: ColumnMapping,
  { dateFormat, outflowMode }: BuildOptions,
): { valid: ParsedRow[]; skipped: SkippedRow[] } {
  const valid: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");

  dataRows.forEach((row, i) => {
    const line = i + 2;
    const date = parseDate(cell(row, mapping.date), dateFormat);
    if (!date) {
      skipped.push({ line, reason: "Date is missing or not in the chosen format" });
      return;
    }
    let amount: number | null;
    if (outflowMode === "debit") {
      const debitRaw = cell(row, mapping.debit);
      const creditRaw = cell(row, mapping.credit);
      const debit = debitRaw ? parseAmount(debitRaw) : 0;
      const credit = creditRaw ? parseAmount(creditRaw) : 0;
      amount = debit === null || credit === null || (!debitRaw && !creditRaw) ? null : credit - debit;
      if (amount !== null && debit !== null && debit !== 0 && credit === 0) amount = -Math.abs(debit);
      else if (amount !== null && credit !== null && credit !== 0 && debit === 0) amount = Math.abs(credit);
    } else {
      const parsed = parseAmount(cell(row, mapping.amount));
      amount = parsed === null ? null : outflowMode === "positive" ? -parsed : parsed;
    }
    if (amount === null) {
      skipped.push({ line, reason: "Amount is missing or not a number" });
      return;
    }
    valid.push({ line, date, description: cell(row, mapping.description), amount: Math.round(amount * 100) / 100 });
  });
  return { valid, skipped };
}

export function dedupeKey(t: { date: string; amount: number; description: string }): string {
  return `${t.date}|${t.amount.toFixed(2)}|${t.description.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** Splits parsed rows into new ones and ones already present (same date + amount + description). */
export function splitDuplicates(
  rows: ParsedRow[],
  existing: Pick<BankTransaction, "date" | "amount" | "description">[],
): { fresh: ParsedRow[]; duplicates: ParsedRow[] } {
  const seen = new Set(existing.map(dedupeKey));
  const fresh: ParsedRow[] = [];
  const duplicates: ParsedRow[] = [];
  for (const r of rows) (seen.has(dedupeKey(r)) ? duplicates : fresh).push(r);
  return { fresh, duplicates };
}
