"use client";

import { CalendarRange } from "lucide-react";

import { Switch } from "@/components/ui/Switch";

// Service period + "treat as prepayment" on the invoice review screen. A
// prepayment's bill posts to the prepaid account; posting it leaves a
// schedule on Month-End → Prepayments that releases it to the GL account
// picked above, one month at a time (Scantrix_API prepayment.service.js).

/** Over 31 days = more than a month — the backend's detection rule. */
export const PREPAYMENT_MIN_DAYS = 32;

const DAY_MS = 86_400_000;

function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d;
}

/** Days covered (inclusive), or null when the period isn't usable. */
export function servicePeriodDays(start: string, end: string): number | null {
  const s = parseIso(start);
  const e = parseIso(end);
  if (!s || !e || e < s) return null;
  return Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1;
}

/** Calendar months the period touches = the number of monthly releases. */
function releaseCount(start: string, end: string): number {
  const s = parseIso(start);
  const e = parseIso(end);
  if (!s || !e || e < s) return 0;
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

/** Why a prepayment can't be posted as it stands, or "". */
export function prepaymentError(on: boolean, start: string, end: string): string {
  if (!on) return "";
  if (!start || !end) return "Enter the service period's start and end dates.";
  const days = servicePeriodDays(start, end);
  if (days == null) return "The service period ends before it starts.";
  if (days < PREPAYMENT_MIN_DAYS) return "A period of a month or less (31 days) isn't a prepayment — it's expensed as usual.";
  return "";
}

const INPUT_CLASS =
  "mt-[var(--space-xs)] h-10 w-full rounded-md border border-border bg-page px-[var(--space-sm)] text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

interface Props {
  start: string;
  end: string;
  /** null = nobody decided yet. */
  on: boolean | null;
  /** The scanner flagged it. */
  detected: boolean;
  /** The invoice-level GL account's name — what the schedule releases to. */
  expenseAccountName: string;
  disabled?: boolean;
  onChange: (patch: Partial<{ start: string; end: string; on: boolean }>) => void;
}

export function PrepaymentFields({ start, end, on, detected, expenseAccountName, disabled, onChange }: Props) {
  const days = servicePeriodDays(start, end);
  const isOn = on === true;
  const releases = releaseCount(start, end);
  const suggest = on === null && (days ?? 0) >= PREPAYMENT_MIN_DAYS;
  const error = prepaymentError(isOn, start, end);

  return (
    <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
      {(detected && isOn) || suggest ? (
        <div className="flex items-start gap-[var(--space-sm)] rounded-md border border-warning/40 bg-warning/10 p-[var(--space-sm)]">
          <CalendarRange size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-primary" />
          <div className="min-w-0 text-body-sm text-content-primary">
            <p className="font-bold">Prepayment detected</p>
            <p className="text-caption text-content-secondary">
              {days != null ? `This invoice covers ${days} days. ` : ""}Check the service period — every monthly release is worked out from it.
              {suggest && " Turn on “Treat as prepayment” to post it to the prepaid account."}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
        <label className="text-caption font-semibold text-content-secondary">
          Service start
          <input type="date" value={start} disabled={disabled} onChange={(e) => onChange({ start: e.target.value })} className={INPUT_CLASS} />
        </label>
        <label className="text-caption font-semibold text-content-secondary">
          Service end
          <input type="date" value={end} disabled={disabled} onChange={(e) => onChange({ end: e.target.value })} className={INPUT_CLASS} />
        </label>
      </div>

      <div className="flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border bg-page p-[var(--space-sm)]">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-content-primary">Treat as prepayment</p>
          <p className="text-caption text-content-secondary">Post the full amount to the prepaid account and release it to expense month by month.</p>
        </div>
        <Switch checked={isOn} onChange={(v) => onChange({ on: v })} disabled={disabled} label="Treat as prepayment" />
      </div>

      {isOn && !error && (
        <p className="text-caption text-content-secondary">
          Posts to: <span className="font-semibold text-content-primary">the prepaid account</span> → released monthly to{" "}
          <span className="font-semibold text-content-primary">{expenseAccountName || "the GL account above"}</span> over {releases} month
          {releases === 1 ? "" : "s"}. You publish the schedule on Month-End → Prepayments after posting.
        </p>
      )}
      {error && <p className="text-caption font-semibold text-error">{error}</p>}
    </div>
  );
}
