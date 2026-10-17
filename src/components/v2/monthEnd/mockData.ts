// SAMPLE DATA ONLY — the month-end adjustments API does not exist yet. The
// page seeds its local state from these fixtures so every flow can be
// clicked through end to end; replace with API calls once the backend lands.

import type { Accrual, AccrualReversal, AdjustmentType, AmortisationItem, AmortisationKind, DetectionSettings, FixedAsset } from "./types";

export const ACCOUNTS = {
  prepayment: ["1400 Prepayments", "1410 Prepaid insurance", "1420 Prepaid software"],
  expense: ["6100 Rent", "6200 Insurance", "6300 Software subscriptions", "6400 Marketing", "6500 Utilities", "6600 Professional fees"],
  deferred: ["2400 Deferred income", "2410 Customer deposits"],
  income: ["4000 Sales", "4100 Subscription revenue", "4200 Service revenue"],
  asset: ["1600 Computer equipment", "1610 Office furniture", "1620 Vehicles", "1630 Land"],
  accumulated: ["1601 Acc. depreciation – computer equipment", "1611 Acc. depreciation – office furniture", "1621 Acc. depreciation – vehicles"],
  depreciationExpense: ["6800 Depreciation expense"],
  accrualLiability: ["2300 Accrued liabilities", "2310 Accrued payroll"],
  proceeds: ["1000 Operating bank account", "1100 Accounts receivable", "1050 Savings account"],
  gainLoss: ["7900 Gain/loss on disposal of assets", "7910 Other income"],
} as const;

export const TRACKING_OPTIONS = ["None", "Head office", "Retail", "Online", "Warehouse"];

export const DEFAULT_SETTINGS: DetectionSettings = {
  threshold: 250,
  proration: "monthly",
  enabled: { prepayments: true, deferred: true, fixedAssets: true, accruals: true },
};

/** Simulated difference between the tracker and the ledger balance, per type. */
export const LEDGER_OFFSETS: Record<AdjustmentType, number> = {
  prepayments: 0,
  deferred: 150,
  fixedAssets: 0,
  accruals: -42.5,
};

export const MOCK_PREPAYMENTS: AmortisationItem[] = [
  {
    id: "pp-1", kind: "prepayment", description: "Annual office insurance", party: "Northgate Insurance", sourceRef: "BILL-2291",
    total: 4800, openingBalance: 4800, startDate: "2026-10-01", endDate: "2027-09-30", releaseFrom: "2026-10-01",
    balanceAccount: "1410 Prepaid insurance", pnlAccount: "6200 Insurance", tracking: "Head office",
    proration: "monthly", recurrence: "recurring", status: "review", detected: true,
  },
  {
    id: "pp-2", kind: "prepayment", description: "Design software – 12 seats", party: "Pixelcraft Ltd", sourceRef: "BILL-2304",
    total: 2160, openingBalance: 2160, startDate: "2026-10-15", endDate: "2027-10-14", releaseFrom: "2026-10-15",
    balanceAccount: "1420 Prepaid software", pnlAccount: "6300 Software subscriptions", tracking: "None",
    proration: "daily", recurrence: "recurring", status: "review", detected: true,
  },
  {
    id: "pp-3", kind: "prepayment", description: "Trade show booth deposit", party: "Expo Partners", sourceRef: "BILL-2310",
    total: 950, openingBalance: 950, startDate: "2026-11-01", endDate: "2026-11-30", releaseFrom: "2026-11-01",
    balanceAccount: "1400 Prepayments", pnlAccount: "6400 Marketing", tracking: "Retail",
    proration: "monthly", recurrence: "oneOff", status: "review", detected: true,
  },
  {
    id: "pp-4", kind: "prepayment", description: "Warehouse rent – Q3/Q4", party: "Harbour Properties", sourceRef: "BILL-2105",
    total: 9000, openingBalance: 9000, startDate: "2026-07-01", endDate: "2026-12-31", releaseFrom: "2026-07-01",
    balanceAccount: "1400 Prepayments", pnlAccount: "6100 Rent", tracking: "Warehouse",
    proration: "monthly", recurrence: "recurring", status: "active", detected: true,
  },
  {
    id: "pp-5", kind: "prepayment", description: "CRM platform annual plan", party: "Cloudline Inc", sourceRef: "BILL-1988",
    total: 3600, openingBalance: 2100, startDate: "2026-03-01", endDate: "2027-02-28", releaseFrom: "2026-08-01",
    balanceAccount: "1420 Prepaid software", pnlAccount: "6300 Software subscriptions", tracking: "None",
    proration: "monthly", recurrence: "recurring", status: "active", detected: false,
  },
  {
    id: "pp-6", kind: "prepayment", description: "Audit retainer", party: "Mason & Co Accountants", sourceRef: "BILL-1702",
    total: 1800, openingBalance: 1800, startDate: "2026-01-01", endDate: "2026-06-30", releaseFrom: "2026-01-01",
    balanceAccount: "1400 Prepayments", pnlAccount: "6600 Professional fees", tracking: "Head office",
    proration: "monthly", recurrence: "recurring", status: "completed", detected: true,
  },
  {
    id: "pp-7", kind: "prepayment", description: "Magazine subscription", party: "Trade Weekly", sourceRef: "BILL-2050",
    total: 260, openingBalance: 260, startDate: "2026-06-01", endDate: "2027-05-31", releaseFrom: "2026-06-01",
    balanceAccount: "1400 Prepayments", pnlAccount: "6400 Marketing", tracking: "None",
    proration: "monthly", recurrence: "recurring", status: "archived", detected: true,
  },
];

