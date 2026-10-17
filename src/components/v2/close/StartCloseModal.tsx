"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";

import { defaultPeriod, periodName } from "./mockData";
import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, date } from "./closeShared";

interface StartCloseModalProps {
  open: boolean;
  /** End date of the most recent closed period — a new close must start after it. */
  lastClosedEnd?: string;
  onClose: () => void;
  onStart: (start: string, end: string) => void;
}

export function StartCloseModal({ open, lastClosedEnd, onClose, onStart }: StartCloseModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Start a close">
      {open && <StartForm lastClosedEnd={lastClosedEnd} onClose={onClose} onStart={onStart} />}
    </Modal>
  );
}

function StartForm({ lastClosedEnd, onClose, onStart }: Omit<StartCloseModalProps, "open">) {
  const initial = defaultPeriod(new Date(), lastClosedEnd);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [submitted, setSubmitted] = useState(false);

  const error = !start || !end
    ? "Choose a start and end date."
    : end < start
      ? "The end date must be on or after the start date."
      : lastClosedEnd && start <= lastClosedEnd
        ? `This overlaps a closed period. Start after ${date(lastClosedEnd)}, or reopen that period instead.`
        : "";

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        A close creates a working paper for the period. Your team works through the checklist, then someone with the Manage periods
        permission locks it.
      </p>
      <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
        <div>
          <label htmlFor="close-start" className={FIELD_LABEL_CLASS}>
            Period start *
          </label>
          <input id="close-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD_INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor="close-end" className={FIELD_LABEL_CLASS}>
            Period end *
          </label>
          <input id="close-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={FIELD_INPUT_CLASS} />
        </div>
      </div>
      {!error && (
        <p className="text-body-sm text-content-primary">
          Working paper name: <span className="font-semibold">{periodName(start, end)}</span>
        </p>
      )}
      {submitted && error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}
      <div className="flex flex-col-reverse gap-[var(--space-sm)] sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setSubmitted(true);
            if (!error) onStart(start, end);
          }}
        >
          {beLabel("Start close")}
        </Button>
      </div>
    </div>
  );
}
