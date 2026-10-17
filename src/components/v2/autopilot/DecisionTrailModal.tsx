"use client";

import { CheckCircle2, FileSearch, History, ListChecks, Store, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { beLabel } from "@/lib/bePlaceholder";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";

import { CHECK_LABELS, type AutopilotDocument } from "./mockData";
import { formatPlainDate } from "@/lib/plainDate";

export const formatShortDate = (iso: string) => formatPlainDate(iso, { month: "short", day: "numeric", year: "numeric" });

interface DecisionTrailModalProps {
  document: AutopilotDocument | null;
  /** "review" = Needs review actions; "published" = read-only with undo. */
  mode: "review" | "published";
  busyAction: string | null;
  onClose: () => void;
  onApprove?: (doc: AutopilotDocument) => void;
  onArchive?: (doc: AutopilotDocument) => void;
  onOpenInvoice?: (doc: AutopilotDocument) => void;
  onUndoPublish?: (doc: AutopilotDocument) => void;
}

function TrailStep({ icon, title, last, children }: { icon: ReactNode; title: string; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-[var(--space-md)] pb-[var(--space-md)]">
      {!last && <span aria-hidden className="absolute top-9 bottom-0 left-[17px] w-px bg-border" />}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-alt text-content-secondary">{icon}</span>
      <div className="min-w-0 flex-1 pt-[var(--space-xs)]">
        <p className="text-body-sm font-semibold text-content-primary">{title}</p>
        <div className="mt-[var(--space-xs)] text-caption text-content-secondary">{children}</div>
      </div>
    </li>
  );
}

// Shared by Needs review (actionable) and Autopublished (read-only): shows
// the step-by-step reasoning behind the publish decision.
export function DecisionTrailModal({
  document: doc,
  mode,
  busyAction,
  onClose,
  onApprove,
  onArchive,
  onOpenInvoice,
  onUndoPublish,
}: DecisionTrailModalProps) {
  if (!doc) return null;
  const allPassed = doc.checks.every((c) => c.passed);
  const busy = busyAction !== null;

  const footer =
    mode === "review" ? (
      <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" disabled={busy} loading={busyAction === "archive"} onClick={() => onArchive?.(doc)}>
          {beLabel("Archive")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenInvoice?.(doc)}>
          Open invoice
        </Button>
        <Button size="sm" disabled={busy} loading={busyAction === "approve"} onClick={() => onApprove?.(doc)}>
          {beLabel("Approve & publish")}
        </Button>
      </div>
    ) : (
      <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
          Close
        </Button>
        <Button variant="danger" size="sm" disabled={busy} loading={busyAction === "undo"} onClick={() => onUndoPublish?.(doc)}>
          {beLabel("Undo publish")}
        </Button>
      </div>
    );

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={mode === "review" ? "Why this needs you" : "How this was published"}
      widthClassName="max-w-lg"
      footer={footer}
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <ModalDefinitionRow label="Vendor">
            <span className="truncate">{doc.vendor}</span>
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Reference">
            {doc.reference} · {doc.documentType}
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Date">{formatShortDate(doc.date)}</ModalDefinitionRow>
          <ModalDefinitionRow label="Total">{formatDetailAmount(doc.total, doc.currency)}</ModalDefinitionRow>
          <ModalDefinitionRow label="GL account">
            <span className="truncate">{doc.glAccount}</span>
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Tax code">{doc.taxCode}</ModalDefinitionRow>
          {mode === "published" && (
            <ModalDefinitionRow label="Published by">
              {doc.publishedBy === "autopilot" ? <Badge variant="success">Autopilot</Badge> : doc.publishedByName ?? "You"}
            </ModalDefinitionRow>
          )}
        </div>

        <div>
          <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">Decision trail</p>
          <ol>
            <TrailStep icon={<FileSearch size={18} strokeWidth={2} />} title="Read the document">
              {doc.trail.read}
            </TrailStep>
            <TrailStep icon={<History size={18} strokeWidth={2} />} title="Compared previous coding">
              {doc.trail.compared}
            </TrailStep>
            <TrailStep icon={<Store size={18} strokeWidth={2} />} title="Checked the vendor">
              {doc.trail.vendor}
            </TrailStep>
            <TrailStep icon={<ListChecks size={18} strokeWidth={2} />} title="Checks result" last>
              <p className="mb-[var(--space-sm)]">
                {allPassed
                  ? "All three checks passed, so it was safe to publish without review."
                  : `${doc.checks.filter((c) => !c.passed).length} of 3 checks didn't pass, so it was held for a person.`}
              </p>
              <ul className="flex flex-col gap-[var(--space-sm)]">
                {doc.checks.map((check) => (
                  <li key={check.id} className="flex items-start gap-[var(--space-sm)] rounded-md border border-border bg-page p-[var(--space-sm)]">
                    {check.passed ? (
                      <CheckCircle2 size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-success" />
                    ) : (
                      <XCircle size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-error" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
                        <span className="text-body-sm font-semibold text-content-primary">{CHECK_LABELS[check.id]}</span>
                        <Badge variant={check.passed ? "success" : "error"}>{check.passed ? "Passed" : "Failed"}</Badge>
                      </div>
                      <p className="mt-[var(--space-xs)] text-caption text-content-secondary">{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </TrailStep>
          </ol>
        </div>
      </div>
    </Modal>
  );
}
