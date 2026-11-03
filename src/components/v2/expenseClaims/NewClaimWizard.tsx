"use client";

import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreatableCombobox, Modal, ModalDefinitionRow, ProgressBar } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { createExpenseClaim, type ClaimContactDto } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";

import { FIELD_LABEL_CLASS, errorMessage, isApprover, money, monthLabel, shortDate, todayIso, type CompanyRole } from "./shared";
import type { TeamPerson } from "./useTeamMembers";

/** A pending scanned invoice that isn't on a claim yet. */
export interface WizardReceipt {
  id: string;
  vendor: string;
  date: string;
  amount: number;
  currency: string | null;
}

interface NewClaimWizardProps {
  open: boolean;
  onClose: () => void;
  receipts: WizardReceipt[];
  loadingReceipts?: boolean;
  members: TeamPerson[];
  /** Claimants outside the team from earlier claims. */
  contacts: ClaimContactDto[];
  role: CompanyRole;
  selfId: string;
  onCreated: () => void;
}

type Step = 1 | 2 | 3;
const STEP_TITLES: Record<Step, string> = { 1: "Select receipts", 2: "Choose claimant", 3: "Review claim" };

// Picker ids: a team member is their userId; a saved contact and a name typed
// just now get these prefixes. A typed name becomes a contact on the server.
const NAME_PREFIX = "name:";
const CONTACT_PREFIX = "contact:";

