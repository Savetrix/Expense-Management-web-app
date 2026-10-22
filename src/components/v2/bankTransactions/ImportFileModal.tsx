"use client";

import { FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, SelectDropdown, TextInput } from "@/components/v2/ui";

import { buildRows, detectColumns, parseCsv, splitDuplicates } from "./csv";
import { FIELD_LABEL_CLASS, formatAmount } from "./format";
import type { BankAccount, BankTransaction, ColumnMapping, DateFormat, OutflowMode } from "./types";

interface ImportFileModalProps {
  open: boolean;
  onClose: () => void;
  bankAccounts: BankAccount[];
  existing: BankTransaction[];
  /** Saves the rows on the server; resolves false if that failed (the dialog stays open). */
  onImport: (txns: BankTransaction[]) => Promise<boolean>;
}

type Step = "file" | "map" | "preview";

const MAX_BYTES = 5 * 1024 * 1024;
const NONE = "-1";

let idCounter = 0;
const newId = () => `csv-${Date.now().toString(36)}-${++idCounter}`;

export function ImportFileModal({ open, onClose, bankAccounts, existing, onImport }: ImportFileModalProps) {
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [accountName, setAccountName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({ date: -1, description: -1, amount: -1, debit: -1, credit: -1 });
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [outflowMode, setOutflowMode] = useState<OutflowMode>("negative");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const headers = rows[0] ?? [];
  const dataRows = useMemo(() => rows.slice(1), [rows]);

  const result = useMemo(() => {
    if (step !== "preview") return null;
    const built = buildRows(dataRows, mapping, { dateFormat, outflowMode });
    return { ...built, ...splitDuplicates(built.valid, existing) };
  }, [step, dataRows, mapping, dateFormat, outflowMode, existing]);

  const reset = () => {
    setStep("file");
    setFileName("");
    setRows([]);
    setAccountName("");
    setError("");
    setMapping({ date: -1, description: -1, amount: -1, debit: -1, credit: -1 });
    setDateFormat("YYYY-MM-DD");
    setOutflowMode("negative");
  };
  const close = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (!/\.(csv|txt)$/i.test(file.name) && file.type !== "text/csv") {
      setError("Please choose a .csv file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("This file is larger than 5 MB.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setError("No data rows found. The first row must be column headers.");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    const detected = detectColumns(parsed[0]);
    setMapping(detected);
    setOutflowMode(detected.amount < 0 && (detected.debit >= 0 || detected.credit >= 0) ? "debit" : "negative");
  };

  const mappingProblem =
    mapping.date < 0
      ? "Choose the date column."
      : outflowMode === "debit"
        ? mapping.debit < 0 && mapping.credit < 0
          ? "Choose the debit and/or credit column."
          : ""
        : mapping.amount < 0
          ? "Choose the amount column."
          : "";

  const doImport = async () => {
    if (!result || saving) return;
    const name = accountName.trim() || "Imported file";
    setSaving(true);
    const ok = await onImport(
      result.fresh.map((r) => ({
        id: newId(),
        date: r.date,
        description: r.description,
        accountName: name,
        amount: r.amount,
        status: "review" as const,
        source: "csv" as const,
      })),
    );
    setSaving(false);
    if (ok) close();
  };

  const colSelect = (label: string, key: keyof ColumnMapping) => (
    <SelectDropdown
      label={label}
      value={String(mapping[key])}
      onChange={(e) => setMapping((m) => ({ ...m, [key]: Number(e.target.value) }))}
    >
      <option value={NONE}>Not used</option>
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </SelectDropdown>
  );

  const footer =
    step === "file" ? (
      <Button disabled={rows.length === 0} onClick={() => setStep("map")}>
        Next
      </Button>
    ) : step === "map" ? (
      <>
        <Button variant="outline" onClick={() => setStep("file")}>
          Back
        </Button>
        <Button disabled={Boolean(mappingProblem)} onClick={() => setStep("preview")}>
          Preview
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" onClick={() => setStep("map")}>
          Back
        </Button>
        <Button disabled={!result || result.fresh.length === 0 || saving} onClick={doImport}>
          Import {result?.fresh.length ?? 0} transactions
        </Button>
      </>
    );

  return (
    <Modal open={open} onClose={close} title="Import file" footer={footer} widthClassName="max-w-2xl">
      {step === "file" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void readFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex flex-col items-center gap-[var(--space-sm)] rounded-lg border-2 border-dashed p-[var(--space-lg)] text-center ${
              dragging ? "border-accent bg-surface-alt" : "border-border"
            }`}
          >
            <FileUp size={24} className="text-content-secondary" />
            <p className="text-body-sm text-content-primary">{fileName ? `${fileName} (${dataRows.length} rows)` : "Drop a CSV file here"}</p>
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-caption text-content-secondary">
            Files are read in your browser. Only the dates, descriptions and amounts are saved to Scantrix.
          </p>
          {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}
          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="import-account">
              Account
            </label>
            {bankAccounts.length > 0 && (
              <SelectDropdown
                id="import-account"
                value={bankAccounts.some((a) => `${a.institutionName} ${a.name}` === accountName) ? accountName : ""}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-[var(--space-xs)] w-full"
              >
                <option value="">Type a name below</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={`${a.institutionName} ${a.name}`}>
                    {a.institutionName} {a.name}
                    {a.mask ? ` ····${a.mask}` : ""}
                  </option>
                ))}
              </SelectDropdown>
            )}
            <TextInput
              aria-label="Account name"
              placeholder="Account name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="mt-[var(--space-xs)] w-full"
            />
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="grid gap-[var(--space-md)] sm:grid-cols-2">
            {colSelect("Date column", "date")}
            {colSelect("Description column", "description")}
            {outflowMode === "debit" ? (
              <>
                {colSelect("Debit column (money out)", "debit")}
                {colSelect("Credit column (money in)", "credit")}
              </>
            ) : (
              colSelect("Amount column", "amount")
            )}
            <SelectDropdown label="Date format" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            </SelectDropdown>
          </div>
          <SelectDropdown label="Money out is shown as" value={outflowMode} onChange={(e) => setOutflowMode(e.target.value as OutflowMode)}>
            <option value="negative">Negative numbers</option>
            <option value="debit">A separate debit column</option>
            <option value="positive">Positive numbers (money in is negative)</option>
          </SelectDropdown>
          {mappingProblem && <p className="text-caption font-semibold text-status-danger-text">{mappingProblem}</p>}
        </div>
      )}

      {step === "preview" && result && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-primary">
            {result.valid.length} valid row{result.valid.length === 1 ? "" : "s"}
            {result.duplicates.length > 0 && `, ${result.duplicates.length} already in your list (skipped)`}
            {result.skipped.length > 0 && `, ${result.skipped.length} unreadable`}. {result.fresh.length} will be imported.
          </p>
          {result.fresh.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[420px] text-left text-caption">
                <thead className="bg-page text-tiny uppercase text-content-muted">
                  <tr>
                    <th className="px-[var(--space-sm)] py-[var(--space-xs)]">Date</th>
                    <th className="px-[var(--space-sm)] py-[var(--space-xs)]">Description</th>
                    <th className="px-[var(--space-sm)] py-[var(--space-xs)] text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.fresh.slice(0, 10).map((r) => (
                    <tr key={r.line}>
                      <td className="whitespace-nowrap px-[var(--space-sm)] py-[var(--space-xs)]">{r.date}</td>
                      <td className="max-w-[240px] truncate px-[var(--space-sm)] py-[var(--space-xs)]">{r.description || "—"}</td>
                      <td className="px-[var(--space-sm)] py-[var(--space-xs)] text-right">{formatAmount(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div>
              <p className="text-body-sm font-semibold text-content-primary">Skipped rows</p>
              <ul className="mt-[var(--space-xs)] max-h-32 overflow-y-auto text-caption text-content-secondary">
                {result.skipped.slice(0, 50).map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
