"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { METHOD_OPTIONS } from "./FixedAssetReviewModal";
import { useGlAccountGroups, useVendorNames } from "./lookups";
import { depreciationSchedule, formatMoney, todayIso } from "./schedule";
import { NOTE_CLASS, SECTION_TITLE_CLASS, ScheduleTable, SegmentedField, SelectField, SwitchRow, TextField, VendorField } from "./shared";
import type { DepreciationMethod, FixedAsset } from "./types";

interface Props {
  onClose: () => void;
  onCreate: (asset: FixedAsset) => void;
}

export function AddAssetModal({ onClose, onCreate }: Props) {
  const gl = useGlAccountGroups();
  const vendors = useVendorNames();
  const today = todayIso();
  const [form, setForm] = useState({
    vendor: "",
    description: "",
    assetAccount: "",
    cost: "",
    acquisitionDate: today,
    residual: "0",
    life: "36",
    scheduleStart: `${today.slice(0, 7)}-01`,
    accumulated: "",
    accumAccount: "",
    expenseAccount: "",
    method: "straightLine" as DepreciationMethod,
    alreadyDepreciated: false,
    nonDepreciable: false,
  });
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const asset: FixedAsset = useMemo(
    () => ({
      id: "draft",
      description: form.description.trim(),
      vendor: form.vendor.trim(),
      sourceRef: "",
      assetAccount: form.assetAccount,
      accumAccount: form.accumAccount,
      expenseAccount: form.expenseAccount,
      cost: Number(form.cost) || 0,
      acquisitionDate: form.acquisitionDate,
      residualValue: form.nonDepreciable ? 0 : Number(form.residual) || 0,
      usefulLifeMonths: form.nonDepreciable ? 0 : Number(form.life) || 0,
      method: form.method,
      reducingRatePct: 25,
      scheduleStart: form.scheduleStart,
      accumulatedToDate: form.alreadyDepreciated ? Number(form.accumulated) || 0 : 0,
      alreadyDepreciated: form.alreadyDepreciated,
      nonDepreciable: form.nonDepreciable,
      status: "review",
      detected: false,
    }),
    [form],
  );
  const schedule = useMemo(() => depreciationSchedule(asset), [asset]);

  const create = () => {
    if (!asset.description || !asset.vendor) return setError("Vendor and description are required.");
    if (!(asset.cost > 0)) return setError("Cost must be greater than zero.");
    if (!asset.nonDepreciable && asset.usefulLifeMonths <= 0) return setError("Remaining life must be at least 1 month.");
    if (asset.accumulatedToDate >= asset.cost) return setError("Accumulated depreciation must be less than the cost.");
    if (!asset.assetAccount) return setError("Choose the asset account.");
    if (!asset.nonDepreciable && (!asset.accumAccount || !asset.expenseAccount)) return setError("Choose the accumulated depreciation and expense accounts.");
    notifyBackendPending("Create");
    onCreate({ ...asset, id: `fa-${Date.now()}` });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add asset"
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={create}>
            {beLabel("Create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
          <VendorField label="Vendor *" value={form.vendor} onChange={(v) => set("vendor", v)} vendors={vendors} />
          <TextField label="Description *" value={form.description} onChange={(v) => set("description", v)} placeholder="e.g. MacBook Pro 14”" />
          <SelectField label="Asset account" value={form.assetAccount} onChange={(v) => set("assetAccount", v)} options={gl.asset} />
          <TextField label="Cost *" type="number" value={form.cost} onChange={(v) => set("cost", v)} placeholder="0.00" />
          <TextField label="Acquisition date" type="date" value={form.acquisitionDate} onChange={(v) => set("acquisitionDate", v)} />
          <TextField label="Schedule start date" type="date" value={form.scheduleStart} onChange={(v) => set("scheduleStart", v)} disabled={form.nonDepreciable} />
        </div>

        <SwitchRow
          label="Non-depreciable"
          description="For assets like land that are tracked at cost and never depreciated."
          control={<Switch checked={form.nonDepreciable} onChange={(v) => set("nonDepreciable", v)} label="Non-depreciable" />}
        />

        {!form.nonDepreciable && (
          <>
            <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
              <TextField label="Residual value" type="number" value={form.residual} onChange={(v) => set("residual", v)} />
              <TextField label="Remaining life (months)" type="number" value={form.life} onChange={(v) => set("life", v)} />
              <SelectField label="Accumulated depreciation account" value={form.accumAccount} onChange={(v) => set("accumAccount", v)} options={gl.accumulated} />
              <SelectField label="Depreciation expense account" value={form.expenseAccount} onChange={(v) => set("expenseAccount", v)} options={gl.depreciationExpense} />
            </div>
            <SegmentedField<DepreciationMethod> label="Depreciation method" value={form.method} onChange={(v) => set("method", v)} options={METHOD_OPTIONS} />
            <SwitchRow
              label="Already depreciated"
              description="Some depreciation was posted before this asset came into Scantrix."
              control={<Switch checked={form.alreadyDepreciated} onChange={(v) => set("alreadyDepreciated", v)} label="Already depreciated" />}
            />
            {form.alreadyDepreciated && (
              <TextField
                label="Accumulated depreciation to date"
                type="number"
                value={form.accumulated}
                onChange={(v) => set("accumulated", v)}
                hint="Depreciation continues from this balance over the remaining life."
              />
            )}
          </>
        )}

        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}

        {!form.nonDepreciable && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <p className={SECTION_TITLE_CLASS}>
              Schedule preview{schedule.length > 0 ? ` · ${formatMoney(schedule[0].amount)} in the first month` : ""}
            </p>
            <ScheduleTable rows={schedule} amountHeader="Depreciation" closingHeader="Net book value" posting={false} emptyText="Enter a cost and remaining life to preview the schedule." />
          </div>
        )}
        <p className={NOTE_CLASS}>New assets land in To review so you can check the schedule before anything posts.</p>
      </div>
    </Modal>
  );
}
