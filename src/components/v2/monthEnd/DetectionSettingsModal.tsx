"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { NOTE_CLASS, SECTION_TITLE_CLASS, SegmentedField, SwitchRow, TextField } from "./shared";
import type { AdjustmentType, DetectionSettings, Proration } from "./types";

const TYPE_ROWS: { type: AdjustmentType; label: string; description: string }[] = [
  { type: "prepayments", label: "Prepayments", description: "Bills that pay for more than one month in advance." },
  { type: "deferred", label: "Deferred income", description: "Sales invoices for services delivered over several months." },
  { type: "fixedAssets", label: "Fixed assets", description: "Bill lines coded to a fixed-asset account." },
  { type: "accruals", label: "Accrued expenses", description: "Recurring bills that haven't arrived by month end." },
];

interface Props {
  settings: DetectionSettings;
  onClose: () => void;
  onSave: (settings: DetectionSettings) => void;
}

export function DetectionSettingsModal({ settings, onClose, onSave }: Props) {
  const [threshold, setThreshold] = useState(String(settings.threshold));
  const [proration, setProration] = useState<Proration>(settings.proration);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [error, setError] = useState("");

  const save = () => {
    const value = Number(threshold);
    if (!(value >= 0)) return setError("Enter a threshold of 0 or more.");
    notifyBackendPending("Save settings");
    onSave({ threshold: value, proration, enabled });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Detection settings"
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            {beLabel("Save settings")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <TextField
          label="Detection threshold"
          type="number"
          value={threshold}
          onChange={setThreshold}
          hint="Invoices and lines below this amount are expensed or recognised straight away."
        />
        <SegmentedField<Proration>
          label="Default proration"
          value={proration}
          onChange={setProration}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "daily", label: "Daily" },
          ]}
        />
        <p className="-mt-[var(--space-sm)] text-caption text-content-secondary">
          Monthly splits evenly across months; daily weights each month by the number of days it covers.
        </p>
        <div className="flex flex-col gap-[var(--space-sm)]">
          <p className={SECTION_TITLE_CLASS}>Detect automatically</p>
          {TYPE_ROWS.map((row) => (
            <SwitchRow
              key={row.type}
              label={row.label}
              description={row.description}
              control={<Switch checked={enabled[row.type]} onChange={(v) => setEnabled((e) => ({ ...e, [row.type]: v }))} label={row.label} />}
            />
          ))}
        </div>
        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}
        <p className={NOTE_CLASS}>Changes apply to invoices that arrive from now on. Items already in your trackers aren&apos;t affected.</p>
      </div>
    </Modal>
  );
}
