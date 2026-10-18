"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { useGlAccountGroups, useVendorNames } from "./lookups";
import { dateLabel, formatMoney, monthEndOf, todayIso } from "./schedule";
import { FIELD_LABEL_CLASS, NOTE_CLASS, SelectField, StatusBadge, SwitchRow, TextField, VendorField } from "./shared";
import type { Accrual, AccrualReversal } from "./types";

// ── Add accrued expense / adjustment ───────────────────────────────────────

interface AccrualFormState {
  description: string;
  vendor: string;
  amount: string;
  date: string;
  expenseAccount: string;
  liabilityAccount: string;
  trackOnly: boolean;
}

const emptyForm = (): AccrualFormState => ({
  description: "",
  vendor: "",
  amount: "",
  date: monthEndOf(todayIso()),
  expenseAccount: "",
  liabilityAccount: "",
  trackOnly: false,
});

function AccrualFields({ form, setForm, showTrackOnly }: { form: AccrualFormState; setForm: (f: AccrualFormState) => void; showTrackOnly: boolean }) {
  const set = <K extends keyof AccrualFormState>(key: K, value: AccrualFormState[K]) => setForm({ ...form, [key]: value });
  const gl = useGlAccountGroups();
  const vendors = useVendorNames();
  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
        <TextField label="Description *" value={form.description} onChange={(v) => set("description", v)} placeholder="e.g. Contractor hours – October" />
        <VendorField label="Vendor" value={form.vendor} onChange={(v) => set("vendor", v)} vendors={vendors} />
        <TextField label="Amount *" type="number" value={form.amount} onChange={(v) => set("amount", v)} placeholder="0.00" />
        <TextField label="Date" type="date" value={form.date} onChange={(v) => set("date", v)} hint="Usually the last day of the month the cost belongs to." />
        <SelectField label="Expense account" value={form.expenseAccount} onChange={(v) => set("expenseAccount", v)} options={gl.expense} />
        <SelectField label="Liability account" value={form.liabilityAccount} onChange={(v) => set("liabilityAccount", v)} options={gl.accrualLiability} />
      </div>
      {showTrackOnly && (
        <SwitchRow
          label="Track only (already posted)"
          description="The journal is already in your books — Scantrix just tracks it until the bill arrives."
          control={<Switch checked={form.trackOnly} onChange={(v) => set("trackOnly", v)} label="Track only" />}
        />
      )}
    </div>
  );
}

function validate(form: AccrualFormState): string {
  if (!form.description.trim()) return "Description is required.";
  if (!(Number(form.amount) > 0)) return "Amount must be greater than zero.";
  if (!form.date) return "Choose a date.";
  if (!form.expenseAccount || !form.liabilityAccount) return "Choose the expense and liability accounts.";
  return "";
}

function toAccrual(form: AccrualFormState): Accrual {
  return {
    id: `ac-${Date.now()}`,
    description: form.description.trim(),
    vendor: form.vendor.trim() || "—",
    amount: Number(form.amount),
    date: form.date,
    expenseAccount: form.expenseAccount,
    liabilityAccount: form.liabilityAccount,
    status: "active",
    origin: "manual",
    trackOnly: form.trackOnly,
  };
}

export function AddAccrualModal({ onClose, onCreate }: { onClose: () => void; onCreate: (accrual: Accrual) => void }) {
  const provider = useActiveProvider();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const create = () => {
    const err = validate(form);
    if (err) return setError(err);
    notifyBackendPending("Create");
    onCreate(toAccrual(form));
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add accrued expense"
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={create}>
            {beLabel("Create")}
          </Button>
        </>
      }
    >
      <AccrualFields form={form} setForm={setForm} showTrackOnly />
      {error && <p className="mt-[var(--space-sm)] text-caption font-semibold text-status-danger-text">{error}</p>}
      <p className={`mt-[var(--space-md)] ${NOTE_CLASS}`}>
        {form.trackOnly
          ? "Nothing new posts — the accrual is tracked so its reversal can be matched when the bill arrives."
          : `An accrual journal posts to ${provider.name} on the date above and is reversed when the bill arrives.`}
      </p>
    </Modal>
  );
}