export function NewClaimWizard({ open, onClose, receipts, loadingReceipts, members, contacts, role, selfId, onCreated }: NewClaimWizardProps) {
  const dispatch = useAppDispatch();
  // Submitters (contributors) claim only for themselves.
  const submitterOnly = !isApprover(role);

  const [typedNames, setTypedNames] = useState<string[]>([]);
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimantKey, setClaimantKey] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const options = useMemo(() => {
    const team = members.filter((m) => !submitterOnly || m.userId === selfId).map((m) => ({ id: m.userId, label: m.name }));
    if (submitterOnly) return team;
    const known = new Set(contacts.map((c) => c.name.toLowerCase()));
    return [
      ...team,
      ...contacts.map((c) => ({ id: `${CONTACT_PREFIX}${c.id}`, label: c.email ? `${c.name} (${c.email})` : c.name })),
      ...typedNames.filter((n) => !known.has(n.toLowerCase())).map((n) => ({ id: `${NAME_PREFIX}${n}`, label: n })),
    ];
  }, [members, contacts, typedNames, submitterOnly, selfId]);

  const effectiveClaimantKey = submitterOnly ? selfId : claimantKey;
  const claimantLabel = options.find((o) => o.id === effectiveClaimantKey)?.label ?? "";

  const reset = () => {
    setStep(1);
    setSelected(new Set());
    setClaimantKey("");
    setNotes({});
  };

  const close = () => {
    if (creating) return;
    reset();
    onClose();
  };

  const chosen = useMemo(() => receipts.filter((r) => selected.has(r.id)), [receipts, selected]);
  const currencies = useMemo(() => [...new Set(chosen.map((r) => r.currency).filter(Boolean))], [chosen]);
  const total = chosen.reduce((sum, r) => sum + r.amount, 0);
  // The server files the claim under the month of its latest receipt.
  const month = useMemo(() => {
    const latest = chosen.map((r) => r.date).filter(Boolean).sort().pop();
    return (latest || todayIso()).slice(0, 7);
  }, [chosen]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAddName = (name: string) => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      showToast("Type the claimant's name first, then add it.", "warning");
      return;
    }
    // Already a contact: pick that one instead of adding a duplicate.
    const existing = contacts.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setClaimantKey(`${CONTACT_PREFIX}${existing.id}`);
      return;
    }
    setTypedNames((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setClaimantKey(`${NAME_PREFIX}${trimmed}`);
  };

  const handleCreate = async () => {
    if (!effectiveClaimantKey) return;
    setCreating(true);
    const claimant = effectiveClaimantKey.startsWith(NAME_PREFIX)
      ? { name: effectiveClaimantKey.slice(NAME_PREFIX.length) }
      : effectiveClaimantKey.startsWith(CONTACT_PREFIX)
        ? { contactId: effectiveClaimantKey.slice(CONTACT_PREFIX.length) }
        : { userId: effectiveClaimantKey };
    const filledNotes = Object.fromEntries(chosen.map((r) => [r.id, (notes[r.id] ?? "").trim()] as const).filter(([, note]) => note));
    const result = await dispatch(createExpenseClaim({ claimant, receiptIds: chosen.map((r) => r.id), notes: filledNotes }));
    setCreating(false);
    if (createExpenseClaim.fulfilled.match(result)) {
      showToast(`Claim for ${result.payload.claimant.name} created — it's waiting in Awaiting review.`, "success");
      reset();
      onClose();
      onCreated();
    } else {
      showToast(errorMessage(result.payload, "Couldn't create the claim."), "error");
    }
  };

  const mixedCurrency = currencies.length > 1;
  const nextDisabled = (step === 1 && (chosen.length === 0 || mixedCurrency)) || (step === 2 && !effectiveClaimantKey);

  const footer = (
    <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={step === 1 ? close : () => setStep((s) => (s - 1) as Step)} disabled={creating}>
        {step === 1 ? "Cancel" : "Back"}
      </Button>
      {step < 3 ? (
        <Button size="sm" onClick={() => setStep((s) => (s + 1) as Step)} disabled={nextDisabled}>
          Next
        </Button>
      ) : (
        <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating}>
          Create claim
        </Button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={close} title="New expense claim" widthClassName="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <div className="flex items-center justify-between text-caption font-semibold text-content-secondary">
            <span>
              Step {step} of 3 · {STEP_TITLES[step]}
            </span>
          </div>
          <div className="mt-[var(--space-xs)]">
            <ProgressBar percent={(step / 3) * 100} label="Wizard progress" />
          </div>
        </div>

        {step === 1 &&
          (receipts.length === 0 ? (
            <EmptyState
              icon={<Inbox size={28} strokeWidth={1.75} />}
              title={loadingReceipts ? "Loading receipts…" : "No receipts to claim"}
              description={
                loadingReceipts
                  ? "Fetching your scanned invoices."
                  : "Scan or forward receipts first — anything still pending review and not on a claim shows up here."
              }
            />
          ) : (
            <div className="flex flex-col gap-[var(--space-sm)]">
              <p className="text-body-sm text-content-secondary">
                {submitterOnly ? "Pick the receipts you paid for out of pocket." : "Pick the receipts this employee paid for out of pocket."}
              </p>
              {receipts.map((r) => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-start gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                    selected.has(r.id) ? "border-accent bg-surface-alt" : "border-border bg-page"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="mt-1 rounded border-border-strong text-accent focus:ring-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-[var(--space-sm)]">
                      <span className="truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                      <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount, r.currency)}</span>
                    </span>
                    <span className="text-caption text-content-secondary">{shortDate(r.date)}</span>
                  </span>
                </label>
              ))}
              {mixedCurrency ? (
                <p className="text-caption font-semibold text-status-danger-text">
                  These receipts are in different currencies ({currencies.join(", ")}). A claim is one bill, so put each currency on its own claim.
                </p>
              ) : (
                <p className="text-caption font-semibold text-content-secondary">
                  {chosen.length} selected · {money(total, currencies[0])}
                </p>
              )}
            </div>
          ))}

        {step === 2 && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <label className={FIELD_LABEL_CLASS}>Claimant *</label>
            {submitterOnly ? (
              <p className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-primary">
                {claimantLabel || "You"}
              </p>
            ) : (
              <CreatableCombobox
                options={options}
                noun="claimant"
                ariaLabel="Claimant"
                value={claimantKey}
                onSelect={setClaimantKey}
                onAddNew={handleAddName}
                placeholder="Search team members and contacts, or type a new name"
                uiSize="md"
              />
            )}
            <p className="text-caption text-content-secondary">
              {submitterOnly
                ? "You can only claim for yourself. Someone with approval rights reviews it."
                : "The claim is published as a bill payable to this person. Not on your team? Type their name — they're saved as a contact for next time."}
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{claimantLabel}</ModalDefinitionRow>
              <ModalDefinitionRow label="Month">{monthLabel(month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Receipts">{chosen.length}</ModalDefinitionRow>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {chosen.map((r) => (
                <div key={r.id} className="flex flex-col gap-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)]">
                  <div className="flex items-center justify-between gap-[var(--space-sm)]">
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                      <span className="block text-caption text-content-secondary">{shortDate(r.date)}</span>
                    </span>
                    <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount, r.currency)}</span>
                  </div>
                  <input
                    type="text"
                    aria-label={`Note for ${r.vendor}`}
                    placeholder="Add a note (optional), e.g. client lunch"
                    maxLength={500}
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-page px-[var(--space-sm)] text-body-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body font-bold text-content-primary">
              <span>Total</span>
              <span>{money(total, currencies[0])}</span>
            </div>
            <p className="text-caption text-content-secondary">The claim is created in Awaiting review. Nothing is published until it&apos;s approved.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
