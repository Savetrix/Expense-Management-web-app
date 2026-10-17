// Sample data until the supplier-statement API exists. Everything on the
// /supplier-statements page runs on this in local React state; replace the
// seed with a fetch once the backend endpoints are live.

export type StatementStatus = "processing" | "needs_matching" | "reconciled";

/** The four facts compared between a statement line and a bill. */
export type MatchField = "vendor" | "date" | "amount" | "reference";

/**
 * matched   — all four facts agree (or the user accepted / picked a match)
 * partial   — three of four agree; `differingField` says which one doesn't
 * unmatched — no bill found
 * missing   — the user confirmed there's no bill yet (invoice to be requested)
 */
export type LineMatchResult = "matched" | "partial" | "unmatched" | "missing";

export interface CandidateBill {
  id: string;
  number: string;
  vendor: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface StatementLine {
  id: string;
  date: string; // YYYY-MM-DD
  reference: string;
  amount: number;
  result: LineMatchResult;
  billId?: string;
  differingField?: MatchField;
  /** How a matched line got matched — shown as a small hint in the table. */
  matchedBy?: "auto" | "accepted" | "manual";
}

export interface SupplierStatement {
  id: string;
  vendor: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  /** Closing balance printed on the statement. */
  balance: number;
  status: StatementStatus;
  source: "Upload" | "Email";
  fileName: string;
  lines: StatementLine[];
}

export const MOCK_VENDORS = [
  "Office Depot",
  "Northwind Traders",
  "Acme Packaging",
  "Bluewave Telecom",
  "Greenleaf Cleaning",
  "Summit Logistics",
];

export const MOCK_BILLS: CandidateBill[] = [
  { id: "b-1001", number: "INV-1042", vendor: "Office Depot", date: "2026-09-03", amount: 412.5 },
  { id: "b-1002", number: "INV-1057", vendor: "Office Depot", date: "2026-09-11", amount: 1204.0 },
  { id: "b-1003", number: "INV-1063", vendor: "Office Depot", date: "2026-09-19", amount: 86.4 },
  { id: "b-1004", number: "INV-1071", vendor: "Office Depot", date: "2026-09-26", amount: 640.0 },
  { id: "b-1005", number: "INV-1078", vendor: "Office Depot", date: "2026-09-29", amount: 233.1 },
  { id: "b-2001", number: "NW-5530", vendor: "Northwind Traders", date: "2026-09-02", amount: 2890.0 },
  { id: "b-2002", number: "NW-5544", vendor: "Northwind Traders", date: "2026-09-16", amount: 1450.75 },
  { id: "b-2003", number: "NW-5561", vendor: "Northwind Traders", date: "2026-09-28", amount: 975.2 },
  { id: "b-3001", number: "AP-88120", vendor: "Acme Packaging", date: "2026-08-07", amount: 560.0 },
  { id: "b-3002", number: "AP-88164", vendor: "Acme Packaging", date: "2026-08-21", amount: 1320.0 },
  { id: "b-4001", number: "BT-20260901", vendor: "Bluewave Telecom", date: "2026-09-01", amount: 189.99 },
  { id: "b-5001", number: "GC-3310", vendor: "Greenleaf Cleaning", date: "2026-09-30", amount: 720.0 },
];

export const MOCK_STATEMENTS: SupplierStatement[] = [
  {
    id: "st-101",
    vendor: "Office Depot",
    statementDate: "2026-10-01",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    currency: "CAD",
    balance: 2776.0,
    status: "needs_matching",
    source: "Email",
    fileName: "OfficeDepot_Statement_Sep2026.pdf",
    lines: [
      { id: "l-1", date: "2026-09-03", reference: "INV-1042", amount: 412.5, result: "matched", billId: "b-1001", matchedBy: "auto" },
      { id: "l-2", date: "2026-09-11", reference: "INV-1057", amount: 1240.0, result: "partial", billId: "b-1002", differingField: "amount" },
      { id: "l-3", date: "2026-09-20", reference: "INV-1063", amount: 86.4, result: "partial", billId: "b-1003", differingField: "date" },
      { id: "l-4", date: "2026-09-26", reference: "INV-1071", amount: 640.0, result: "matched", billId: "b-1004", matchedBy: "auto" },
      { id: "l-5", date: "2026-09-27", reference: "INV-1075", amount: 164.0, result: "unmatched" },
      { id: "l-6", date: "2026-09-29", reference: "1078", amount: 233.1, result: "partial", billId: "b-1005", differingField: "reference" },
    ],
  },
  {
    id: "st-102",
    vendor: "Northwind Traders",
    statementDate: "2026-10-03",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    currency: "CAD",
    balance: 6315.95,
    status: "needs_matching",
    source: "Upload",
    fileName: "northwind-sept.pdf",
    lines: [
      { id: "l-1", date: "2026-09-02", reference: "NW-5530", amount: 2890.0, result: "matched", billId: "b-2001", matchedBy: "auto" },
      { id: "l-2", date: "2026-09-16", reference: "NW-5544", amount: 1450.75, result: "matched", billId: "b-2002", matchedBy: "auto" },
      { id: "l-3", date: "2026-09-22", reference: "NW-5552", amount: 1000.0, result: "unmatched" },
      { id: "l-4", date: "2026-09-28", reference: "NW-5561", amount: 975.2, result: "matched", billId: "b-2003", matchedBy: "auto" },
    ],
  },
  {
    id: "st-103",
    vendor: "Acme Packaging",
    statementDate: "2026-09-01",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    currency: "CAD",
    balance: 1880.0,
    status: "reconciled",
    source: "Email",
    fileName: "Acme_Aug_Statement.pdf",
    lines: [
      { id: "l-1", date: "2026-08-07", reference: "AP-88120", amount: 560.0, result: "matched", billId: "b-3001", matchedBy: "auto" },
      { id: "l-2", date: "2026-08-21", reference: "AP-88164", amount: 1320.0, result: "matched", billId: "b-3002", matchedBy: "accepted" },
    ],
  },
  {
    id: "st-104",
    vendor: "Bluewave Telecom",
    statementDate: "2026-10-15",
    periodStart: "2026-09-15",
    periodEnd: "2026-10-14",
    currency: "CAD",
    balance: 189.99,
    status: "processing",
    source: "Email",
    fileName: "bluewave_statement_oct.pdf",
    lines: [],
  },
];

/** Lines the mock "processing" step produces for a freshly uploaded statement. */
export function mockExtractedLines(vendor: string): StatementLine[] {
  const bills = MOCK_BILLS.filter((b) => b.vendor === vendor);
  if (bills.length === 0) {
    return [
      { id: "l-1", date: "2026-09-08", reference: "S-2201", amount: 318.0, result: "unmatched" },
      { id: "l-2", date: "2026-09-21", reference: "S-2218", amount: 545.25, result: "unmatched" },
    ];
  }
  const lines = bills.map((bill, i): StatementLine => {
    if (i === 1) {
      return { id: `l-${i + 1}`, date: bill.date, reference: bill.number, amount: bill.amount + 10, result: "partial", billId: bill.id, differingField: "amount" };
    }
    return { id: `l-${i + 1}`, date: bill.date, reference: bill.number, amount: bill.amount, result: "matched", billId: bill.id, matchedBy: "auto" };
  });
  lines.push({ id: `l-${bills.length + 1}`, date: "2026-09-30", reference: "ADJ-01", amount: 42.0, result: "unmatched" });
  return lines;
}
