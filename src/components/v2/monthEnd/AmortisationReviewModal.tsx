"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { AMORTISATION_COPY, useAmortisationAccounts } from "./amortisationCopy";
import { TRACKING_OPTIONS } from "./config";
import { amortisationSchedule, dateLabel, formatMoney, postsJournals } from "./schedule";
import { NOTE_CLASS, SECTION_TITLE_CLASS, ScheduleTable, SegmentedField, SelectField, StatusBadge, TextField } from "./shared";
import type { AmortisationItem, Proration, Recurrence } from "./types";

interface Props {
  item: AmortisationItem;
  onClose: () => void;
  onChange: (item: AmortisationItem) => void;
}

export function AmortisationReviewModal({ item, onClose, onChange }: Props) {
  const provider = useActiveProvider();
  const copy = AMORTISATION_COPY[item.kind];
  const { balanceAccounts, pnlAccounts } = useAmortisationAccounts(item.kind);
  // Keep the item's own account selectable even if it is not in the loaded chart.
  const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);
  const [draft, setDraft] = useState<AmortisationItem>(item);
  const editable = item.status === "review";
  const schedule = useMemo(() => amortisationSchedule(draft), [draft]);
  const set = <K extends keyof AmortisationItem>(key: K, value: AmortisationItem[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const scheduleError =
    draft.recurrence === "recurring" && draft.endDate < draft.startDate
      ? "End date must be on or after the start date."
      : draft.releaseFrom < draft.startDate
        ? "Release-from date can't be before the start date."
        : "";

  const publish = () => {
    if (scheduleError) {
      showToast(scheduleError, "error");
      return;
    }
    if (!draft.balanceAccount || !draft.pnlAccount) {
      showToast("Choose both accounts before publishing.", "error");
      return;
    }
    notifyBackendPending("Publish schedule");
    onChange({ ...draft, status: "active" });
    showToast(`Schedule published — journals will post to ${provider.name} each month.`, "success");
    onClose();
  };

  const archive = async () => {
    if (item.status === "active") {
      const ok = await confirmDialog({
        title: `Archive this ${copy.singular}?`,
        message: `Reversing journals will be posted in ${provider.name} for every period already released, and no further journals will post.`,
        confirmLabel: beLabel("Archive"),
        tone: "destructive",
      });
      if (!ok) return;
    }
    notifyBackendPending("Archive");
    onChange({ ...item, status: "archived" });
    onClose();
  };

  const unarchive = () => {
    notifyBackendPending("Unarchive");
    onChange({ ...item, status: "review" });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editable ? `Review ${copy.singular} schedule` : `${copy.title} schedule`}
      widthClassName="max-w-3xl"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={onClose}>
            {editable || item.status === "archived" ? "Cancel" : "Close"}
          </Button>
          {(item.status === "review" || item.status === "active") && (
            <Button variant="outline" size="sm" onClick={archive}>
              {beLabel("Archive")}
            </Button>
          )}
          {item.status === "archived" && (
            <Button size="sm" onClick={unarchive}>
              {beLabel("Unarchive")}
            </Button>
          )}
          {editable && (
            <Button size="sm" onClick={publish} disabled={schedule.length === 0}>
              {beLabel("Publish schedule")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-h3 font-bold text-content-primary">{item.description}</p>
            <p className="text-body-sm text-content-secondary">
              {item.party} · {formatMoney(item.total)}
            </p>
          </div>
          <StatusBadge status={item.status} />
        </div>

        <Link href="/invoices" className="inline-flex items-center gap-[var(--space-xs)] text-body-sm font-semibold text-accent hover:underline">
          <FileText size={16} strokeWidth={2} />
          {item.detected ? `Spotted on ${copy.sourceNoun} ${item.sourceRef}` : `Source ${copy.sourceNoun} ${item.sourceRef || "—"}`}
        </Link>

        <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
          <SegmentedField<Proration>
            label="Proration"
            value={draft.proration}
            onChange={(v) => set("proration", v)}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "daily", label: "Daily" },
            ]}
            disabled={!editable}
          />
          <SegmentedField<Recurrence>
            label="Type"
            value={draft.recurrence}
            onChange={(v) => set("recurrence", v)}
            options={[
              { value: "recurring", label: "Recurring" },
              { value: "oneOff", label: "One-off" },
            ]}
            disabled={!editable}
          />
        </div>

        {editable ? (
          <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-3">
            <TextField label="Start date" type="date" value={draft.startDate} onChange={(v) => set("startDate", v)} />
            <TextField label="End date" type="date" value={draft.endDate} onChange={(v) => set("endDate", v)} disabled={draft.recurrence === "oneOff"} />
            <TextField label="Release from" type="date" value={draft.releaseFrom} onChange={(v) => set("releaseFrom", v)} />
            <SelectField label={copy.balanceAccountLabel} value={draft.balanceAccount} onChange={(v) => set("balanceAccount", v)} options={withCurrent(balanceAccounts, draft.balanceAccount)} />
            <SelectField label={copy.pnlAccountLabel} value={draft.pnlAccount} onChange={(v) => set("pnlAccount", v)} options={withCurrent(pnlAccounts, draft.pnlAccount)} />
            <SelectField label="Tracking / class" value={draft.tracking} onChange={(v) => set("tracking", v)} options={TRACKING_OPTIONS} />
          </div>
        ) : (
          <div className="rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Start – end">
              {dateLabel(item.startDate)} – {dateLabel(item.endDate)}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Release from">{dateLabel(item.releaseFrom)}</ModalDefinitionRow>
            <ModalDefinitionRow label={copy.balanceAccountLabel}>{item.balanceAccount}</ModalDefinitionRow>
            <ModalDefinitionRow label={copy.pnlAccountLabel}>{item.pnlAccount}</ModalDefinitionRow>
            <ModalDefinitionRow label="Tracking / class">{item.tracking}</ModalDefinitionRow>
          </div>
        )}
        {scheduleError && editable && <p className="text-caption font-semibold text-status-danger-text">{scheduleError}</p>}

        <div className="flex flex-col gap-[var(--space-sm)]">
          <p className={SECTION_TITLE_CLASS}>Monthly release schedule</p>
          <ScheduleTable
            rows={schedule}
            amountHeader="Release"
            closingHeader="Closing balance"
            posting={postsJournals(item.status)}
            emptyText="Enter a valid amount and date range to see the schedule."
          />
        </div>

        <p className={NOTE_CLASS}>
          Journals post without tax — tax was already handled on the original {copy.sourceNoun}. Periods before the release-from date are tracked here
          only and are not posted to {provider.name}.
        </p>
      </div>
    </Modal>
  );
}
