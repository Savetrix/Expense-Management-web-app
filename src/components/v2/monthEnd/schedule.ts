import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import type { AdjustmentStatus, AmortisationItem, DepreciationMethod, FixedAsset, Proration, Recurrence, ScheduleRow } from "./types";

// Pure, client-side schedule maths for the month-end trackers. The backend
// will own the posted figures; these only drive previews and the mock flow.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parses YYYY-MM-DD as a UTC date so local time zones never shift the day. */
export function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${currentPeriod()}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(startIso: string, endIso: string): string[] {
  const start = periodOf(startIso);
  const end = periodOf(endIso);
  if (start > end) return [];
  const out: string[] = [];
  for (let p = start; p <= end && out.length < 600; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function periodLabel(period: string): string {
  const d = parseIso(`${period}-01`);
  return d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : period;
}

export function dateLabel(iso: string): string {
  const d = parseIso(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

export function rangeLabel(startIso: string, endIso: string): string {
  return `${periodLabel(periodOf(startIso))} – ${periodLabel(periodOf(endIso))}`;
}

function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Last day of the month containing `iso`. */
export function monthEndOf(iso: string): string {
  return lastDayOf(periodOf(iso));
}

const DAY_MS = 86_400_000;
function daysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
}

/** Spreads amounts across periods, letting the last period absorb rounding. */
function finalise(periods: string[], weights: number[], total: number, releaseFrom: string): ScheduleRow[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return [];
  let released = 0;
  const fromPeriod = periodOf(releaseFrom);
  return periods.map((period, i) => {
    const amount = i === periods.length - 1 ? round2(total - released) : round2((total * weights[i]) / weightSum);
    released = round2(released + amount);
    return { period, amount, closing: round2(total - released), trackedOnly: period < fromPeriod };
  });
}

export interface AmortisationInput {
  total: number;
  startDate: string;
  endDate: string;
  releaseFrom: string;
  proration: Proration;
  recurrence: Recurrence;
}

export function amortisationSchedule(input: AmortisationInput): ScheduleRow[] {
  const start = parseIso(input.startDate);
  const end = parseIso(input.endDate);
  if (!start || !end || !(input.total > 0)) return [];
  if (input.recurrence === "oneOff") {
    return finalise([periodOf(input.startDate)], [1], input.total, input.releaseFrom || input.startDate);
  }
  if (end < start) return [];
  const periods = monthsBetween(input.startDate, input.endDate);
  const weights = periods.map((period) => {
    if (input.proration === "monthly") return 1;
    const monthStart = parseIso(`${period}-01`)!;
    const monthEnd = parseIso(lastDayOf(period))!;
    const from = monthStart < start ? start : monthStart;
    const to = monthEnd > end ? end : monthEnd;
    return Math.max(0, daysInclusive(from, to));
  });
  return finalise(periods, weights, input.total, input.releaseFrom || input.startDate);
}

export function itemSchedule(item: AmortisationItem): ScheduleRow[] {
  return amortisationSchedule(item);
}

export interface DepreciationInput {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  reducingRatePct: number;
  scheduleStart: string;
  accumulatedToDate: number;
  nonDepreciable: boolean;
}

/** Monthly depreciation; `amount` is the charge, `closing` the net book value. */
export function depreciationSchedule(input: DepreciationInput): ScheduleRow[] {
  if (input.nonDepreciable || !parseIso(input.scheduleStart)) return [];
  const life = Math.floor(input.usefulLifeMonths);
  const openingNbv = round2(input.cost - (input.accumulatedToDate || 0));
  const floor = Math.max(0, input.residualValue || 0);
  if (!(input.cost > 0) || life <= 0 || openingNbv <= floor) return [];
  const start = periodOf(input.scheduleStart);
  const rows: ScheduleRow[] = [];
  let nbv = openingNbv;
  const straight = round2((openingNbv - floor) / life);
  const monthlyRate = Math.max(0, input.reducingRatePct) / 100 / 12;
  for (let i = 0; i < life; i++) {
    let charge = input.method === "straightLine" ? (i === life - 1 ? round2(nbv - floor) : straight) : round2(nbv * monthlyRate);
    if (nbv - charge < floor) charge = round2(nbv - floor);
    nbv = round2(nbv - charge);
    rows.push({ period: addMonths(start, i), amount: charge, closing: nbv, trackedOnly: false });
    if (nbv <= floor) break;
  }
  return rows;
}

export function assetSchedule(asset: FixedAsset): ScheduleRow[] {
  return depreciationSchedule(asset);
}

/** Total released (or depreciated) in schedule periods up to and including `period`. */
export function releasedThrough(rows: ScheduleRow[], period: string): number {
  return round2(rows.filter((r) => r.period <= period).reduce((s, r) => s + r.amount, 0));
}

export function lastPeriod(rows: ScheduleRow[], fallbackIso: string): string {
  return rows.length ? rows[rows.length - 1].period : periodOf(fallbackIso);
}

/** Whether a tracker item is live during `period` (used by the period filter). */
export function overlapsPeriod(startIso: string, endPeriod: string, period: string): boolean {
  return periodOf(startIso) <= period && period <= endPeriod;
}

export function postsJournals(status: AdjustmentStatus): boolean {
  return status === "active" || status === "completed";
}

export function formatMoney(amount: number): string {
  return formatDetailAmount(amount);
}

export { round2 };
