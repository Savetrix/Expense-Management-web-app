// Shapes for the month-end adjustment trackers. These mirror what the
// month-end API is expected to return once it exists; until then the page
// runs on mockData.ts.

export type AdjustmentStatus = "review" | "active" | "completed" | "archived";
export type AdjustmentType = "prepayments" | "deferred" | "fixedAssets" | "accruals";
export type Proration = "monthly" | "daily";
export type Recurrence = "recurring" | "oneOff";
export type AmortisationKind = "prepayment" | "deferred";
export type DepreciationMethod = "straightLine" | "reducingBalance";

/** A prepayment (from a bill) or deferred income (from a sales invoice). */
export interface AmortisationItem {
  id: string;
  kind: AmortisationKind;
  description: string;
  /** Vendor for prepayments, customer for deferred income. */
  party: string;
  sourceRef: string;
  total: number;
  /** Balance still to release at the release-from date (imported/partly released items). */
  openingBalance: number;
  startDate: string;
  endDate: string;
  releaseFrom: string;
  /** Prepayment asset account or deferred income liability account. */
  balanceAccount: string;
  /** Expense account (prepayments) or income account (deferred income). */
  pnlAccount: string;
  tracking: string;
  proration: Proration;
  recurrence: Recurrence;
  status: AdjustmentStatus;
  /** true when Scantrix spotted it on an incoming invoice. */
  detected: boolean;
}

export interface AssetDisposal {
  date: string;
  proceeds: number;
  proceedsAccount: string;
  gainLossAccount: string;
}

export interface FixedAsset {
  id: string;
  description: string;
  vendor: string;
  sourceRef: string;
  assetAccount: string;
  accumAccount: string;
  expenseAccount: string;
  cost: number;
  acquisitionDate: string;
  residualValue: number;
  /** Remaining useful life in months from the schedule start date. */
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Annual rate used by the reducing-balance method. */
  reducingRatePct: number;
  scheduleStart: string;
  accumulatedToDate: number;
  alreadyDepreciated: boolean;
  nonDepreciable: boolean;
  status: AdjustmentStatus;
  detected: boolean;
  disposal?: AssetDisposal;
}

export interface Accrual {
  id: string;
  description: string;
  vendor: string;
  amount: number;
  /** Period-end date the accrual is posted at. */
  date: string;
  expenseAccount: string;
  liabilityAccount: string;
  status: AdjustmentStatus;
  origin: "suggested" | "manual";
  /** Why Scantrix suggested it, for suggested accruals. */
  basis?: string;
  trackOnly: boolean;
  /** Set when the matching bill has arrived and a reversal is suggested. */
  matchedBill?: { ref: string; amount: number; date: string };
}

export interface AccrualReversal {
  id: string;
  accrualId: string;
  description: string;
  amount: number;
  date: string;
  billRef?: string;
}

export interface DetectionSettings {
  threshold: number;
  proration: Proration;
  enabled: Record<AdjustmentType, boolean>;
}

export interface ScheduleRow {
  /** YYYY-MM */
  period: string;
  amount: number;
  closing: number;
  trackedOnly: boolean;
}
