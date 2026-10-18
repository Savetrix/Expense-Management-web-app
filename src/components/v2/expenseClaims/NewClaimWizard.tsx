"use client";

import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreatableCombobox, Modal, ModalDefinitionRow, ProgressBar } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";

import { FIELD_LABEL_CLASS, claimTotal, localId, money, monthLabel, shortDate, todayIso } from "./shared";
import type { ClaimReceipt, Contact, ExpenseClaim } from "./types";
import type { TeamPerson } from "./useTeamMembers";

interface NewClaimWizardProps {
  open: boolean;
  onClose: () => void;
  receipts: ClaimReceipt[];
  loadingReceipts?: boolean;
  /** Real team members; claimants not on the team can still be added by name. */
  members: TeamPerson[];
  onCreate: (claim: ExpenseClaim) => void;
}

type Step = 1 | 2 | 3;
const STEP_TITLES: Record<Step, string> = { 1: "Select receipts", 2: "Choose claimant", 3: "Review claim" };

export function NewClaimWizard({ open, onClose, receipts, loadingReceipts, members, onCreate }: NewClaimWizardProps) {
  const [extraContacts, setExtraContacts] = useState<Contact[]>([]);
  const contacts = useMemo<Contact[]>(() => [...members.map((m) => ({ id: m.id, name: m.name })), ...extraContacts], [members, extraContacts]);
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimantId, setClaimantId] = useState("");
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setStep(1);
    setSelected(new Set());
    setClaimantId("");
  };

  const close = () => {
    if (creating) return;
    reset();
    onClose();
  };

  const chosen = useMemo(() => receipts.filter((r) => selected.has(r.id)), [receipts, selected]);
  const claimant = contacts.find((c) => c.id === claimantId) ?? null;
  // A claim covers one month — the latest receipt date decides it, the same
  // way automatic grouping files a receipt under the month it's dated.
  const month = useMemo(() => {
    const latest = chosen.map((r) => r.date).sort().pop();
    return latest ? latest.slice(0, 7) : todayIso().slice(0, 7);
  }, [chosen]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAddContact = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Type the claimant's name first, then add it.", "warning");
      return;
    }
    const contact = { id: localId("c"), name: trimmed };
    setExtraContacts((prev) => [...prev, contact]);
    setClaimantId(contact.id);
  };

  const handleCreate = async () => {
    if (!claimant) return;
    setCreating(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const claim: ExpenseClaim = {
      id: localId("cl"),
      claimant: claimant.name,
      month,
      status: "awaiting_review",
      createdAt: todayIso(),
      receipts: chosen,
    };
    onCreate(claim);
    setCreating(false);
    notifyBackendPending("Create claim");
    showToast(`Claim for ${claimant.name} created — it's waiting in Awaiting review.`, "success");
    reset();
    onClose();
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={step === 1 ? close : () => setStep((s) => (s - 1) as Step)} disabled={creating}>
        {step === 1 ? "Cancel" : "Back"}
      </Button>
      {step < 3 ? (
        <Button
          size="sm"
          onClick={() => setStep((s) => (s + 1) as Step)}
          disabled={(step === 1 && chosen.length === 0) || (step === 2 && !claimant)}
        >
          Next
        </Button>
      ) : (
        <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating}>
          {beLabel("Create claim")}
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
              description={loadingReceipts ? "Fetching your scanned invoices." : "Scan or forward receipts first — anything still pending review and not on a claim shows up here."}
            />
          ) : (
            <div className="flex flex-col gap-[var(--space-sm)]">
              <p className="text-body-sm text-content-secondary">Pick the receipts this employee paid for out of pocket.</p>
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
                      <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-[var(--space-xs)] text-caption text-content-secondary">
                      {shortDate(r.date)}{r.glAccount ? ` · ${r.glAccount}` : ""}
                      {r.source && <Badge variant="neutral">{r.source}</Badge>}
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-caption font-semibold text-content-secondary">
                {chosen.length} selected · {money(claimTotal(chosen))}
              </p>
            </div>
          ))}

        {step === 2 && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <label className={FIELD_LABEL_CLASS}>Claimant *</label>
            <CreatableCombobox
              options={contacts.map((c) => ({ id: c.id, label: c.name }))}
              noun="claimant"
              ariaLabel="Claimant"
              value={claimantId}
              onSelect={setClaimantId}
              onAddNew={handleAddContact}
              placeholder="Search team members or type a new name"
              uiSize="md"
            />
            <p className="text-caption text-content-secondary">
              The claim is published as a bill payable to this person. Not on your team? Type their name and add them.
            </p>
          </div>
        )}

        {step === 3 && claimant && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{claimant.name}</ModalDefinitionRow>
              <ModalDefinitionRow label="Month">{monthLabel(month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Receipts">{chosen.length}</ModalDefinitionRow>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {chosen.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                    <span className="block text-caption text-content-secondary">{shortDate(r.date)}</span>
                  </span>
                  <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body font-bold text-content-primary">
              <span>Total</span>
              <span>{money(claimTotal(chosen))}</span>
            </div>
            <p className="text-caption text-content-secondary">The claim is created in Awaiting review. Nothing is published until it&apos;s approved.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
