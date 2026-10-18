"use client";

import { CheckCircle2, Download, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { AMORTISATION_COPY } from "./amortisationCopy";
import { NOTE_CLASS, StepIndicator } from "./shared";
import type { AmortisationKind } from "./types";

const STEPS = ["Template", "Upload", "Validate"];

interface Props {
  kind: AmortisationKind;
  onClose: () => void;
}

// The uploaded file can't be parsed in the browser: rows are read and
// validated by the backend, so this wizard stops once the file is chosen.
export function BulkImportModal({ kind, onClose }: Props) {
  const copy = AMORTISATION_COPY[kind];
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setStep(2);
  };

  const footer = (
    <div className="flex w-full flex-wrap justify-between gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
        {step === 0 ? "Cancel" : "Back"}
      </Button>
      {step === 0 && (
        <Button size="sm" onClick={() => setStep(1)}>
          Next
        </Button>
      )}
      {step === 2 && (
        <Button
          size="sm"
          onClick={() => {
            notifyBackendPending(`Import ${fileName}`);
            onClose();
          }}
        >
          {beLabel("Send for validation")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Bulk import ${copy.title.toLowerCase()}`} widthClassName="max-w-3xl" footer={footer}>
      <StepIndicator steps={STEPS} current={step} />

      {step === 0 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">
            Bring existing {copy.title.toLowerCase()} into Scantrix in one go. Start from our CSV template so every column lines up — one row per{" "}
            {copy.singular}, with description, {copy.partyLabel.toLowerCase()}, amount, opening balance, start, end and release-from dates, and the{" "}
            {copy.pnlAccountLabel.toLowerCase()}.
          </p>
          <div>
            <Button variant="outline" size="sm" onClick={() => notifyBackendPending("Download template")}>
              <Download size={16} strokeWidth={2.25} />
              {beLabel("Download template")}
            </Button>
          </div>
          <p className={NOTE_CLASS}>For items already partly released, fill in the opening balance and release-from date so earlier periods are tracked but not posted twice.</p>
        </div>
      )}

      {step === 1 && (
        <label className="flex cursor-pointer flex-col items-center gap-[var(--space-sm)] rounded-lg border-2 border-dashed border-border bg-page p-[var(--space-xl)] text-center hover:bg-surface-alt">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt text-content-secondary">
            <Upload size={22} strokeWidth={2} />
          </span>
          <span className="text-body-sm font-semibold text-content-primary">Choose a CSV or Excel file</span>
          <span className="text-caption text-content-secondary">Use the filled-in template from step 1</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      )}

      {step === 2 && (
        <div className="flex flex-col items-center gap-[var(--space-sm)] py-[var(--space-lg)] text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt text-success">
            <CheckCircle2 size={22} strokeWidth={2} />
          </span>
          <p className="text-body-sm font-semibold text-content-primary">File received — rows are validated by the backend {beLabel("").trim()}</p>
          <p className="text-caption text-content-secondary">{fileName}</p>
          <p className="max-w-md text-caption text-content-secondary">
            Valid rows land in To review once the backend has read the file. Rows with errors are reported back so you can fix them and import again.
          </p>
        </div>
      )}
    </Modal>
  );
}