export const MOCK_DEFERRED: AmortisationItem[] = [
  {
    id: "di-1", kind: "deferred", description: "Annual support contract", party: "Brightwave Retail", sourceRef: "INV-5521",
    total: 12000, openingBalance: 12000, startDate: "2026-10-01", endDate: "2027-09-30", releaseFrom: "2026-10-01",
    balanceAccount: "2400 Deferred income", pnlAccount: "4200 Service revenue", tracking: "Online",
    proration: "monthly", recurrence: "recurring", status: "review", detected: true,
  },
  {
    id: "di-2", kind: "deferred", description: "Training workshop – paid in advance", party: "Fernhill School", sourceRef: "INV-5534",
    total: 1500, openingBalance: 1500, startDate: "2026-12-01", endDate: "2026-12-31", releaseFrom: "2026-12-01",
    balanceAccount: "2410 Customer deposits", pnlAccount: "4200 Service revenue", tracking: "None",
    proration: "monthly", recurrence: "oneOff", status: "review", detected: true,
  },
  {
    id: "di-3", kind: "deferred", description: "Platform licence – 6 months", party: "Oakridge Logistics", sourceRef: "INV-5402",
    total: 6600, openingBalance: 6600, startDate: "2026-08-01", endDate: "2027-01-31", releaseFrom: "2026-08-01",
    balanceAccount: "2400 Deferred income", pnlAccount: "4100 Subscription revenue", tracking: "Online",
    proration: "monthly", recurrence: "recurring", status: "active", detected: true,
  },
  {
    id: "di-4", kind: "deferred", description: "Maintenance plan 2026", party: "Riverside Clinic", sourceRef: "INV-5011",
    total: 2400, openingBalance: 2400, startDate: "2026-01-01", endDate: "2026-06-30", releaseFrom: "2026-01-01",
    balanceAccount: "2400 Deferred income", pnlAccount: "4200 Service revenue", tracking: "Head office",
    proration: "monthly", recurrence: "recurring", status: "completed", detected: true,
  },
];

