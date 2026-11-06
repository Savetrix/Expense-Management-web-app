"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { beLabel } from "@/lib/bePlaceholder";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";

import type { AutopilotDocument } from "./types";
import { formatPlainDate } from "@/lib/plainDate";

export const formatShortDate = (iso?: string | null) => formatPlainDate(iso, { month: "short", day: "numeric", year: "numeric" });

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
            {doc.reference}
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Date">{formatShortDate(doc.date)}</ModalDefinitionRow>
          <ModalDefinitionRow label="Total">{formatDetailAmount(doc.total, doc.currency)}</ModalDefinitionRow>
          <ModalDefinitionRow label="GL account">
            <span className="truncate">{doc.glAccount ?? "—"}</span>
          </ModalDefinitionRow>
          {mode === "published" && (
            <ModalDefinitionRow label="Published by">
              {doc.publishedBy === "autopilot" ? <Badge variant="success">Autopilot</Badge> : doc.publishedByName ?? "You"}
            </ModalDefinitionRow>
          )}
        </div>

        <div>
          <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">Decision trail</p>
          <p className="text-caption text-content-secondary">
            The step-by-step reasoning (the read, the comparison with past postings and the vendor check) arrives from the backend
            once Autopilot is connected (BE).
          </p>
        </div>
      </div>
    </Modal>
  );
}
