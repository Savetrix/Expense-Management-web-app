"use client";

import { ChevronDown, Download, Plus, Scale } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { addMonths, currentPeriod, formatMoney, periodLabel, round2 } from "./schedule";
import type { AdjustmentStatus, ScheduleRow } from "./types";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const NOTE_CLASS = "rounded-md border border-status-info-border bg-status-info-bg p-[var(--space-sm)] text-caption text-status-info-text";
export const SECTION_TITLE_CLASS = "text-tiny font-bold uppercase tracking-wider text-content-muted";

export const STATUS_LABELS: Record<AdjustmentStatus, string> = {
  review: "To review",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

const STATUS_VARIANTS: Record<AdjustmentStatus, "success" | "warning" | "error" | "neutral"> = {
  review: "warning",
  active: "success",
  completed: "neutral",
  archived: "neutral",
};

export function StatusBadge({ status, label }: { status: AdjustmentStatus; label?: string }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{label ?? STATUS_LABELS[status]}</Badge>;
}

export function countByStatus<T extends { status: AdjustmentStatus }>(items: T[]): Record<AdjustmentStatus, number> {
  const counts: Record<AdjustmentStatus, number> = { review: 0, active: 0, completed: 0, archived: 0 };
  items.forEach((item) => {
    counts[item.status] += 1;
  });
  return counts;
}

// ── Form fields ────────────────────────────────────────────────────────────

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      {children}
      {hint && <p className="mt-[var(--space-xs)] text-caption text-content-secondary">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        className={FIELD_INPUT_CLASS}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[] | { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={FIELD_INPUT_CLASS}>
        {options.map((opt) => {
          const o = typeof opt === "string" ? { value: opt, label: opt } : opt;
          return (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

export function SwitchRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border bg-page p-[var(--space-sm)]">
      <div className="min-w-0">
        <p className="text-body-sm font-semibold text-content-primary">{label}</p>
        {description && <p className="text-caption text-content-secondary">{description}</p>}
      </div>
      {control}
    </div>
  );
}

/** Pill toggle reusing the Tabs segmented control; read-only renders as text. */
export function SegmentedField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <div className="mt-[var(--space-xs)]">
        {disabled ? (
          <p className="text-body-sm text-content-secondary">{options.find((o) => o.value === value)?.label}</p>
        ) : (
          <Tabs items={options} value={value} onChange={(v) => onChange(v as T)} />
        )}
      </div>
    </div>
  );
}

export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-xs)]">
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-[var(--space-xs)]">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-tiny font-bold ${
              i <= current ? "bg-primary text-accent-ink" : "bg-surface-alt text-content-muted"
            }`}
          >
            {i + 1}
          </span>
          <span className={`text-caption font-semibold ${i === current ? "text-content-primary" : "text-content-secondary"}`}>{step}</span>
          {i < steps.length - 1 && <span className="mx-[var(--space-xs)] h-px w-4 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

// ── Schedule table ─────────────────────────────────────────────────────────

export function ScheduleTable({
  rows,
  amountHeader,
  closingHeader,
  posting,
  emptyText,
}: {
  rows: ScheduleRow[];
  amountHeader: string;
  closingHeader: string;
  /** Whether the schedule is live (Active/Completed) or still a draft. */
  posting: boolean;
  emptyText: string;
}) {
  const now = currentPeriod();
  const columns: DataTableColumn<ScheduleRow>[] = [
    { key: "period", header: "Period", width: "120px", render: (r) => <span className="font-semibold">{periodLabel(r.period)}</span> },
    { key: "amount", header: amountHeader, width: "120px", align: "right", render: (r) => formatMoney(r.amount) },
    { key: "closing", header: closingHeader, width: "130px", align: "right", render: (r) => formatMoney(r.closing) },
    {
      key: "state",
      header: "Journal",
      width: "190px",
      render: (r) =>
        r.trackedOnly ? (
          <span className="text-content-secondary">Tracked only, not posted</span>
        ) : posting && r.period <= now ? (
          <Badge variant="success">Posted</Badge>
        ) : (
          <span className="text-content-secondary">{posting ? "Scheduled" : "Posts on publish"}</span>
        ),
    },
  ];
  if (rows.length === 0) {
    return <p className="rounded-md border border-border bg-page p-[var(--space-md)] text-center text-body-sm text-content-secondary">{emptyText}</p>;
  }
  return <DataTable columns={columns} rows={rows} getRowKey={(r) => r.period} maxHeightClassName="max-h-[280px]" />;
}

// ── Tracker table + toolbar ────────────────────────────────────────────────

export interface TrackerRow {
  id: string;
  description: string;
  party: string;
  sourceRef: string;
  account: string;
  total: number;
  range: string;
  released: number;
  closing: number;
  status: AdjustmentStatus;
  statusLabel?: string;
}

export function TrackerTable({
  rows,
  partyLabel,
  releasedHeader,
  closingHeader,
  onRowClick,
  emptyState,
}: {
  rows: TrackerRow[];
  partyLabel: string;
  releasedHeader: string;
  closingHeader: string;
  onRowClick: (row: TrackerRow) => void;
  emptyState: ReactNode;
}) {
  const columns: DataTableColumn<TrackerRow>[] = [
    { key: "description", header: "Description", width: "200px", render: (r) => <span className="block truncate font-bold">{r.description}</span> },
    { key: "party", header: partyLabel, width: "150px", render: (r) => <span className="block truncate text-content-secondary">{r.party}</span> },
    { key: "source", header: "Source", width: "100px", render: (r) => <span className="block truncate text-content-secondary">{r.sourceRef || "—"}</span> },
    { key: "account", header: "Account", width: "170px", render: (r) => <span className="block truncate text-content-secondary">{r.account}</span> },
    { key: "total", header: "Total", width: "105px", align: "right", render: (r) => <span className="font-semibold">{formatMoney(r.total)}</span> },
    { key: "range", header: "Start – end", width: "160px", render: (r) => <span className="block truncate text-content-secondary">{r.range}</span> },
    { key: "released", header: releasedHeader, width: "120px", align: "right", render: (r) => formatMoney(r.released) },
    { key: "closing", header: closingHeader, width: "140px", align: "right", render: (r) => <span className="font-semibold">{formatMoney(r.closing)}</span> },
    { key: "status", header: "Status", width: "120px", render: (r) => <StatusBadge status={r.status} label={r.statusLabel} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      onRowClick={onRowClick}
      emptyState={emptyState}
      bordered={false}
      maxHeightClassName="max-h-[560px]"
    />
  );
}

export const ALL = "all";

export function periodOptions(): { value: string; label: string }[] {
  const now = currentPeriod();
  const opts = [{ value: ALL, label: "All periods" }];
  for (let i = 3; i >= -9; i--) {
    const p = addMonths(now, i);
    opts.push({ value: p, label: p === now ? `${periodLabel(p)} (this month)` : periodLabel(p) });
  }
  return opts;
}

export function TrackerToolbar({
  status,
  onStatusChange,
  counts,
  account,
  onAccountChange,
  accountOptions,
  period,
  onPeriodChange,
  exportName,
  actions,
}: {
  status: AdjustmentStatus;
  onStatusChange: (status: AdjustmentStatus) => void;
  counts: Record<AdjustmentStatus, number>;
  account: string;
  onAccountChange: (value: string) => void;
  accountOptions: string[];
  period: string;
  onPeriodChange: (value: string) => void;
  exportName: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)]">
      <div className="flex flex-col gap-[var(--space-md)] lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-full overflow-x-auto">
          <Tabs
            items={(Object.keys(STATUS_LABELS) as AdjustmentStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s], count: counts[s] }))}
            value={status}
            onChange={(v) => onStatusChange(v as AdjustmentStatus)}
          />
        </div>
        {actions && <div className="flex flex-wrap items-center gap-[var(--space-sm)]">{actions}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
        <SelectDropdown uiSize="sm" value={account} onChange={(e) => onAccountChange(e.target.value)} aria-label="Filter by account" className="max-w-[240px]">
          <option value={ALL}>All accounts</option>
          {accountOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </SelectDropdown>
        <SelectDropdown uiSize="sm" value={period} onChange={(e) => onPeriodChange(e.target.value)} aria-label="Filter by period">
          {periodOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectDropdown>
        <button
          type="button"
          onClick={() => notifyBackendPending(`Export ${exportName} CSV`)}
          className="inline-flex h-8 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt"
        >
          <Download size={14} strokeWidth={2.25} />
          {beLabel("Export CSV")}
        </button>
      </div>
    </div>
  );
}

/** Primary "Add …" button with an attached dropdown for secondary entry points. */
export function AddMenuButton({ label, onAdd, menu }: { label: string; onAdd: () => void; menu?: { label: string; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <Button size="sm" onClick={onAdd} className={menu?.length ? "rounded-r-none" : ""}>
        <Plus size={16} strokeWidth={2.5} />
        {label}
      </Button>
      {menu && menu.length > 0 && (
        <>
          <Button size="sm" aria-label="More add options" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-l-none border-l border-black/10 px-[var(--space-xs)]">
            <ChevronDown size={16} strokeWidth={2.5} />
          </Button>
          {open && (
            <div className="absolute right-0 top-full z-20 mt-[var(--space-xs)] min-w-[180px] overflow-hidden rounded-md border border-border bg-surface shadow-lg">
              {menu.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    m.onSelect();
                  }}
                  className="block w-full px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm text-content-primary hover:bg-surface-alt"
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reconciliation card ────────────────────────────────────────────────────

export function ReconciliationCard({ label, trackerBalance, ledgerOffset }: { label: string; trackerBalance: number; ledgerOffset: number }) {
  const provider = useActiveProvider();
  const ledger = round2(trackerBalance + ledgerOffset);
  const diff = round2(ledger - trackerBalance);
  return (
    <div className="flex flex-col gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-alt text-content-secondary">
          <Scale size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-content-primary">
            {label} tracker balance vs balance in {provider.name}
          </p>
          <p className="text-caption text-content-secondary">
            Tracker {formatMoney(trackerBalance)} · {provider.name} {formatMoney(ledger)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
        {diff === 0 ? <Badge variant="success">Matched</Badge> : <Badge variant="error">Difference {formatMoney(diff)}</Badge>}
        <button
          type="button"
          onClick={() => notifyBackendPending("Re-check balance")}
          className="text-caption font-semibold text-accent hover:underline"
        >
          {beLabel("Re-check")}
        </button>
      </div>
    </div>
  );
}

export function DisabledDetectionNote({ typeLabel }: { typeLabel: string }) {
  return <div className={NOTE_CLASS}>Automatic detection is turned off for {typeLabel}. You can still add items manually, or turn it back on in Detection settings.</div>;
}
