"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { AMORTISATION_COPY, useAmortisationAccounts } from "./amortisationCopy";
import { useVendorNames } from "./lookups";
import { amortisationSchedule, todayIso } from "./schedule";
import { NOTE_CLASS, SECTION_TITLE_CLASS, ScheduleTable, SelectField, SwitchRow, TextField, VendorField } from "./shared";
import type { AmortisationItem, AmortisationKind, Proration } from "./types";

interface Props {
  kind: AmortisationKind;
  defaultProration: Proration;
  onClose: () => void;
  onCreate: (item: AmortisationItem) => void;
}

export function AddAmortisationModal({ kind, defaultProration, onClose, onCreate }: Props) {
  const copy = AMORTISATION_COPY[kind];
  const { balanceAccounts, pnlAccounts } = useAmortisationAccounts(kind);
  const vendors = useVendorNames();
  const today = todayIso();
  const [form, setForm] = useState({
    description: "",
    party: "",
    amount: "",
    openingBalance: "",
    startDate: today,
    endDate: "",
    releaseFrom: today,
    balanceAccount: "",
    pnlAccount: "",
    alreadyAmortised: false,
  });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const total = Number(form.amount) || 0;
  const schedule = useMemo(
    () =>
      amortisationSchedule({
        total,
        startDate: form.startDate,
        endDate: form.endDate,
        releaseFrom: form.alreadyAmortised ? form.releaseFrom : form.startDate,
        proration: defaultProration,
        recurrence: "recurring",
      }),
    [total, form.startDate, form.endDate, form.releaseFrom, form.alreadyAmortised, defaultProration],
  );

  const create = () => {
    if (!form.description.trim() || !form.party.trim()) return setError(`Description and ${copy.partyLabel.toLowerCase()} are required.`);
    if (!(total > 0)) return setError(`${copy.amountLabel} must be greater than zero.`);
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) return setError("Choose an end date on or after the start date.");
    if (form.alreadyAmortised && (form.releaseFrom < form.startDate || form.releaseFrom > form.endDate))
      return setError("Release-from date must fall between the start and end dates.");
    if (!form.balanceAccount || !form.pnlAccount) return setError("Choose both accounts from your chart of accounts.");
    notifyBackendPending("Create");
    onCreate({
      id: `${kind}-${Date.now()}`,
      kind,
      description: form.description.trim(),
      party: form.party.trim(),
      sourceRef: "",
      total,
      openingBalance: form.alreadyAmortised ? Number(form.openingBalance) || total : total,
      startDate: form.startDate,
      endDate: form.endDate,
      releaseFrom: form.alreadyAmortised ? form.releaseFrom : form.startDate,
      balanceAccount: form.balanceAccount,
      pnlAccount: form.pnlAccount,
      tracking: "None",
      proration: defaultProration,
      recurrence: "recurring",
      status: "review",
      detected: false,
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.addLabel}
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
          <TextField label="Description *" value={form.description} onChange={(v) => set("description", v)} placeholder="e.g. Annual insurance" />
          {kind === "prepayment" ? (
            <VendorField label={`${copy.partyLabel} *`} value={form.party} onChange={(v) => set("party", v)} vendors={vendors} />
          ) : (
            <TextField label={`${copy.partyLabel} *`} value={form.party} onChange={(v) => set("party", v)} />
          )}
          <TextField label={`${copy.amountLabel} *`} type="number" value={form.amount} onChange={(v) => set("amount", v)} placeholder="0.00" />
          <TextField
            label="Opening balance"
            type="number"
            value={form.openingBalance}
            onChange={(v) => set("openingBalance", v)}
            placeholder="Same as amount"
            disabled={!form.alreadyAmortised}
            hint="Balance left to release at the release-from date."
          />
          <TextField label="Start date *" type="date" value={form.startDate} onChange={(v) => set("startDate", v)} />
          <TextField label="End date *" type="date" value={form.endDate} onChange={(v) => set("endDate", v)} />
          <TextField
            label="Release from"
            type="date"
            value={form.alreadyAmortised ? form.releaseFrom : form.startDate}
            onChange={(v) => set("releaseFrom", v)}
            disabled={!form.alreadyAmortised}
          />
          <SelectField label={copy.pnlAccountLabel} value={form.pnlAccount} onChange={(v) => set("pnlAccount", v)} options={pnlAccounts} />
          <SelectField label={copy.balanceAccountLabel} value={form.balanceAccount} onChange={(v) => set("balanceAccount", v)} options={balanceAccounts} />
        </div>

        <SwitchRow
          label="Already amortised"
          description="Part of this was already released outside Scantrix — earlier periods are tracked but not posted again."
          control={<Switch checked={form.alreadyAmortised} onChange={(v) => set("alreadyAmortised", v)} label="Already amortised" />}
        />

        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}

        <div className="flex flex-col gap-[var(--space-sm)]">
          <p className={SECTION_TITLE_CLASS}>Schedule preview ({defaultProration === "daily" ? "daily" : "monthly"} proration)</p>
          <ScheduleTable rows={schedule} amountHeader="Release" closingHeader="Closing balance" posting={false} emptyText="Enter an amount and date range to preview the schedule." />
        </div>
        <p className={NOTE_CLASS}>New items land in To review so you can check the schedule before anything posts.</p>
      </div>
    </Modal>
  );
}
