"use client";

import Link from "next/link";
import { ArrowRight, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CreatableCombobox, Modal, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

// Front-end-only reclassification flows. Every "create/move/add" is a (BE)
// action; the modal closes afterwards as if it succeeded.

export type MarkAsKind = "prepayment" | "deferred_income" | "fixed_asset" | "sales_document" | "expense_claim";

export const MARK_AS_OPTIONS: { key: MarkAsKind; label: string }[] = [
  { key: "prepayment", label: "Prepayment" },
  { key: "deferred_income", label: "Deferred income" },
  { key: "fixed_asset", label: "Fixed asset" },
  { key: "sales_document", label: "Sales document (move to sales)" },
  { key: "expense_claim", label: "Expense claim" },
];

const MOCK_CLAIMANTS = [
  { id: "c1", label: "Sam Patel" },
  { id: "c2", label: "Alex Morgan" },
  { id: "c3", label: "Jordan Lee" },
];

interface MarkAsModalProps {
  open: boolean;
  onClose: () => void;
  initialKind: MarkAsKind;
  /** Invoice total as a number, used for schedule previews. */
  totalAmount: number;
  currency?: string;
}

function monthsBetween(start: string, end: string): string[] {
  if (!start || !end) return [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
  const months: string[] = [];
  const cursor = new Date(s.getFullYear(), s.getMonth(), 1);
  const last = new Date(e.getFullYear(), e.getMonth(), 1);
  while (cursor <= last && months.length < 120) {
    months.push(cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function formatMoney(value: number, currency?: string): string {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency && currency !== "—" ? `${currency} ${n}` : n;
}

function ScheduleForm({
  kind,
  totalAmount,
  currency,
  onDone,
}: {
  kind: "prepayment" | "deferred_income";
  totalAmount: number;
  currency?: string;
  onDone: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const months = useMemo(() => monthsBetween(start, end), [start, end]);
  const perMonth = months.length > 0 ? totalAmount / months.length : 0;
  const invalidRange = Boolean(start && end) && months.length === 0;
  const noun = kind === "prepayment" ? "expense" : "income";

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        {kind === "prepayment"
          ? "Spread this cost evenly across the months it covers, releasing a share to expense each month."
          : "Recognise this amount as income evenly across the months it covers."}
      </p>
      <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
        <TextInput label="Period start" name="markas-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextInput
          label="Period end"
          name="markas-end"
          type="date"
          value={end}
          error={invalidRange ? "End must be on or after start." : undefined}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>

      {months.length > 0 && (
        <div>
          <p className="mb-[var(--space-xs)] text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
            Monthly release preview · {months.length} month{months.length === 1 ? "" : "s"}
          </p>
          <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border">
            {months.map((m) => (
              <li
                key={m}
                className="flex items-center justify-between border-b border-border px-[var(--space-md)] py-[var(--space-xs)] text-caption last:border-b-0"
              >
                <span className="text-content-secondary">{m}</span>
                <span className="font-semibold text-content-primary">
                  {formatMoney(perMonth, currency)} to {noun}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
        <Link href="/month-end" className="inline-flex items-center gap-1 text-caption font-bold text-accent hover:underline">
          View month-end schedules
          <ArrowRight size={12} strokeWidth={2.25} />
        </Link>
        <Button
          type="button"
          size="sm"
          disabled={months.length === 0}
          onClick={() => {
            notifyBackendPending(kind === "prepayment" ? "Create prepayment schedule" : "Create deferred income schedule");
            onDone();
          }}
        >
          {beLabel(kind === "prepayment" ? "Create prepayment schedule" : "Create deferred income schedule")}
        </Button>
      </div>
    </div>
  );
}

function FixedAssetForm({ totalAmount, currency, onDone }: { totalAmount: number; currency?: string; onDone: () => void }) {
  const [life, setLife] = useState("36");
  const [residual, setResidual] = useState("0");
  const lifeMonths = Number(life);
  const residualValue = Number(residual);
  const valid = Number.isFinite(lifeMonths) && lifeMonths > 0 && Number.isFinite(residualValue) && residualValue >= 0 && residualValue < totalAmount;
  const monthly = valid ? (totalAmount - residualValue) / lifeMonths : 0;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        Register this purchase as an asset and depreciate it straight-line over its useful life.
      </p>
      <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
        <TextInput
          label="Useful life (months)"
          name="markas-life"
          type="number"
          min={1}
          value={life}
          onChange={(e) => setLife(e.target.value)}
        />
        <TextInput
          label="Residual value"
          name="markas-residual"
          type="number"
          min={0}
          step="0.01"
          value={residual}
          error={residualValue >= totalAmount && totalAmount > 0 ? "Must be less than the cost." : undefined}
          onChange={(e) => setResidual(e.target.value)}
        />
      </div>
      {valid && (
        <p className="rounded-md border border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-caption text-content-secondary">
          Cost {formatMoney(totalAmount, currency)} · depreciation{" "}
          <span className="font-semibold text-content-primary">{formatMoney(monthly, currency)}/month</span> for {lifeMonths} months.
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!valid}
          onClick={() => {
            notifyBackendPending("Create asset");
            onDone();
          }}
        >
          {beLabel("Create asset")}
        </Button>
      </div>
    </div>
  );
}

function SalesDocumentForm({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        This looks like an invoice you issued rather than a bill you received. Moving it re-processes the document as a
        sales invoice, and the current bill is withdrawn.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            notifyBackendPending("Move to sales");
            onDone();
          }}
        >
          {beLabel("Move")}
        </Button>
      </div>
    </div>
  );
}

function ExpenseClaimForm({ onDone }: { onDone: () => void }) {
  const [claimants, setClaimants] = useState(MOCK_CLAIMANTS);
  const [claimant, setClaimant] = useState("");

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        Someone paid for this personally. Add it to their expense claim so they can be reimbursed.
      </p>
      <div className="flex flex-col gap-[var(--space-xs)]">
        <span className="text-body-sm font-semibold text-content-primary">Claimant</span>
        <CreatableCombobox
          uiSize="md"
          noun="claimant"
          ariaLabel="Claimant"
          options={claimants}
          value={claimant}
          onSelect={setClaimant}
          onAddNew={(name) => {
            const label = name.trim() || `New claimant ${claimants.length + 1}`;
            const id = `new-${Date.now()}`;
            setClaimants((prev) => [...prev, { id, label }]);
            setClaimant(id);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
        <Link href="/expense-claims" className="inline-flex items-center gap-1 text-caption font-bold text-accent hover:underline">
          View expense claims
          <ArrowRight size={12} strokeWidth={2.25} />
        </Link>
        <Button
          type="button"
          size="sm"
          disabled={!claimant}
          onClick={() => {
            notifyBackendPending("Add to claim");
            onDone();
          }}
        >
          {beLabel("Add to claim")}
        </Button>
      </div>
    </div>
  );
}

export function MarkAsModal({ open, onClose, initialKind, totalAmount, currency }: MarkAsModalProps) {
  const provider = useActiveProvider();
  const [kind, setKind] = useState<MarkAsKind>(initialKind);

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-lg"
      ariaLabel="Mark as"
      title={
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
            <Tag size={18} strokeWidth={2} className="text-content-secondary" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Mark as</span>
            <span className="truncate text-h3 font-bold text-content-primary">
              {MARK_AS_OPTIONS.find((o) => o.key === kind)?.label}
            </span>
          </span>
        </span>
      }
    >
      <div className="mb-[var(--space-md)] flex flex-wrap gap-[var(--space-xs)]" role="tablist" aria-label="Mark as type">
        {MARK_AS_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={kind === option.key}
            onClick={() => setKind(option.key)}
            className={`rounded-pill border px-[var(--space-sm)] py-[2px] text-caption font-semibold ${
              kind === option.key
                ? "border-accent bg-accent-bg text-accent-text-on-bg"
                : "border-border bg-surface text-content-secondary hover:bg-surface-alt"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {(kind === "prepayment" || kind === "deferred_income") && (
        <ScheduleForm key={kind} kind={kind} totalAmount={totalAmount} currency={currency} onDone={onClose} />
      )}
      {kind === "fixed_asset" && <FixedAssetForm totalAmount={totalAmount} currency={currency} onDone={onClose} />}
      {kind === "sales_document" && <SalesDocumentForm onDone={onClose} />}
      {kind === "expense_claim" && <ExpenseClaimForm onDone={onClose} />}

      <p className="mt-[var(--space-md)] text-tiny text-content-muted">
        Journals are posted to {provider.name} once the backend supports this action.
      </p>
    </Modal>
  );
}
