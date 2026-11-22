"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch } from "@/store/hooks";
import { saveMonthEndSettings } from "@/store/monthEnd/monthEndApi";
import type { MonthEndSettingsDto } from "@/store/monthEnd/monthEndApi";

import { ERROR_NOTE_CLASS, NOTE_CLASS, SelectField, TextField, useMonthEndAccounts } from "./shared";

interface Props {
  settings: MonthEndSettingsDto;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (settings: MonthEndSettingsDto) => void;
}

export function MonthEndSettingsModal({ settings, canEdit, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const [detection, setDetection] = useState(settings.prepaymentDetection);
  const [minAmount, setMinAmount] = useState(String(settings.prepaymentMinAmount ?? 0));
  const [prepaidAccountId, setPrepaidAccountId] = useState(settings.prepaidAccountId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { balanceAccounts } = useMonthEndAccounts({ balance: [settings.prepaidAccountId] });

  const save = async () => {
    const min = Number(minAmount);
    if (!Number.isFinite(min) || min < 0) return setError("Enter a minimum of 0 or more.");
    setSaving(true);
    setError("");
    const result = await dispatch(
      // "" = back to picking it automatically.
      saveMonthEndSettings({ prepaymentDetection: detection, prepaymentMinAmount: min, prepaidAccountId: prepaidAccountId || null }),
    );
    setSaving(false);
    if (saveMonthEndSettings.fulfilled.match(result)) {
      onSaved(result.payload);
      showToast("Settings saved.", "success");
      onClose();
    } else {
      setError(result.payload?.message ?? "Couldn't save the settings.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Prepayment settings"
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button size="sm" onClick={save} loading={saving}>
              Save settings
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border bg-page p-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-content-primary">Detect prepayments</p>
            <p className="text-caption text-content-secondary">Flag invoices whose service period is longer than a month (over 31 days).</p>
          </div>
          <Switch checked={detection} onChange={setDetection} disabled={!canEdit} label="Detect prepayments" />
        </div>
        <TextField
          label="Minimum amount"
          type="number"
          value={minAmount}
          onChange={setMinAmount}
          disabled={!canEdit}
          hint="Invoices below this total are expensed straight away even if they cover several months. 0 = no minimum."
        />
        <SelectField
          label="Prepaid account"
          value={prepaidAccountId}
          onChange={setPrepaidAccountId}
          options={[{ value: "", label: "Pick automatically (an account named Prepaid…)" }, ...balanceAccounts]}
          disabled={!canEdit}
          hint="The asset account prepayment bills post to and their journals release from."
        />
        {error && <p className={ERROR_NOTE_CLASS}>{error}</p>}
        <p className={NOTE_CLASS}>Changes apply to invoices scanned or posted from now on. Schedules already made keep their accounts.</p>
      </div>
    </Modal>
  );
}