export const MOCK_ASSETS: FixedAsset[] = [
  {
    id: "fa-1", description: "Laptops x6 (developer team)", vendor: "TechSource Direct", sourceRef: "BILL-2298",
    assetAccount: "1600 Computer equipment", accumAccount: "1601 Acc. depreciation – computer equipment", expenseAccount: "6800 Depreciation expense",
    cost: 10800, acquisitionDate: "2026-10-06", residualValue: 600, usefulLifeMonths: 36, method: "straightLine", reducingRatePct: 25,
    scheduleStart: "2026-10-01", accumulatedToDate: 0, alreadyDepreciated: false, nonDepreciable: false, status: "review", detected: true,
  },
  {
    id: "fa-2", description: "Standing desks x10", vendor: "Ergo Office Supply", sourceRef: "BILL-2312",
    assetAccount: "1610 Office furniture", accumAccount: "1611 Acc. depreciation – office furniture", expenseAccount: "6800 Depreciation expense",
    cost: 5400, acquisitionDate: "2026-10-12", residualValue: 0, usefulLifeMonths: 60, method: "straightLine", reducingRatePct: 20,
    scheduleStart: "2026-10-01", accumulatedToDate: 0, alreadyDepreciated: false, nonDepreciable: false, status: "review", detected: true,
  },
  {
    id: "fa-3", description: "Delivery van", vendor: "Metro Motors", sourceRef: "BILL-1650",
    assetAccount: "1620 Vehicles", accumAccount: "1621 Acc. depreciation – vehicles", expenseAccount: "6800 Depreciation expense",
    cost: 32000, acquisitionDate: "2026-01-20", residualValue: 8000, usefulLifeMonths: 48, method: "reducingBalance", reducingRatePct: 25,
    scheduleStart: "2026-02-01", accumulatedToDate: 0, alreadyDepreciated: false, nonDepreciable: false, status: "active", detected: true,
  },
  {
    id: "fa-4", description: "Server rack", vendor: "DataHub Systems", sourceRef: "BILL-1120",
    assetAccount: "1600 Computer equipment", accumAccount: "1601 Acc. depreciation – computer equipment", expenseAccount: "6800 Depreciation expense",
    cost: 7200, acquisitionDate: "2025-04-02", residualValue: 0, usefulLifeMonths: 24, method: "straightLine", reducingRatePct: 25,
    scheduleStart: "2026-01-01", accumulatedToDate: 2700, alreadyDepreciated: true, nonDepreciable: false, status: "active", detected: false,
  },
  {
    id: "fa-5", description: "Reception sofa", vendor: "Ergo Office Supply", sourceRef: "BILL-0870",
    assetAccount: "1610 Office furniture", accumAccount: "1611 Acc. depreciation – office furniture", expenseAccount: "6800 Depreciation expense",
    cost: 1400, acquisitionDate: "2025-02-10", residualValue: 0, usefulLifeMonths: 36, method: "straightLine", reducingRatePct: 20,
    scheduleStart: "2025-03-01", accumulatedToDate: 0, alreadyDepreciated: false, nonDepreciable: false, status: "completed", detected: true,
    disposal: { date: "2026-08-31", proceeds: 300, proceedsAccount: "1000 Operating bank account", gainLossAccount: "7900 Gain/loss on disposal of assets" },
  },
];

export const MOCK_ACCRUALS: Accrual[] = [
  {
    id: "ac-1", description: "Hydro bill expected", vendor: "City Hydro", amount: 405.2, date: "2026-10-31",
    expenseAccount: "6500 Utilities", liabilityAccount: "2300 Accrued liabilities", status: "review", origin: "suggested",
    basis: "Estimated from the last 3 bills (398.55, 412.10, 405.00) — usually arrives around the 8th.", trackOnly: false,
  },
  {
    id: "ac-2", description: "Internet & phone expected", vendor: "Fibrenet", amount: 189.99, date: "2026-10-31",
    expenseAccount: "6500 Utilities", liabilityAccount: "2300 Accrued liabilities", status: "review", origin: "suggested",
    basis: "Same amount billed every month for the last 6 months.", trackOnly: false,
  },
  {
    id: "ac-3", description: "Bookkeeping fees expected", vendor: "Mason & Co Accountants", amount: 650, date: "2026-10-31",
    expenseAccount: "6600 Professional fees", liabilityAccount: "2300 Accrued liabilities", status: "review", origin: "suggested",
    basis: "Recurring monthly bill not yet received for October.", trackOnly: false,
  },
  {
    id: "ac-4", description: "Hydro bill – September", vendor: "City Hydro", amount: 398.55, date: "2026-09-30",
    expenseAccount: "6500 Utilities", liabilityAccount: "2300 Accrued liabilities", status: "active", origin: "suggested", trackOnly: false,
    matchedBill: { ref: "BILL-2302", amount: 401.3, date: "2026-10-09" },
  },
  {
    id: "ac-5", description: "Contractor hours – September", vendor: "Lena Ortiz Consulting", amount: 2400, date: "2026-09-30",
    expenseAccount: "6600 Professional fees", liabilityAccount: "2300 Accrued liabilities", status: "active", origin: "manual", trackOnly: false,
  },
  {
    id: "ac-6", description: "Courier charges – September", vendor: "Swift Couriers", amount: 312.4, date: "2026-09-30",
    expenseAccount: "6400 Marketing", liabilityAccount: "2300 Accrued liabilities", status: "active", origin: "manual", trackOnly: true,
  },
  {
    id: "ac-7", description: "Hydro bill – February", vendor: "City Hydro", amount: 420, date: "2026-02-28",
    expenseAccount: "6500 Utilities", liabilityAccount: "2300 Accrued liabilities", status: "completed", origin: "suggested", trackOnly: false,
  },
  {
    id: "ac-8", description: "Bookkeeping fees – March", vendor: "Mason & Co Accountants", amount: 650, date: "2026-03-31",
    expenseAccount: "6600 Professional fees", liabilityAccount: "2300 Accrued liabilities", status: "completed", origin: "suggested", trackOnly: false,
  },
  {
    id: "ac-9", description: "Cleaning service – June", vendor: "Sparkle Cleaners", amount: 280, date: "2026-06-30",
    expenseAccount: "6100 Rent", liabilityAccount: "2300 Accrued liabilities", status: "completed", origin: "manual", trackOnly: false,
  },
  {
    id: "ac-10", description: "Water bill expected", vendor: "Metro Water", amount: 96, date: "2026-07-31",
    expenseAccount: "6500 Utilities", liabilityAccount: "2300 Accrued liabilities", status: "archived", origin: "suggested",
    basis: "Estimated from the last 2 bills.", trackOnly: false,
  },
];