export function AddAdjustmentModal({
  activeAccruals,
  onClose,
  onCreate,
  onReverse,
}: {
  activeAccruals: Accrual[];
  onClose: () => void;
  onCreate: (accrual: Accrual) => void;
  onReverse: (accrualId: string, reversal: Omit<AccrualReversal, "id" | "accrualId" | "description">) => void;
}) {
  const [isReversal, setIsReversal] = useState(activeAccruals.length > 0);
  const [form, setForm] = useState(emptyForm);
  const [originalId, setOriginalId] = useState(activeAccruals[0]?.id ?? "");
  const original = activeAccruals.find((a) => a.id === originalId);
  const [reversalDate, setReversalDate] = useState(todayIso());
  const [billRef, setBillRef] = useState("");
  const [error, setError] = useState("");

  const create = () => {
    if (isReversal) {
      if (!original) return setError("Pick the accrual you're reversing.");
      notifyBackendPending("Create");
      onReverse(original.id, { amount: original.amount, date: reversalDate, billRef: billRef.trim() || undefined });
    } else {
      const err = validate(form);
      if (err) return setError(err);
      notifyBackendPending("Create");
      onCreate(toAccrual(form));
    }
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add adjustment"
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={create}>
            {beLabel("Create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <label className="flex items-center gap-[var(--space-sm)] text-body-sm font-semibold text-content-primary">
          <input
            type="checkbox"
            checked={isReversal}
            onChange={(e) => setIsReversal(e.target.checked)}
            disabled={activeAccruals.length === 0}
            className="rounded border-border-strong text-accent focus:ring-accent"
          />
          This is an accrual reversal
        </label>

        {isReversal ? (
          <>
            <SelectField
              label="Original accrual"
              value={originalId}
              onChange={setOriginalId}
              options={activeAccruals.map((a) => ({ value: a.id, label: `${a.description} · ${formatMoney(a.amount)}` }))}
            />
            {original && (
              <div className="rounded-md border border-border px-[var(--space-md)]">
                <ModalDefinitionRow label="Accrued on">{dateLabel(original.date)}</ModalDefinitionRow>
                <ModalDefinitionRow label="Expense account">{original.expenseAccount}</ModalDefinitionRow>
                <ModalDefinitionRow label="Reversal amount">{formatMoney(original.amount)}</ModalDefinitionRow>
              </div>
            )}
            <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
              <TextField label="Reversal date" type="date" value={reversalDate} onChange={setReversalDate} />
              <TextField label="Matching bill (optional)" value={billRef} onChange={setBillRef} placeholder="e.g. BILL-2350" />
            </div>
            <p className={NOTE_CLASS}>The reversal is grouped into this quarter&apos;s reversal batch and the accrual moves to Completed.</p>
          </>
        ) : (
          <>
            {activeAccruals.length === 0 && <p className="text-caption text-content-secondary">There are no active accruals to reverse, so this adds a new accrual instead.</p>}
            <AccrualFields form={form} setForm={setForm} showTrackOnly={false} />
          </>
        )}
        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}
      </div>
    </Modal>
  );
}

// ── Detail ─────────────────────────────────────────────────────────────────

export function AccrualDetailModal({
  accrual,
  reversal,
  onClose,
  onChange,
}: {
  accrual: Accrual;
  reversal?: AccrualReversal;
  onClose: () => void;
  onChange: (accrual: Accrual) => void;
}) {
  const provider = useActiveProvider();
  const archive = async () => {
    if (accrual.status === "active" && !accrual.trackOnly) {
      const ok = await confirmDialog({
        title: "Archive this accrual?",
        message: `A reversing journal will be posted in ${provider.name} and the accrual will stop being tracked.`,
        confirmLabel: beLabel("Archive"),
        tone: "destructive",
      });
      if (!ok) return;
    }
    notifyBackendPending("Archive");
    onChange({ ...accrual, status: "archived" });
    onClose();
  };
  const unarchive = () => {
    notifyBackendPending("Unarchive");
    onChange({ ...accrual, status: accrual.origin === "suggested" ? "review" : "active" });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Accrued expense"
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {accrual.status === "active" && (
            <Button variant="outline" size="sm" onClick={archive}>
              {beLabel("Archive")}
            </Button>
          )}
          {accrual.status === "archived" && (
            <Button size="sm" onClick={unarchive}>
              {beLabel("Unarchive")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-h3 font-bold text-content-primary">{accrual.description}</p>
            <p className="text-body-sm text-content-secondary">{accrual.vendor}</p>
          </div>
          <StatusBadge status={accrual.status} />
        </div>
        <div className="rounded-md border border-border px-[var(--space-md)]">
          <ModalDefinitionRow label="Amount">{formatMoney(accrual.amount)}</ModalDefinitionRow>
          <ModalDefinitionRow label="Accrued on">{dateLabel(accrual.date)}</ModalDefinitionRow>
          <ModalDefinitionRow label="Expense account">{accrual.expenseAccount}</ModalDefinitionRow>
          <ModalDefinitionRow label="Liability account">{accrual.liabilityAccount}</ModalDefinitionRow>
          <ModalDefinitionRow label="Posting">{accrual.trackOnly ? "Track only (already posted)" : `Posted by Scantrix`}</ModalDefinitionRow>
          {reversal && (
            <ModalDefinitionRow label="Reversed">
              {dateLabel(reversal.date)}
              {reversal.billRef ? ` · ${reversal.billRef}` : ""}
            </ModalDefinitionRow>
          )}
        </div>
        {accrual.basis && (
          <div>
            <p className={FIELD_LABEL_CLASS}>Why it was suggested</p>
            <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">{accrual.basis}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
