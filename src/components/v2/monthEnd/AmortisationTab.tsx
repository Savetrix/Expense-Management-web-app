"use client";

import { CalendarClock, CheckCircle2, Inbox, Archive } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";

import { AddAmortisationModal } from "./AddAmortisationModal";
import { AMORTISATION_COPY } from "./amortisationCopy";
import { AmortisationReviewModal } from "./AmortisationReviewModal";
import { BulkImportModal } from "./BulkImportModal";
import { currentPeriod, itemSchedule, lastPeriod, overlapsPeriod, periodLabel, postsJournals, rangeLabel, releasedThrough, round2 } from "./schedule";
import { ALL, AddMenuButton, DisabledDetectionNote, ReconciliationCard, TrackerTable, TrackerToolbar, countByStatus } from "./shared";
import type { TrackerRow } from "./shared";
import type { AdjustmentStatus, AmortisationItem, AmortisationKind, Proration } from "./types";

interface Props {
  kind: AmortisationKind;
  items: AmortisationItem[];
  onItemsChange: (updater: (items: AmortisationItem[]) => AmortisationItem[]) => void;
  defaultProration: Proration;
  detectionEnabled: boolean;
  ledgerOffset: number;
}

/** Released-to-date and closing balance as at `period`. */
export function amortisationPosition(item: AmortisationItem, period: string) {
  if (!postsJournals(item.status)) return { released: 0, closing: item.status === "archived" ? 0 : item.total };
  if (item.status === "completed") return { released: item.total, closing: 0 };
  const released = releasedThrough(itemSchedule(item), period);
  return { released, closing: round2(item.total - released) };
}

export function AmortisationTab({ kind, items, onItemsChange, defaultProration, detectionEnabled, ledgerOffset }: Props) {
  const copy = AMORTISATION_COPY[kind];
  const [status, setStatus] = useState<AdjustmentStatus>("review");
  const [account, setAccount] = useState(ALL);
  const [period, setPeriod] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const asOf = period === ALL ? currentPeriod() : period;
  const counts = countByStatus(items);
  const accountOptions = useMemo(() => Array.from(new Set(items.map((i) => i.balanceAccount))).sort(), [items]);

  const rows: TrackerRow[] = useMemo(
    () =>
      items
        .filter((i) => i.status === status)
        .filter((i) => account === ALL || i.balanceAccount === account)
        .filter((i) => period === ALL || overlapsPeriod(i.startDate, lastPeriod(itemSchedule(i), i.endDate), period))
        .map((i) => {
          const pos = amortisationPosition(i, asOf);
          return {
            id: i.id,
            description: i.description,
            party: i.party,
            sourceRef: i.sourceRef,
            account: i.balanceAccount,
            total: i.total,
            range: rangeLabel(i.startDate, i.recurrence === "oneOff" ? i.startDate : i.endDate),
            released: pos.released,
            closing: pos.closing,
            status: i.status,
          };
        }),
    [items, status, account, period, asOf],
  );

  const trackerBalance = round2(
    items.filter((i) => i.status === "active").reduce((sum, i) => sum + amortisationPosition(i, currentPeriod()).closing, 0),
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const upsert = (item: AmortisationItem) => onItemsChange((list) => (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [item, ...list]));

  const emptyCopy: Record<AdjustmentStatus, { icon: ReactNode; title: string; description: string }> = {
    review: {
      icon: <Inbox size={28} strokeWidth={1.75} />,
      title: "Nothing to review",
      description: `When a ${copy.sourceNoun} covers more than one month, Scantrix drafts a schedule here for you to check.`,
    },
    active: {
      icon: <CalendarClock size={28} strokeWidth={1.75} />,
      title: `No active ${copy.title.toLowerCase()}`,
      description: "Published schedules appear here and post a journal every month until they finish.",
    },
    completed: {
      icon: <CheckCircle2 size={28} strokeWidth={1.75} />,
      title: "Nothing completed yet",
      description: "Schedules move here once their final period has been released.",
    },
    archived: {
      icon: <Archive size={28} strokeWidth={1.75} />,
      title: "No archived items",
      description: "Items you archive are kept here and can be restored to To review.",
    },
  };
  const filtered = account !== ALL || period !== ALL;
  const empty = emptyCopy[status];

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <ReconciliationCard label={copy.title} trackerBalance={trackerBalance} ledgerOffset={ledgerOffset} />
      {!detectionEnabled && <DisabledDetectionNote typeLabel={copy.title.toLowerCase()} />}

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <TrackerToolbar
          status={status}
          onStatusChange={setStatus}
          counts={counts}
          account={account}
          onAccountChange={setAccount}
          accountOptions={accountOptions}
          period={period}
          onPeriodChange={setPeriod}
          exportName={copy.title.toLowerCase()}
          actions={
            <AddMenuButton label={copy.addLabel} onAdd={() => setAdding(true)} menu={[{ label: "Bulk import", onSelect: () => setImporting(true) }]} />
          }
        />
        <TrackerTable
          rows={rows}
          partyLabel={copy.partyLabel}
          releasedHeader={`${copy.releaseHeader} to date`}
          closingHeader={`Balance ${periodLabel(asOf)}`}
          onRowClick={(r) => setSelectedId(r.id)}
          emptyState={
            filtered ? (
              <EmptyState icon={empty.icon} title="No matches" description="Nothing matches these filters. Try another account or period." />
            ) : (
              <EmptyState
                icon={empty.icon}
                title={empty.title}
                description={empty.description}
                actionLabel={status === "review" ? copy.addLabel : undefined}
                onAction={status === "review" ? () => setAdding(true) : undefined}
              />
            )
          }
        />
      </div>

      {selected && <AmortisationReviewModal key={selected.id + selected.status} item={selected} onClose={() => setSelectedId(null)} onChange={upsert} />}
      {adding && (
        <AddAmortisationModal
          kind={kind}
          defaultProration={defaultProration}
          onClose={() => setAdding(false)}
          onCreate={(item) => {
            upsert(item);
            setStatus("review");
          }}
        />
      )}
      {importing && (
        <BulkImportModal
          kind={kind}
          onClose={() => setImporting(false)}
          onImport={(imported) => {
            onItemsChange((list) => [...imported, ...list]);
            setStatus("review");
          }}
        />
      )}
    </div>
  );
}
