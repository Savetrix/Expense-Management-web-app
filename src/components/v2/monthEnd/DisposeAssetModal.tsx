"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, Modal, ModalDefinitionRow } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { disposalFigures, disposalJournal } from "./assetMath";
import type { JournalLine } from "./assetMath";
import { ACCOUNTS } from "./mockData";
import { dateLabel, formatMoney, round2, todayIso } from "./schedule";
import { NOTE_CLASS, SelectField, StepIndicator, TextField } from "./shared";
import type { FixedAsset } from "./types";

const STEPS = ["Disposal details", "Gain or loss", "Journal preview"];

interface Props {
  asset: FixedAsset;
  onClose: () => void;
  onDisposed: (asset: FixedAsset) => void;
}

export function DisposeAssetModal({ asset, onClose, onDisposed }: Props) {
  const provider = useActiveProvider();
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [proceeds, setProceeds] = useState("0");
  const [proceedsAccount, setProceedsAccount] = useState<string>(ACCOUNTS.proceeds[0]);
  const [gainLossAccount, setGainLossAccount] = useState<string>(ACCOUNTS.gainLoss[0]);
  const [error, setError] = useState("");

  const proceedsNum = Math.max(0, Number(proceeds) || 0);
  const figures = disposalFigures(asset, date, proceedsNum);
  const journal = disposalJournal(asset, figures, proceedsNum, proceedsAccount, gainLossAccount);
  const totalDebit = round2(journal.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(journal.reduce((s, l) => s + l.credit, 0));

  const next = () => {
    if (step === 0) {
      if (!date) return setError("Choose a disposal date.");
      if (date < asset.acquisitionDate) return setError("Disposal date can't be before the acquisition date.");
    }
    setError("");
    setStep((s) => s + 1);
  };

  const dispose = () => {
    notifyBackendPending("Dispose asset");
    onDisposed({ ...asset, status: "completed", disposal: { date, proceeds: proceedsNum, proceedsAccount, gainLossAccount } });
    showToast(`${asset.description} disposed.`, "success");
    onClose();
  };

  const columns: DataTableColumn<JournalLine>[] = [
    {
      key: "account",
      header: "Account",
      width: "220px",
      render: (l) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold">{l.account}</span>
          <span className="block truncate text-tiny text-content-secondary">{l.description}</span>
        </div>
      ),
    },
    { key: "debit", header: "Debit", width: "110px", align: "right", render: (l) => (l.debit ? formatMoney(l.debit) : "") },
    { key: "credit", header: "Credit", width: "110px", align: "right", render: (l) => (l.credit ? formatMoney(l.credit) : "") },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispose ${asset.description}`}
      widthClassName="max-w-2xl"
      footer={
        <div className="flex w-full flex-wrap justify-between gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 2 ? (
            <Button size="sm" onClick={next}>
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={dispose}>
              {beLabel("Dispose asset")}
            </Button>
          )}
        </div>
      }
    >
      <StepIndicator steps={STEPS} current={step} />

      {step === 0 && (
        <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
          <TextField label="Disposal date *" type="date" value={date} onChange={setDate} />
          <TextField label="Proceeds amount" type="number" value={proceeds} onChange={setProceeds} hint="Enter 0 if the asset was scrapped or written off." />
          <SelectField label="Proceeds account" value={proceedsAccount} onChange={setProceedsAccount} options={ACCOUNTS.proceeds} className="sm:col-span-2" />
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <SelectField label="Gain / loss account" value={gainLossAccount} onChange={setGainLossAccount} options={ACCOUNTS.gainLoss} />
          <div className="rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Cost">{formatMoney(asset.cost)}</ModalDefinitionRow>
            <ModalDefinitionRow label={`Accumulated depreciation at ${dateLabel(date)}`}>{formatMoney(figures.accumulated)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Net book value">{formatMoney(figures.nbv)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Proceeds">{formatMoney(proceedsNum)}</ModalDefinitionRow>
            <ModalDefinitionRow label={figures.gainLoss >= 0 ? "Gain on disposal" : "Loss on disposal"}>
              <Badge variant={figures.gainLoss > 0 ? "success" : figures.gainLoss < 0 ? "error" : "neutral"}>{formatMoney(Math.abs(figures.gainLoss))}</Badge>
            </ModalDefinitionRow>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">This journal will post to {provider.name} dated {dateLabel(date)}.</p>
          <DataTable columns={columns} rows={journal} getRowKey={(l) => `${l.account}-${l.description}`} />
          <div className="flex justify-end gap-[var(--space-lg)] text-body-sm font-bold text-content-primary">
            <span>Debits {formatMoney(totalDebit)}</span>
            <span>Credits {formatMoney(totalCredit)}</span>
          </div>
          <p className={NOTE_CLASS}>
            {figures.reversePeriods > 0
              ? `Depreciation already posted after the disposal date (${figures.reversePeriods} month${figures.reversePeriods === 1 ? "" : "s"}, ${formatMoney(figures.toReverse)}) will be reversed, and no further depreciation will post.`
              : "No further depreciation will post after the disposal date. Any later depreciation would be reversed automatically."}
          </p>
        </div>
      )}

      {error && <p className="mt-[var(--space-sm)] text-caption font-semibold text-status-danger-text">{error}</p>}
    </Modal>
  );
}
