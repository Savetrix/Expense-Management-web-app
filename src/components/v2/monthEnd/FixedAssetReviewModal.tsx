"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { assetPosition } from "./assetMath";
import { useGlAccountGroups } from "./lookups";
import { currentPeriod, dateLabel, depreciationSchedule, formatMoney, postsJournals } from "./schedule";
import { NOTE_CLASS, SECTION_TITLE_CLASS, ScheduleTable, SegmentedField, SelectField, StatusBadge, TextField } from "./shared";
import type { DepreciationMethod, FixedAsset } from "./types";

interface Props {
  asset: FixedAsset;
  onClose: () => void;
  onChange: (asset: FixedAsset) => void;
  onDispose: (asset: FixedAsset) => void;
}

export const METHOD_OPTIONS: { value: DepreciationMethod; label: string }[] = [
  { value: "straightLine", label: "Straight line" },
  { value: "reducingBalance", label: "Reducing balance" },
];

export function FixedAssetReviewModal({ asset, onClose, onChange, onDispose }: Props) {
  const provider = useActiveProvider();
  const gl = useGlAccountGroups();
  const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);
  const editable = asset.status === "review";
  const [draft, setDraft] = useState(asset);
  const [life, setLife] = useState(String(asset.usefulLifeMonths));
  const [residual, setResidual] = useState(String(asset.residualValue));
  const [rate, setRate] = useState(String(asset.reducingRatePct));
  const set = <K extends keyof FixedAsset>(key: K, value: FixedAsset[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const effective: FixedAsset = useMemo(
    () => ({ ...draft, usefulLifeMonths: Number(life) || 0, residualValue: Number(residual) || 0, reducingRatePct: Number(rate) || 0 }),
    [draft, life, residual, rate],
  );
  const schedule = useMemo(() => depreciationSchedule(effective), [effective]);
  const position = assetPosition(asset, currentPeriod());

  const publish = () => {
    if (!asset.nonDepreciable && schedule.length === 0) {
      showToast("Check the useful life and residual value — the schedule is empty.", "error");
      return;
    }
    if (!asset.nonDepreciable && (!draft.assetAccount || !draft.accumAccount || !draft.expenseAccount)) {
      showToast("Choose the asset, accumulated depreciation and expense accounts.", "error");
      return;
    }
    notifyBackendPending("Publish");
    onChange({ ...effective, status: "active" });
    onClose();
  };

  const archive = async () => {
    if (asset.status === "active") {
      const ok = await confirmDialog({
        title: "Archive this asset?",
        message: `Reversing journals will be posted in ${provider.name} for the depreciation already posted by Scantrix. Use Dispose instead if the asset was sold or scrapped.`,
        confirmLabel: beLabel("Archive"),
        tone: "destructive",
      });
      if (!ok) return;
    }
    notifyBackendPending("Archive");
    onChange({ ...asset, status: "archived" });
    onClose();
  };

  const unarchive = () => {
    notifyBackendPending("Unarchive");
    onChange({ ...asset, status: "review" });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editable ? "Review fixed asset" : "Fixed asset"}
      widthClassName="max-w-3xl"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={onClose}>
            {editable ? "Cancel" : "Close"}
          </Button>
          {(asset.status === "review" || asset.status === "active") && (
            <Button variant="outline" size="sm" onClick={archive}>
              {beLabel("Archive")}
            </Button>
          )}
          {asset.status === "archived" && (
            <Button size="sm" onClick={unarchive}>
              {beLabel("Unarchive")}
            </Button>
          )}
          {asset.status === "active" && (
            <Button size="sm" onClick={() => onDispose(asset)}>
              Dispose
            </Button>
          )}
          {editable && (
            <Button size="sm" onClick={publish}>
              {beLabel("Publish")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-h3 font-bold text-content-primary">{asset.description}</p>
            <p className="text-body-sm text-content-secondary">
              {asset.vendor} · cost {formatMoney(asset.cost)} · acquired {dateLabel(asset.acquisitionDate)}
            </p>
          </div>
          <StatusBadge status={asset.status} label={asset.disposal ? "Disposed" : undefined} />
        </div>

        {asset.sourceRef && (
          <Link href="/invoices" className="inline-flex items-center gap-[var(--space-xs)] text-body-sm font-semibold text-accent hover:underline">
            <FileText size={16} strokeWidth={2} />
            {asset.detected ? `Spotted on bill ${asset.sourceRef} — coded to a fixed-asset account above your threshold` : `Source bill ${asset.sourceRef}`}
          </Link>
        )}

        {editable ? (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-3">
              <TextField label="Useful life (months)" type="number" value={life} onChange={setLife} disabled={draft.nonDepreciable} />
              <TextField label="Residual value" type="number" value={residual} onChange={setResidual} disabled={draft.nonDepreciable} />
              <TextField label="Schedule start" type="date" value={draft.scheduleStart} onChange={(v) => set("scheduleStart", v)} />
            </div>
            <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-3">
              <div className="sm:col-span-2">
                <SegmentedField<DepreciationMethod> label="Depreciation method" value={draft.method} onChange={(v) => set("method", v)} options={METHOD_OPTIONS} />
              </div>
              {draft.method === "reducingBalance" && <TextField label="Annual rate (%)" type="number" value={rate} onChange={setRate} />}
            </div>
            <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-3">
              <SelectField label="Asset account" value={draft.assetAccount} onChange={(v) => set("assetAccount", v)} options={withCurrent(gl.asset, draft.assetAccount)} />
              <SelectField label="Accumulated depreciation" value={draft.accumAccount} onChange={(v) => set("accumAccount", v)} options={withCurrent(gl.accumulated, draft.accumAccount)} />
              <SelectField label="Depreciation expense" value={draft.expenseAccount} onChange={(v) => set("expenseAccount", v)} options={withCurrent(gl.depreciationExpense, draft.expenseAccount)} />
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Method">{METHOD_OPTIONS.find((m) => m.value === asset.method)?.label}</ModalDefinitionRow>
            <ModalDefinitionRow label="Useful life">{asset.nonDepreciable ? "Not depreciated" : `${asset.usefulLifeMonths} months`}</ModalDefinitionRow>
            <ModalDefinitionRow label="Residual value">{formatMoney(asset.residualValue)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Asset account">{asset.assetAccount}</ModalDefinitionRow>
            <ModalDefinitionRow label="Accumulated depreciation">{asset.accumAccount}</ModalDefinitionRow>
            <ModalDefinitionRow label="Depreciation expense">{asset.expenseAccount}</ModalDefinitionRow>
            <ModalDefinitionRow label="Depreciated to date">{formatMoney(position.depreciated)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Net book value">{formatMoney(position.nbv)}</ModalDefinitionRow>
            {asset.disposal && (
              <ModalDefinitionRow label="Disposed">
                {dateLabel(asset.disposal.date)} for {formatMoney(asset.disposal.proceeds)}
              </ModalDefinitionRow>
            )}
          </div>
        )}

        <div className="flex flex-col gap-[var(--space-sm)]">
          <p className={SECTION_TITLE_CLASS}>Monthly depreciation schedule</p>
          <ScheduleTable
            rows={editable ? schedule : depreciationSchedule(asset)}
            amountHeader="Depreciation"
            closingHeader="Net book value"
            posting={postsJournals(asset.status)}
            emptyText={asset.nonDepreciable ? "This asset is marked non-depreciable, so no journals will post." : "Enter a useful life to see the schedule."}
          />
        </div>
        <p className={NOTE_CLASS}>Depreciation posts as one journal per month to {provider.name}, debiting the expense account and crediting accumulated depreciation.</p>
      </div>
    </Modal>
  );
}
