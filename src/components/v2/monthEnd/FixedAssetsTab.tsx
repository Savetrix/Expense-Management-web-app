"use client";

import { Archive, CheckCircle2, Inbox, Monitor } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import { AddAssetModal } from "./AddAssetModal";
import { assetPosition } from "./assetMath";
import { DisposeAssetModal } from "./DisposeAssetModal";
import { FixedAssetReviewModal } from "./FixedAssetReviewModal";
import { assetSchedule, currentPeriod, lastPeriod, overlapsPeriod, periodLabel, periodOf, round2 } from "./schedule";
import { ALL, AddMenuButton, DisabledDetectionNote, ReconciliationCard, TrackerTable, TrackerToolbar, countByStatus } from "./shared";
import type { TrackerRow } from "./shared";
import type { AdjustmentStatus, FixedAsset } from "./types";

interface Props {
  assets: FixedAsset[];
  onAssetsChange: (updater: (assets: FixedAsset[]) => FixedAsset[]) => void;
  threshold: number;
  detectionEnabled: boolean;
  ledgerOffset: number;
}

function assetRange(asset: FixedAsset): string {
  if (asset.nonDepreciable) return "Not depreciated";
  const end = asset.disposal ? periodOf(asset.disposal.date) : lastPeriod(assetSchedule(asset), asset.scheduleStart);
  return `${periodLabel(periodOf(asset.scheduleStart))} – ${periodLabel(end)}`;
}

export function FixedAssetsTab({ assets, onAssetsChange, threshold, detectionEnabled, ledgerOffset }: Props) {
  const [status, setStatus] = useState<AdjustmentStatus>("review");
  const [account, setAccount] = useState(ALL);
  const [period, setPeriod] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [disposingId, setDisposingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const asOf = period === ALL ? currentPeriod() : period;
  const counts = countByStatus(assets);
  const accountOptions = useMemo(() => Array.from(new Set(assets.map((a) => a.assetAccount))).sort(), [assets]);

  const rows: TrackerRow[] = useMemo(
    () =>
      assets
        .filter((a) => a.status === status)
        .filter((a) => account === ALL || a.assetAccount === account)
        .filter((a) => period === ALL || overlapsPeriod(a.scheduleStart, a.nonDepreciable ? "9999-12" : lastPeriod(assetSchedule(a), a.scheduleStart), period))
        .map((a) => {
          const pos = assetPosition(a, asOf);
          return {
            id: a.id,
            description: a.description,
            party: a.vendor,
            sourceRef: a.sourceRef,
            account: a.assetAccount,
            total: a.cost,
            range: assetRange(a),
            released: pos.depreciated,
            closing: pos.nbv,
            status: a.status,
            statusLabel: a.disposal ? "Disposed" : undefined,
          };
        }),
    [assets, status, account, period, asOf],
  );

  const trackerBalance = round2(assets.filter((a) => a.status === "active").reduce((s, a) => s + assetPosition(a, currentPeriod()).nbv, 0));
  const upsert = (asset: FixedAsset) => onAssetsChange((list) => (list.some((a) => a.id === asset.id) ? list.map((a) => (a.id === asset.id ? asset : a)) : [asset, ...list]));
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const disposing = assets.find((a) => a.id === disposingId) ?? null;

  const emptyCopy: Record<AdjustmentStatus, { icon: ReactNode; title: string; description: string }> = {
    review: {
      icon: <Inbox size={28} strokeWidth={1.75} />,
      title: "No assets to review",
      description: `Bill lines coded to a fixed-asset account above ${formatDetailAmount(threshold)} are drafted here with a proposed depreciation schedule.`,
    },
    active: {
      icon: <Monitor size={28} strokeWidth={1.75} />,
      title: "No active assets",
      description: "Published assets appear here and post depreciation every month.",
    },
    completed: {
      icon: <CheckCircle2 size={28} strokeWidth={1.75} />,
      title: "Nothing completed yet",
      description: "Fully depreciated and disposed assets move here.",
    },
    archived: {
      icon: <Archive size={28} strokeWidth={1.75} />,
      title: "No archived assets",
      description: "Assets you archive are kept here and can be restored to To review.",
    },
  };
  const empty = emptyCopy[status];
  const filtered = account !== ALL || period !== ALL;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <ReconciliationCard label="Fixed assets (net book value)" trackerBalance={trackerBalance} ledgerOffset={ledgerOffset} />
      {!detectionEnabled && <DisabledDetectionNote typeLabel="fixed assets" />}

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
          exportName="fixed asset register"
          actions={<AddMenuButton label="Add asset" onAdd={() => setAdding(true)} />}
        />
        <TrackerTable
          rows={rows}
          partyLabel="Vendor"
          releasedHeader="Depreciated to date"
          closingHeader={`Book value ${periodLabel(asOf)}`}
          onRowClick={(r) => setSelectedId(r.id)}
          emptyState={
            filtered ? (
              <EmptyState icon={empty.icon} title="No matches" description="Nothing matches these filters. Try another account or period." />
            ) : (
              <EmptyState
                icon={empty.icon}
                title={empty.title}
                description={empty.description}
                actionLabel={status === "review" ? "Add asset" : undefined}
                onAction={status === "review" ? () => setAdding(true) : undefined}
              />
            )
          }
        />
      </div>

      {selected && (
        <FixedAssetReviewModal
          key={selected.id + selected.status}
          asset={selected}
          onClose={() => setSelectedId(null)}
          onChange={upsert}
          onDispose={(a) => {
            setSelectedId(null);
            setDisposingId(a.id);
          }}
        />
      )}
      {disposing && <DisposeAssetModal asset={disposing} onClose={() => setDisposingId(null)} onDisposed={upsert} />}
      {adding && (
        <AddAssetModal
          onClose={() => setAdding(false)}
          onCreate={(a) => {
            upsert(a);
            setStatus("review");
          }}
        />
      )}
    </div>
  );
}
