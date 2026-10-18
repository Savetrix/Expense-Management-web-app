"use client";

import { CheckCircle2, FileStack } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import { formatPlainDate } from "@/lib/plainDate";
import { Modal, ProgressBar } from "@/components/v2/ui";

import type { UnpostedInvoice } from "./types";

type Step = 1 | 2 | 3 | "done";

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: "Pick the documents",
  2: "Choose the primary",
  3: "Review and merge",
};

const formatDate = (iso: string) => formatPlainDate(iso, { month: "short", day: "numeric", year: "numeric" });

interface MergeDocumentsModalProps {
  open: boolean;
  invoices: UnpostedInvoice[];
  onClose: () => void;
  /** Called once the (mock) merge succeeds. */
  onMerged: (primary: UnpostedInvoice, merged: UnpostedInvoice[]) => void;
  onViewMerged: () => void;
}

export function MergeDocumentsModal({ open, invoices, onClose, onMerged, onViewMerged }: MergeDocumentsModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<{ primary: UnpostedInvoice; count: number } | null>(null);

  const picked = invoices.filter((i) => pickedIds.includes(i.id));
  const primary = picked.find((i) => i.id === primaryId) ?? null;
  const others = picked.filter((i) => i.id !== primaryId);

  const reset = () => {
    setStep(1);
    setPickedIds([]);
    setPrimaryId(null);
    setMerging(false);
    setResult(null);
  };

  const close = () => {
    if (merging) return;
    reset();
    onClose();
  };

  const togglePick = (id: string) => {
    setPickedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    if (primaryId === id) setPrimaryId(null);
  };

  const goToPrimary = () => {
    if (!primaryId || !pickedIds.includes(primaryId)) {
      // Default to the one with an amount — usually the real invoice page.
      const best = [...picked].sort((a, b) => b.amount - a.amount)[0];
      setPrimaryId(best?.id ?? null);
    }
    setStep(2);
  };

  const merge = () => {
    if (!primary) return;
    setMerging(true);
    notifyBackendPending("Merge");
    window.setTimeout(() => {
      onMerged(primary, others);
      setResult({ primary, count: others.length });
      setMerging(false);
      setStep("done");
    }, 600);
  };

  const footer =
    step === "done" ? (
      <>
        <Button variant="outline" size="sm" onClick={close}>
          Done
        </Button>
        <Button
          size="sm"
          onClick={() => {
            close();
            onViewMerged();
          }}
        >
          View Merged tab
        </Button>
      </>
    ) : (
      <div className="flex w-full flex-wrap justify-between gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" disabled={merging} onClick={step === 1 ? close : () => setStep((s) => (s === 3 ? 2 : 1))}>
          {step === 1 ? "Cancel" : "Back"}
        </Button>
        {step === 1 && (
          <Button size="sm" disabled={pickedIds.length < 2} onClick={goToPrimary}>
            Next
          </Button>
        )}
        {step === 2 && (
          <Button size="sm" disabled={!primary} onClick={() => setStep(3)}>
            Next
          </Button>
        )}
        {step === 3 && (
          <Button size="sm" loading={merging} disabled={merging || !primary} onClick={merge}>
            {beLabel("Merge")}
          </Button>
        )}
      </div>
    );

  const stepNumber = step === "done" ? 3 : step;

  return (
    <Modal open={open} onClose={close} title="Merge documents" widthClassName="max-w-lg" footer={footer}>
      {step === "done" && result ? (
        <div className="flex flex-col items-center py-[var(--space-lg)] text-center">
          <span className="mb-[var(--space-md)] flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 size={30} strokeWidth={1.75} />
          </span>
          <p className="text-h3 font-bold text-content-primary">Documents merged</p>
          <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-content-secondary">
            {result.count} {result.count === 1 ? "document was" : "documents were"} merged into {result.primary.reference}. Their attachments
            now sit on the primary, and the originals are in the Merged tab.
          </p>
        </div>
      ) : invoices.length < 2 ? (
        <EmptyState
          icon={<FileStack size={28} strokeWidth={1.75} />}
          title="Nothing to merge"
          description="You need at least two unposted documents to merge. Published documents can't be merged."
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div>
            <div className="mb-[var(--space-xs)] flex items-center justify-between text-caption text-content-secondary">
              <span className="font-semibold text-content-primary">{STEP_TITLES[stepNumber]}</span>
              <span>Step {stepNumber} of 3</span>
            </div>
            <ProgressBar percent={(stepNumber / 3) * 100} label="Merge progress" colorClassName="bg-primary" />
          </div>

          {step === 1 && (
            <>
              <p className="text-body-sm text-content-secondary">
                Select two or more unposted documents that belong to the same transaction — for example an invoice and its second
                page, or an invoice and its timesheet.
              </p>
              <ul className="flex flex-col gap-[var(--space-sm)]">
                {invoices.map((inv) => {
                  const checked = pickedIds.includes(inv.id);
                  return (
                    <li key={inv.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-[var(--space-md)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                          checked ? "border-border-strong bg-surface-alt" : "border-border bg-surface hover:bg-surface-alt"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePick(inv.id)}
                          className="rounded border-border-strong text-accent focus:ring-accent"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm font-semibold text-content-primary">
                            {inv.vendor} · {inv.reference}
                          </span>
                          <span className="block truncate text-caption text-content-secondary">
                            {inv.fileName} · {formatDate(inv.date)}
                          </span>
                        </span>
                        <span className="shrink-0 text-caption font-semibold text-content-primary">
                          {inv.amount > 0 ? formatDetailAmount(inv.amount, inv.currency) : "—"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-caption text-content-secondary">{pickedIds.length} selected</p>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-body-sm text-content-secondary">
                The primary document keeps its details and becomes the one you review and publish. The rest are attached to it.
              </p>
              <ul className="flex flex-col gap-[var(--space-sm)]" role="radiogroup" aria-label="Primary document">
                {picked.map((inv) => {
                  const checked = primaryId === inv.id;
                  return (
                    <li key={inv.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-[var(--space-md)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                          checked ? "border-border-strong bg-surface-alt" : "border-border bg-surface hover:bg-surface-alt"
                        }`}
                      >
                        <input
                          type="radio"
                          name="merge-primary"
                          checked={checked}
                          onChange={() => setPrimaryId(inv.id)}
                          className="border-border-strong text-accent focus:ring-accent"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm font-semibold text-content-primary">{inv.reference}</span>
                          <span className="block truncate text-caption text-content-secondary">{inv.fileName}</span>
                        </span>
                        {checked && <Badge variant="success">Primary</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === 3 && primary && (
            <>
              <div className="rounded-md border border-border bg-page p-[var(--space-md)]">
                <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Primary</p>
                <p className="mt-[var(--space-xs)] text-body-sm font-semibold text-content-primary">
                  {primary.vendor} · {primary.reference}
                </p>
                <p className="text-caption text-content-secondary">
                  {formatDate(primary.date)} · {primary.amount > 0 ? formatDetailAmount(primary.amount, primary.currency) : "No amount"}
                </p>
                <p className="mt-[var(--space-md)] text-tiny font-bold uppercase tracking-wider text-content-muted">Merged into it ({others.length})</p>
                <ul className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)]">
                  {others.map((inv) => (
                    <li key={inv.id} className="truncate text-caption text-content-primary">
                      {inv.reference} — {inv.fileName}
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="flex list-disc flex-col gap-[var(--space-xs)] pl-[var(--space-lg)] text-body-sm text-content-secondary">
                <li>
                  {others.reduce((acc, inv) => acc + inv.attachments, 0)} attachment(s) move to {primary.reference}, for{" "}
                  {others.reduce((acc, inv) => acc + inv.attachments, 0) + primary.attachments} in total.
                </li>
                <li>The other documents are archived with a reference to {primary.reference}.</li>
                <li>You can unarchive a merged document later from the Merged tab.</li>
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
