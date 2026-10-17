// SAMPLE DATA ONLY — the working papers / month-end close API does not exist
// yet. Everything on /close runs on these typed fixtures held in local React
// state; every action that will need the backend is labelled "(BE)" in the UI.
// Replace createWorkingPaper / INITIAL_CLOSED_PERIODS with API calls once the
// endpoints land.

export type SectionKey = "invoices" | "adjustments" | "payablesReceivables" | "fixedAssets" | "balanceSheet";
export type SectionStatus = "todo" | "in_progress" | "done";

export interface SignOff {
  by: string;
  at: string; // ISO timestamp
  justification?: string;
}

export interface PendingDocument {
  id: string;
  type: "invoice" | "claim" | "credit_note";
  number: string;
  contact: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface PendingAdjustment {
  id: string;
  kind: "prepayment" | "deferred_income" | "fixed_asset" | "accrual";
  description: string;
  account: string;
  date: string;
  amount: number;
}

export interface OpenItem {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  amount: number;
}

export interface AgedContact {
  id: string;
  contact: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  flag?: "overdue" | "negative";
  openItems: OpenItem[];
  resolution?: SignOff & { note: string; attachmentName?: string };
}

export interface FixedAssetsCheck {
  costAccount: { code: string; name: string };
  depreciationAccount: { code: string; name: string };
  registerCost: number;
  ledgerCost: number;
  registerDepreciation: number;
  ledgerDepreciation: number;
  reconciled?: SignOff;
}

export interface LineItem {
  id: string;
  description: string;
  amount: number;
}

export interface SupportItem {
  id: string;
  amount: number;
  note: string;
  attachmentName?: string;
}

export interface ChangeLogEntry {
  id: string;
  at: string;
  by: string;
  message: string;
}

export interface BalanceSheetAccount {
  id: string;
  code: string;
  name: string;
  ledgerBalance: number;
  managedBy?: "prepayments" | "accruals" | "fixed_assets";
  dormant?: boolean;
  lineItems: LineItem[];
  supports: SupportItem[];
  reconciled?: SignOff;
  changeLog: ChangeLogEntry[];
}

export interface WorkingPaper {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  createdBy: string;
  touched: Partial<Record<SectionKey, boolean>>;
  documents: PendingDocument[];
  adjustments: PendingAdjustment[];
  payables: AgedContact[];
  receivables: AgedContact[];
  payablesReconciled?: SignOff;
  receivablesReconciled?: SignOff;
  fixedAssets: FixedAssetsCheck;
  accounts: BalanceSheetAccount[];
  /** Mock: the account whose balance "drifts" on the first close attempt. */
  driftAccountId?: string;
  driftChecked: boolean;
  closedBy?: string;
  closedAt?: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "September 2026 close" for a whole calendar month, otherwise a date range. */
export function periodName(start: string, end: string): string {
  const s = parts(start);
  const e = parts(end);
  if (s.y === e.y && s.m === e.m && s.d === 1 && e.d === lastDayOfMonth(e.y, e.m)) {
    return `${MONTHS[s.m - 1]} ${s.y} close`;
  }
  const startLabel = `${s.d} ${SHORT_MONTHS[s.m - 1]}${s.y !== e.y ? ` ${s.y}` : ""}`;
  return `${startLabel} – ${e.d} ${SHORT_MONTHS[e.m - 1]} ${e.y} close`;
}

/** Calendar month before `today`, used as the default period for a new close. */
export function defaultPeriod(today = new Date(), after?: string): { start: string; end: string } {
  let y: number;
  let m: number;
  if (after) {
    const a = parts(after);
    y = a.m === 12 ? a.y + 1 : a.y;
    m = a.m === 12 ? 1 : a.m + 1;
  } else {
    y = today.getFullYear();
    m = today.getMonth(); // previous month, 1-based
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}` };
}

/** Shifts a YYYY-MM-DD date by `days` (negative = earlier). */
const shift = (iso: string, days: number) => {
  const { y, m, d } = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function createWorkingPaper(periodStart: string, periodEnd: string, createdBy: string): WorkingPaper {
  const e = periodEnd;
  const now = new Date().toISOString();
  const priorLog = (message: string): ChangeLogEntry[] => [
    { id: newId("log"), at: now, by: "System", message },
  ];

  return {
    id: newId("wp"),
    name: periodName(periodStart, periodEnd),
    periodStart,
    periodEnd,
    createdAt: now,
    createdBy,
    touched: {},
    driftChecked: false,
    driftAccountId: "acc_bank",
    documents: [
      { id: "doc1", type: "invoice", number: "INV-20418", contact: "Northwind Office Supplies", date: shift(e, -12), amount: 842.5 },
      { id: "doc2", type: "invoice", number: "4471-B", contact: "Cloudline Hosting", date: shift(e, -3), amount: 1290 },
      { id: "doc3", type: "claim", number: "EXP-0192", contact: "Priya Raman", date: shift(e, -6), amount: 186.4 },
      { id: "doc4", type: "credit_note", number: "CN-0087", contact: "Harbor Freight Logistics", date: shift(e, -1), amount: -215 },
    ],
    adjustments: [
      { id: "adj1", kind: "prepayment", description: "Annual software licence — monthly release", account: "Prepayments", date: e, amount: 450 },
      { id: "adj2", kind: "deferred_income", description: "Retainer income recognised", account: "Deferred income", date: e, amount: 1200 },
      { id: "adj3", kind: "fixed_asset", description: "Depreciation — office equipment", account: "Accumulated depreciation", date: e, amount: 312.75 },
      { id: "adj4", kind: "accrual", description: "Accrued utilities (bill not yet received)", account: "Accruals", date: e, amount: 640 },
    ],
    payables: [
      {
        id: "p1", contact: "Northwind Office Supplies", current: 842.5, d30: 0, d60: 0, d90: 0,
        openItems: [{ id: "pi1", number: "INV-20418", date: shift(e, -12), dueDate: shift(e, 18), amount: 842.5 }],
      },
      {
        id: "p2", contact: "Metro Print Co.", current: 0, d30: 0, d60: 0, d90: 1375, flag: "overdue",
        openItems: [
          { id: "pi2", number: "MP-3302", date: shift(e, -130), dueDate: shift(e, -100), amount: 980 },
          { id: "pi3", number: "MP-3341", date: shift(e, -115), dueDate: shift(e, -95), amount: 395 },
        ],
      },
      {
        id: "p3", contact: "Cloudline Hosting", current: 1290, d30: 1290, d60: 0, d90: 0,
        openItems: [
          { id: "pi4", number: "4471-B", date: shift(e, -3), dueDate: shift(e, 27), amount: 1290 },
          { id: "pi5", number: "4402-B", date: shift(e, -33), dueDate: shift(e, -3), amount: 1290 },
        ],
      },
      {
        id: "p4", contact: "Harbor Freight Logistics", current: -215, d30: 0, d60: 0, d90: 0, flag: "negative",
        openItems: [{ id: "pi6", number: "CN-0087", date: shift(e, -1), dueDate: shift(e, -1), amount: -215 }],
      },
    ],
    receivables: [
      {
        id: "r1", contact: "Brightside Dental Group", current: 4200, d30: 0, d60: 0, d90: 0,
        openItems: [{ id: "ri1", number: "S-1104", date: shift(e, -8), dueDate: shift(e, 22), amount: 4200 }],
      },
      {
        id: "r2", contact: "Oakridge Property Mgmt", current: 0, d30: 1800, d60: 950, d90: 0,
        openItems: [
          { id: "ri2", number: "S-1071", date: shift(e, -40), dueDate: shift(e, -10), amount: 1800 },
          { id: "ri3", number: "S-1049", date: shift(e, -70), dueDate: shift(e, -40), amount: 950 },
        ],
      },
      {
        id: "r3", contact: "Lumen Studio", current: 0, d30: 0, d60: 0, d90: 2600, flag: "overdue",
        openItems: [{ id: "ri4", number: "S-0988", date: shift(e, -140), dueDate: shift(e, -110), amount: 2600 }],
      },
    ],
    fixedAssets: {
      costAccount: { code: "710", name: "Office equipment" },
      depreciationAccount: { code: "711", name: "Accumulated depreciation — office equipment" },
      registerCost: 48250,
      ledgerCost: 49850,
      registerDepreciation: 18420.5,
      ledgerDepreciation: 18420.5,
    },
    accounts: [
      { id: "acc_bank", code: "090", name: "Business current account", ledgerBalance: 38214.62, lineItems: [{ id: "li1", description: "Bank statement closing balance", amount: 38214.62 }], supports: [], changeLog: priorLog("Line items carried forward from previous period") },
      { id: "acc_savings", code: "091", name: "Business savings account", ledgerBalance: 25000, lineItems: [], supports: [], changeLog: [] },
      { id: "acc_ar", code: "610", name: "Accounts receivable", ledgerBalance: 9550, lineItems: [{ id: "li2", description: "Aged receivables total", amount: 9550 }], supports: [], changeLog: priorLog("Line items carried forward from previous period") },
      { id: "acc_prepay", code: "620", name: "Prepayments", ledgerBalance: 4950, managedBy: "prepayments", lineItems: [], supports: [], changeLog: [] },
      { id: "acc_fa", code: "710", name: "Office equipment", ledgerBalance: 49850, managedBy: "fixed_assets", lineItems: [], supports: [], changeLog: [] },
      { id: "acc_ap", code: "800", name: "Accounts payable", ledgerBalance: -4582.5, lineItems: [{ id: "li3", description: "Aged payables total", amount: -4582.5 }], supports: [], changeLog: priorLog("Line items carried forward from previous period") },
      { id: "acc_accruals", code: "825", name: "Accruals", ledgerBalance: -3140, managedBy: "accruals", lineItems: [], supports: [], changeLog: [] },
      { id: "acc_tax", code: "820", name: "Sales tax payable", ledgerBalance: -2318.4, lineItems: [], supports: [], changeLog: [] },
      { id: "acc_loan", code: "900", name: "Director's loan account", ledgerBalance: -12000, lineItems: [{ id: "li4", description: "Loan agreement balance", amount: -12000 }], supports: [], changeLog: priorLog("Line items carried forward from previous period") },
      { id: "acc_petty", code: "093", name: "Petty cash", ledgerBalance: 0, dormant: true, lineItems: [], supports: [], changeLog: [] },
      { id: "acc_deposit", code: "630", name: "Rent deposit", ledgerBalance: 3000, dormant: true, lineItems: [{ id: "li5", description: "Lease deposit held by landlord", amount: 3000 }], supports: [], changeLog: [] },
    ],
  };
}

/** One closed period seeded so the Closed periods tab has history to view. */
function seedClosedPeriod(): WorkingPaper {
  const paper = createWorkingPaper("2026-08-01", "2026-08-31", "Priya Raman");
  const closedAt = "2026-09-08T16:20:00.000Z";
  const signOff = { by: "Priya Raman", at: closedAt };
  return {
    ...paper,
    id: "wp_seed_aug_2026",
    createdAt: "2026-09-02T09:00:00.000Z",
    documents: [],
    adjustments: [],
    payables: paper.payables.map((c) => (c.flag ? { ...c, resolution: { ...signOff, note: "Confirmed with vendor; paid in September." } } : c)),
    receivables: paper.receivables.map((c) => (c.flag ? { ...c, resolution: { ...signOff, note: "Payment plan agreed with customer." } } : c)),
    payablesReconciled: signOff,
    receivablesReconciled: signOff,
    fixedAssets: { ...paper.fixedAssets, ledgerCost: paper.fixedAssets.registerCost, reconciled: signOff },
    accounts: paper.accounts.map((a) => ({
      ...a,
      reconciled: signOff,
      changeLog: [...a.changeLog, { id: `log_${a.id}_seed`, at: closedAt, by: "Priya Raman", message: "Reconciled" }],
    })),
    driftChecked: true,
    driftAccountId: undefined,
    closedBy: "Priya Raman",
    closedAt,
  };
}

export const INITIAL_CLOSED_PERIODS: WorkingPaper[] = [seedClosedPeriod()];
