// The period an invoice covers ("Service period 01/09/2026 – 31/08/2027"), read
// from the text the backend already keeps for every invoice: the line
// descriptions, the description and the OCR text. The backend's extraction
// prompt has no period field, so nothing new is asked of it.
//
// A period longer than a month (a yearly software plan, an insurance term) is
// a prepayment candidate: the invoice shows "Prepayment detected". Building the
// schedule and the monthly entries is a later step.
//
// Pure functions, no I/O: tested in src/test/invoicePeriod.test.ts.

export interface InvoicePeriod {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  /** Length in months, one decimal (Sep 1 – Aug 31 = 12). */
  months: number;
  /** The words the period was read from, for the user to check. */
  evidence: string;
  source: "range" | "duration";
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? iso(y, m, d) : null;
}

/** Months from start to end inclusive: whole calendar months plus the remaining days. */
export function monthsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(Date.parse(`${end}T00:00:00Z`) + DAY_MS); // exclusive end
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  const anchor = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, s.getUTCDate()));
  if (anchor > e) {
    months -= 1;
  }
  const from = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, s.getUTCDate()));
  const rest = (e.getTime() - from.getTime()) / DAY_MS;
  return Math.round((months + rest / 30.4375) * 10) / 10;
}

// One date, in any of the shapes invoices use. Captures are interpreted below.
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE = [
  `(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})`, // 2026-09-01
  `(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})`, // 01/09/2026 or 09/01/2026
  `(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MON}\\.?,?[\\s-]+(\\d{2,4})`, // 1 Sep 2026, 01-Sep-2026
  `${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, // Sep 1, 2026
].join("|");
const SEP = /^\s*(?:-|–|—|to|through|thru|until|till)\s*$/i;
const DATE_ANY = new RegExp(DATE, "gi");
const ONE_DATE = new RegExp(`^(?:${DATE})$`, "i");

type Reading = string[]; // candidate ISO dates for one written date

function readDate(text: string, preferMonthFirst: boolean): Reading {
  const m = ONE_DATE.exec(text.trim());
  if (!m) return [];
  const g = m.slice(1);
  if (g[0]) return [validDate(+g[0], +g[1], +g[2])].filter(Boolean) as string[];
  if (g[3]) {
    const a = +g[3];
    const b = +g[4];
    const y = +g[5];
    const dmy = validDate(y, b, a);
    const mdy = validDate(y, a, b);
    const both = [dmy, mdy].filter(Boolean) as string[];
    if (both.length === 2 && dmy !== mdy) return preferMonthFirst ? [mdy as string, dmy as string] : [dmy as string, mdy as string];
    return [...new Set(both)];
  }
  if (g[6]) return [validDate(+g[8], MONTHS[g[7].toLowerCase().replace(/\.$/, "")] ?? 0, +g[6])].filter(Boolean) as string[];
  if (g[9]) return [validDate(+g[11], MONTHS[g[9].toLowerCase()] ?? 0, +g[10])].filter(Boolean) as string[];
  return [];
}

/** How close a span is to whole months, plus the order preference. Lower is better. */
function spanScore(start: string, end: string): number {
  const months = monthsBetween(start, end);
  return Math.abs(months - Math.round(months));
}

const KEYWORD = /(service|billing|subscription|coverage|contract|licen[cs]e|policy|membership|period|term|from|valid)/i;

/**
 * The period an invoice covers, or null. `preferMonthFirst` breaks ties for a
 * numeric date like 03/04/2026 (true for US companies); a range that only makes
 * sense one way (01/09/2026 – 31/08/2027) is read that way regardless.
 */
export function findPeriod(texts: (string | null | undefined)[], options: { preferMonthFirst?: boolean; invoiceDate?: string | null } = {}): InvoicePeriod | null {
  const preferMonthFirst = options.preferMonthFirst ?? false;
  let best: { p: InvoicePeriod; score: number } | null = null;

  for (const raw of texts) {
    if (!raw) continue;
    const text = raw.replace(/\s+/g, " ");
    const dates = [...text.matchAll(DATE_ANY)].map((m) => ({ text: m[0], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
    for (let i = 0; i + 1 < dates.length; i += 1) {
      const left = dates[i];
      const right = dates[i + 1];
      // Two dates joined only by "–", "to", "through"… are a range.
      if (!SEP.test(text.slice(left.end, right.at))) continue;
      const starts = readDate(left.text, preferMonthFirst);
      const ends = readDate(right.text, preferMonthFirst);
      const context = text.slice(Math.max(0, left.at - 40), right.end);
      for (const [si, s] of starts.entries()) {
        for (const [ei, e] of ends.entries()) {
          if (e <= s) continue;
          const months = monthsBetween(s, e);
          if (months > 60) continue;
          const score = spanScore(s, e) + (si + ei) * 0.01 + (KEYWORD.test(context) ? 0 : 0.5);
          if (!best || score < best.score) {
            best = { p: { start: s, end: e, months, evidence: context.trim().slice(-120), source: "range" }, score };
          }
        }
      }
    }
  }
  if (best) return best.p;

  // No dates: a stated term ("annual subscription", "12-month plan") from the invoice date.
  if (options.invoiceDate && /^\d{4}-\d{2}-\d{2}/.test(options.invoiceDate)) {
    for (const raw of texts) {
      if (!raw) continue;
      const t = raw.replace(/\s+/g, " ");
      const annual = /\b(annual(?:ly)?|yearly|per year|12[\s-]?months?|1[\s-]?year|one[\s-]year)\b/i.exec(t);
      const nMonths = annual ? 12 : Number(/\b(3|6|18|24|36)[\s-]?months?\b/i.exec(t)?.[1] ?? 0);
      if (nMonths > 1 && /(subscription|plan|licen[cs]e|membership|policy|premium|term|renewal|service)/i.test(t)) {
        const start = options.invoiceDate.slice(0, 10);
        const s = new Date(`${start}T00:00:00Z`);
        const endDate = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + nMonths, s.getUTCDate()) - DAY_MS);
        const end = endDate.toISOString().slice(0, 10);
        const idx = (annual ?? /\d+[\s-]?months?/i.exec(t))?.index ?? 0;
        return { start, end, months: nMonths, evidence: t.slice(Math.max(0, idx - 40), idx + 40).trim(), source: "duration" };
      }
    }
  }
  return null;
}

/** "Longer than a month": more than 31 days. A monthly plan (Sep 1 – Sep 30) is not a prepayment. */
export function isPrepaymentPeriod(p: InvoicePeriod | null): boolean {
  if (!p) return false;
  const days = (Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / DAY_MS + 1;
  return days > 31;
}
