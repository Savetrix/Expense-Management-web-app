"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";

import type { AgedContact } from "./mockData";
import { FIELD_LABEL_CLASS, FIELD_TEXTAREA_CLASS, FILE_INPUT_CLASS, TABLE_HEADER_CLASS, date, money, signOffText } from "./closeShared";

interface ContactReviewModalProps {
  contact: AgedContact | null;
  onClose: () => void;
  onResolve: (contactId: string, note: string, attachmentName?: string) => void;
}

export const FLAG_REASON: Record<NonNullable<AgedContact["flag"]>, string> = {
  overdue: "Invoices more than 3 months overdue",
  negative: "Negative balance",
};

// Review of one flagged (or any) contact: their open items, plus a written
// resolution and optional evidence that clears the flag.
export function ContactReviewModal({ contact, onClose, onResolve }: ContactReviewModalProps) {
  return (
    <Modal open={!!contact} onClose={onClose} title={contact ? `Review ${contact.contact}` : "Review"} widthClassName="max-w-2xl">
      {contact && <ReviewBody key={contact.id} contact={contact} onClose={onClose} onResolve={onResolve} />}
    </Modal>
  );
}

function ReviewBody({ contact, onClose, onResolve }: { contact: AgedContact } & Omit<ContactReviewModalProps, "contact">) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<string | undefined>();
  const [error, setError] = useState("");
  const total = contact.openItems.reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      {contact.flag && (
        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <Badge variant="error">Flag</Badge>
          <span className="text-body-sm text-content-secondary">{FLAG_REASON[contact.flag]}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[460px] border-collapse text-left">
          <thead className="border-b border-border bg-page">
            <tr>
              <th className={TABLE_HEADER_CLASS}>Number</th>
              <th className={TABLE_HEADER_CLASS}>Date</th>
              <th className={TABLE_HEADER_CLASS}>Due</th>
              <th className={`${TABLE_HEADER_CLASS} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contact.openItems.map((item) => (
              <tr key={item.id}>
                <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption font-semibold text-content-primary">{item.number}</td>
                <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">{date(item.date)}</td>
                <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">{date(item.dueDate)}</td>
                <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(item.amount)}</td>
              </tr>
            ))}
            <tr className="bg-page">
              <td colSpan={3} className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption font-bold text-content-primary">
                Total open
              </td>
              <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption font-bold text-content-primary">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {contact.resolution ? (
        <div className="rounded-md border border-border bg-page p-[var(--space-md)]">
          <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
            <Badge variant="success">Resolved</Badge>
            <span className="text-caption text-content-secondary">{signOffText("Resolved", contact.resolution)}</span>
          </div>
          <p className="mt-[var(--space-sm)] text-body-sm text-content-primary">{contact.resolution.note}</p>
          {contact.resolution.attachmentName && (
            <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Attachment: {contact.resolution.attachmentName}</p>
          )}
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="contact-resolution" className={FIELD_LABEL_CLASS}>
              Resolution note *
            </label>
            <textarea
              id="contact-resolution"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError("");
              }}
              placeholder="e.g. Disputed invoices — supplier confirmed credit note to follow"
              className={FIELD_TEXTAREA_CLASS}
            />
            {error && <p className="mt-[var(--space-xs)] text-caption font-semibold text-status-danger-text">{error}</p>}
          </div>
          <div>
            <label htmlFor="contact-attachment" className={FIELD_LABEL_CLASS}>
              Attachment (optional)
            </label>
            <input
              id="contact-attachment"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0]?.name)}
              className={FILE_INPUT_CLASS}
            />
          </div>
        </>
      )}

      <div className="flex flex-col-reverse gap-[var(--space-sm)] sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          {contact.resolution ? "Close" : "Cancel"}
        </Button>
        {!contact.resolution && (
          <Button
            size="sm"
            onClick={() => {
              if (!note.trim()) {
                setError("Add a note explaining how this was resolved.");
                return;
              }
              onResolve(contact.id, note.trim(), file);
            }}
          >
            {beLabel("Resolve")}
          </Button>
        )}
      </div>
    </div>
  );
}
