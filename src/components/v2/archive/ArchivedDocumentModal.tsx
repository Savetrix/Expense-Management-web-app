"use client";

import { CheckCircle2, Download, Trash2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { beLabel } from "@/lib/bePlaceholder";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";

import { ARCHIVE_REASON_LABELS, type ArchivedDocument } from "./types";

export const formatReceived = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const normalise = (value: string) => value.trim().toLowerCase();

interface ArchivedDocumentModalProps {
  document: ArchivedDocument | null;
  busyAction: string | null;
  onClose: () => void;
  onUnarchive: (doc: ArchivedDocument, opts: { notDuplicate: boolean }) => void;
  onDelete: (doc: ArchivedDocument) => void;
  onDownload: (doc: ArchivedDocument) => void;
}

// Duplicates open as a side-by-side comparison; every other archived row
// opens as a plain detail view. Both share the same secondary actions.
export function ArchivedDocumentModal({ document: doc, busyAction, onClose, onUnarchive, onDelete, onDownload }: ArchivedDocumentModalProps) {
  if (!doc) return null;
  const busy = busyAction !== null;
  const dup = doc.reason === "duplicate" ? doc.duplicate : undefined;
  const matches = dup ? dup.fields.filter((f) => normalise(f.thisValue) === normalise(f.existingValue)).length : 0;
  const total = dup?.fields.length ?? 0;

  const footer = dup ? (
    <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
        Keep archived
      </Button>
      <Button size="sm" disabled={busy} loading={busyAction === "unarchive"} onClick={() => onUnarchive(doc, { notDuplicate: true })}>
        {beLabel("Not a duplicate — unarchive")}
      </Button>
    </div>
  ) : (
    <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
        Close
      </Button>
      <Button size="sm" disabled={busy} loading={busyAction === "unarchive"} onClick={() => onUnarchive(doc, { notDuplicate: false })}>
        {beLabel("Unarchive")}
      </Button>
    </div>
  );

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={dup ? "Compare documents" : "Archived document"}
      widthClassName={dup ? "max-w-2xl" : "max-w-md"}
      footer={footer}
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        {dup ? (
          <>
            <div
              className={`rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-body-sm ${
                matches === total
                  ? "border-status-success-border bg-status-success-bg text-status-success-text"
                  : "border-status-warning-border bg-status-warning-bg text-status-warning-text"
              }`}
            >
              <p className="font-semibold">
                {matches} of {total} fields match
                {matches === total ? " — archived automatically" : " — AI compared the documents"}
              </p>
              <p className="mt-[var(--space-xs)] text-caption">
                {matches === total
                  ? "Vendor, amount, date and reference are identical, so this copy was archived without review."
                  : "Not every detail matched, so the two documents were compared in full before this one was archived. Check the differences below."}
              </p>
            </div>

            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border bg-page">
                <span className="px-[var(--space-sm)] py-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">Field</span>
                <span className="truncate px-[var(--space-sm)] py-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">
                  This document
                </span>
                <span className="truncate px-[var(--space-sm)] py-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">
                  Existing · {dup.existingReference}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border">
                <span className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-secondary">File</span>
                <span className="truncate px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary" title={doc.fileName}>
                  {doc.fileName}
                </span>
                <span className="truncate px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary" title={dup.existingFileName}>
                  {dup.existingFileName}
                </span>
              </div>
              {dup.fields.map((field) => {
                const same = normalise(field.thisValue) === normalise(field.existingValue);
                return (
                  <div key={field.label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border last:border-b-0">
                    <span className="flex flex-col items-start gap-[var(--space-xs)] px-[var(--space-sm)] py-[var(--space-sm)]">
                      <span className="text-caption font-semibold text-content-primary">{field.label}</span>
                      <span className={`inline-flex items-center gap-1 text-tiny font-semibold ${same ? "text-success" : "text-error"}`}>
                        {same ? <CheckCircle2 size={12} strokeWidth={2.5} /> : <XCircle size={12} strokeWidth={2.5} />}
                        {same ? "Match" : "Differs"}
                      </span>
                    </span>
                    <span className="break-words px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">{field.thisValue}</span>
                    <span className="break-words px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">{field.existingValue}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div>
            <ModalDefinitionRow label="File">
              <span className="truncate" title={doc.fileName}>
                {doc.fileName}
              </span>
            </ModalDefinitionRow>
            {doc.vendor && (
              <ModalDefinitionRow label="Vendor">
                <span className="truncate">{doc.vendor}</span>
              </ModalDefinitionRow>
            )}
            <ModalDefinitionRow label="Received">{formatReceived(doc.receivedAt)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Source">{doc.source}</ModalDefinitionRow>
            {doc.amount !== undefined && <ModalDefinitionRow label="Amount">{formatDetailAmount(doc.amount, doc.currency)}</ModalDefinitionRow>}
            <ModalDefinitionRow label="Status">
              <Badge variant="neutral">{ARCHIVE_REASON_LABELS[doc.reason]}</Badge>
            </ModalDefinitionRow>
            <p className="mt-[var(--space-sm)] text-body-sm text-content-secondary">{doc.reasonText}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-[var(--space-sm)] border-t border-border pt-[var(--space-md)]">
          <Button variant="outline" size="sm" disabled={busy} loading={busyAction === "download"} onClick={() => onDownload(doc)}>
            {busyAction !== "download" && <Download size={16} strokeWidth={2.25} />}
            {beLabel("Download original")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onDelete(doc)} className="text-status-danger-text">
            <Trash2 size={16} strokeWidth={2.25} />
            {beLabel("Delete permanently")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
