"use client";

import { ReactNode, useEffect, useMemo } from "react";

import { Badge } from "@/components/ui/Badge";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import type { PrepaymentDisplayStatus } from "@/store/monthEnd/monthEndApi";

import { STATUS_LABELS } from "./format";

// Form pieces and lookups shared by the month-end trackers (ported from the
// ScanTrix-X-Breifcase branch's monthEnd/shared.tsx, wired to real data).

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const NOTE_CLASS = "rounded-md border border-status-info-border bg-status-info-bg p-[var(--space-sm)] text-caption text-status-info-text";
export const ERROR_NOTE_CLASS = "rounded-md border border-error/30 bg-error/10 p-[var(--space-sm)] text-caption font-semibold text-error";
export const SECTION_TITLE_CLASS = "text-tiny font-bold uppercase tracking-wider text-content-muted";

const STATUS_VARIANTS: Record<PrepaymentDisplayStatus, "success" | "warning" | "error" | "neutral"> = {
  review: "warning",
  active: "success",
  completed: "neutral",
  archived: "neutral",
};

export function StatusBadge({ status }: { status: PrepaymentDisplayStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
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

export interface AccountOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
  placeholder = "Select an account…",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: AccountOption[];
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || options.length === 0} className={FIELD_INPUT_CLASS}>
        {options.length === 0 && <option value="">No accounts loaded</option>}
        {options.length > 0 && value === "" && !options.some((o) => o.value === "") && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Account types (QuickBooks and Xero spellings) a prepaid balance can sit in,
// and the ones it can be released to.
const ASSET_TYPES = new Set(["Other Current Asset", "Other Asset", "CURRENT", "PREPAYMENT", "NONCURRENT"]);
const EXPENSE_TYPES = new Set(["Expense", "Other Expense", "Cost of Goods Sold", "EXPENSE", "OVERHEADS", "DIRECTCOSTS"]);

type Ids = (string | null | undefined)[];

/**
 * The company's synced GL accounts split into prepaid (asset) and expense
 * options. `keep` ids stay selectable in THEIR OWN group even if their type
 * isn't in it, so a saved choice never silently disappears from its dropdown
 * (and the prepaid account never turns up among the expense accounts).
 */
export function useMonthEndAccounts(keep: { balance?: Ids; pnl?: Ids } = {}) {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const accountsConnectionId = useAppSelector((state) => state.quickBooks.accountsConnectionId);
  const accounts = useAppSelector((state) => state.quickBooks.accounts);
  const loaded = accountsConnectionId === qbConnectionId;

  useEffect(() => {
    if (accessToken && qbConnectionId && !loaded) dispatch(fetchQuickBooksAccounts({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId, loaded]);

  const balanceKey = (keep.balance ?? []).filter(Boolean).join(",");
  const pnlKey = (keep.pnl ?? []).filter(Boolean).join(",");
  return useMemo(() => {
    const list = loaded ? accounts : [];
    const pick = (types: Set<string>, keepIds: string) => {
      const kept = new Set(keepIds.split(",").filter(Boolean));
      return list.filter((a) => types.has(a.accountType) || kept.has(a.qbAccountId)).map((a) => ({ value: a.qbAccountId, label: a.name }));
    };
    return { balanceAccounts: pick(ASSET_TYPES, balanceKey), pnlAccounts: pick(EXPENSE_TYPES, pnlKey) };
  }, [accounts, loaded, balanceKey, pnlKey]);
}
