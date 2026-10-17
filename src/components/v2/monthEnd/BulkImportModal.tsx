"use client";

import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { DataTable, Modal } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";

import { AMORTISATION_COPY } from "./amortisationCopy";
import { mockImportRows } from "./mockData";
import { formatMoney, rangeLabel } from "./schedule";
import { NOTE_CLASS, StepIndicator } from "./shared";
import type { AmortisationItem, AmortisationKind } from "./types";

type ImportRow = AmortisationItem & { error?: string };

const STEPS = ["Template", "Upload", "Preview", "Import"];

interface Props {
  kind: AmortisationKind;
  onClose: () => void;
  onImport: (items: AmortisationItem[]) => void;
}

export function BulkImportModal({ kind, onClose, onImport }: Props) {
  const copy = AMORTISATION_COPY[kind];
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const valid = rows.filter((r) => !r.error);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    // The real parser will run server-side; this mock always yields 5 rows.
    setRows(mockImportRows(kind));
    setStep(2);
  };

  const runImport = () => {
    notifyBackendPending(`Import ${valid.length} rows`);
    onImport(valid.map((r) => ({ ...r, error: undefined })));
    showToast(`${valid.length} ${copy.title.toLowerCase()} added to To review.`, "success");
    onClose();
  };

  const columns: DataTableColumn<ImportRow>[] = [
    {
      key: "check",
      header: "",
      width: "36px",
      render: (r) =>
        r.error ? (
          <AlertCircle size={16} className="text-status-danger-text" aria-label="Has an error" />
        ) : (
          <CheckCircle2 size={16} className="text-success" aria-label="Valid" />
        ),
    },
    {
      key: "description",
      header: "Description",
      width: "190px",
      render: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-bold">{r.description}</span>
          {r.error && <span className="block truncate text-tiny font-semibold text-status-danger-text">{r.error} — excluded</span>}
        </div>
      ),
    },
    { key: "party", header: copy.partyLabel, width: "140px", render: (r) => <span className="block truncate text-content-secondary">{r.party}</span> },
    { key: "amount", header: "Amount", width: "100px", align: "right", render: (r) => formatMoney(r.total) },
    { key: "opening", header: "Opening", width: "100px", align: "right", render: (r) => formatMoney(r.openingBalance) },
    { key: "range", header: "Start – end", width: "160px", render: (r) => <span className="block truncate">{rangeLabel(r.startDate, r.endDate)}</span> },
    { key: "account", header: copy.pnlAccountLabel, width: "170px", render: (r) => <span className="block truncate text-content-secondary">{r.pnlAccount || "—"}</span> },
  ];

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
        <Button size="sm" onClick={() => setStep(3)} disabled={valid.length === 0}>
          Next
        </Button>
      )}
      {step === 3 && (
        <Button size="sm" onClick={runImport}>
          {beLabel(`Import ${valid.length} rows`)}
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
        <div className="flex flex-col gap-[var(--space-sm)]">
          <p className="text-body-sm text-content-secondary">
            <span className="font-semibold text-content-primary">{fileName}</span> · {rows.length} rows found, {valid.length} ready,{" "}
            {rows.length - valid.length} with errors. Rows with errors are left out — fix them in the file and import them again later.
          </p>
          <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} maxHeightClassName="max-h-[360px]" />
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-primary">
            Ready to import <span className="font-bold">{valid.length}</span> {copy.title.toLowerCase()} totalling{" "}
            <span className="font-bold">{formatMoney(valid.reduce((s, r) => s + r.total, 0))}</span>.
          </p>
          <p className={NOTE_CLASS}>Imported items land in To review. Nothing posts until you publish each schedule.</p>
        </div>
      )}
    </Modal>
  );
}