export const MOCK_REVERSALS: AccrualReversal[] = [
  { id: "rv-1", accrualId: "ac-7", description: "Reverse: Hydro bill – February", amount: 420, date: "2026-03-01", billRef: "BILL-1840" },
  { id: "rv-2", accrualId: "ac-8", description: "Reverse: Bookkeeping fees – March", amount: 650, date: "2026-04-01", billRef: "BILL-1902" },
  { id: "rv-3", accrualId: "ac-9", description: "Reverse: Cleaning service – June", amount: 280, date: "2026-07-01", billRef: "BILL-2011" },
];

/** Rows the bulk-import wizard pretends to parse out of an uploaded file. */
export function mockImportRows(kind: AmortisationKind): (AmortisationItem & { error?: string })[] {
  const isPrepayment = kind === "prepayment";
  const base = {
    kind,
    proration: "monthly" as const,
    recurrence: "recurring" as const,
    status: "review" as const,
    detected: false,
    tracking: "None",
    balanceAccount: isPrepayment ? "1400 Prepayments" : "2400 Deferred income",
  };
  const stamp = Date.now();
  const rows = isPrepayment
    ? [
        ["Website hosting", "Hostly", "BILL-1801", 1200, 700, "2026-03-01", "2027-02-28", "2026-08-01", "6300 Software subscriptions", undefined],
        ["Fleet insurance", "Northgate Insurance", "BILL-1855", 6000, 6000, "2026-09-01", "2027-08-31", "2026-09-01", "6200 Insurance", undefined],
        ["Storage unit rent", "SafeStore", "BILL-1870", 1440, 1440, "2026-10-01", "2027-09-30", "2026-10-01", "6100 Rent", undefined],
        ["Industry membership", "Retail Guild", "BILL-1888", 540, 540, "2026-11-01", "2026-10-01", "2026-11-01", "6400 Marketing", "End date is before the start date"],
        ["Legal retainer", "Holt Legal", "BILL-1893", 3000, 3000, "2026-10-01", "2027-03-31", "2026-10-01", "6600 Professional fees", undefined],
      ]
    : [
        ["Annual SaaS licence", "Pinecrest Foods", "INV-4801", 4800, 2800, "2026-03-01", "2027-02-28", "2026-08-01", "4100 Subscription revenue", undefined],
        ["Support plan", "Cedar Dental", "INV-4822", 1800, 1800, "2026-10-01", "2027-03-31", "2026-10-01", "4200 Service revenue", undefined],
        ["Onboarding package", "Bluebird Cafe", "INV-4840", 900, 900, "2026-11-01", "2027-01-31", "2026-11-01", "4200 Service revenue", undefined],
        ["Event sponsorship", "Lakeside Events", "INV-4851", 2500, 2500, "2026-12-01", "2026-12-31", "2026-12-01", "", "Income account is missing"],
        ["Quarterly retainer", "Summit Partners", "INV-4860", 3600, 3600, "2026-10-01", "2026-12-31", "2026-10-01", "4200 Service revenue", undefined],
      ];
  return rows.map(([description, party, sourceRef, total, openingBalance, startDate, endDate, releaseFrom, pnlAccount, error], i) => ({
    ...base,
    id: `import-${stamp}-${i}`,
    description: description as string,
    party: party as string,
    sourceRef: sourceRef as string,
    total: total as number,
    openingBalance: openingBalance as number,
    startDate: startDate as string,
    endDate: endDate as string,
    releaseFrom: releaseFrom as string,
    pnlAccount: pnlAccount as string,
    error: error as string | undefined,
  }));
}
