"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";

import { FIELD_LABEL_CLASS, FIELD_TEXTAREA_CLASS, money } from "./closeShared";

interface JustificationModalProps {
  open: boolean;
  /** What is being reconciled, e.g. an account name. */
  subject: string;
  difference: number;
  onCancel: () => void;
  onConfirm: (justification: string) => void;
}

// Reconciling with an unexplained difference needs a written reason that
// stays on the working paper next to the sign-off.
export function JustificationModal({ open, subject, difference, onCancel, onConfirm }: JustificationModalProps) {
  return (
    <Modal open={open} onClose={onCancel} title="Reconcile with a difference">
      {/* Remount per open so the text never leaks between accounts. */}
      {open && <JustificationForm subject={subject} difference={difference} onCancel={onCancel} onConfirm={onConfirm} />}
    </Modal>
  );
}

function JustificationForm({ subject, difference, onCancel, onConfirm }: Omit<JustificationModalProps, "open">) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const missing = text.trim().length === 0;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        <span className="font-semibold text-content-primary">{subject}</span> has an unexplained difference of{" "}
        <span className="font-semibold text-content-primary">{money(difference)}</span>. Explain why it is acceptable to sign
        off with this difference. The note is kept on the working paper.
      </p>
      <div>
        <label htmlFor="close-justification" className={FIELD_LABEL_CLASS}>
          Justification *
        </label>
        <textarea
          id="close-justification"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Timing difference — supplier statement received after period end"
          className={FIELD_TEXTAREA_CLASS}
        />
        {touched && missing && <p className="mt-[var(--space-xs)] text-caption font-semibold text-status-danger-text">A justification is required.</p>}
      </div>
      <div className="flex flex-col-reverse gap-[var(--space-sm)] sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setTouched(true);
            if (!missing) onConfirm(text.trim());
          }}
        >
          {beLabel("Reconcile")}
        </Button>
      </div>
    </div>
  );
}
