"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { AccruedExpensesTab } from "./AccruedExpensesTab";
import { AmortisationTab } from "./AmortisationTab";
import { DetectionSettingsModal } from "./DetectionSettingsModal";
import { FixedAssetsTab } from "./FixedAssetsTab";
import { DEFAULT_SETTINGS, LEDGER_OFFSETS, MOCK_ACCRUALS, MOCK_ASSETS, MOCK_DEFERRED, MOCK_PREPAYMENTS, MOCK_REVERSALS } from "./mockData";
import type { Accrual, AccrualReversal, AdjustmentType, AmortisationItem, DetectionSettings, FixedAsset } from "./types";

const TAB_LABELS: Record<AdjustmentType, string> = {
  prepayments: "Prepayments",
  deferred: "Deferred income",
  fixedAssets: "Fixed assets",
  accruals: "Accrued expenses",
};

// Month-end adjustments run entirely on local state seeded from mockData.ts
// until the month-end API exists — every backend action is marked "(BE)".
export function MonthEndContentV2() {
  const provider = useActiveProvider();
  const [tab, setTab] = useState<AdjustmentType>("prepayments");
  const [settings, setSettings] = useState<DetectionSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prepayments, setPrepayments] = useState<AmortisationItem[]>(MOCK_PREPAYMENTS);
  const [deferred, setDeferred] = useState<AmortisationItem[]>(MOCK_DEFERRED);
  const [assets, setAssets] = useState<FixedAsset[]>(MOCK_ASSETS);
  const [accruals, setAccruals] = useState<Accrual[]>(MOCK_ACCRUALS);
  const [reversals, setReversals] = useState<AccrualReversal[]>(MOCK_REVERSALS);

  const toReview = (list: { status: string }[]) => list.filter((i) => i.status === "review").length;
  const counts: Record<AdjustmentType, number> = {
    prepayments: toReview(prepayments),
    deferred: toReview(deferred),
    fixedAssets: toReview(assets),
    accruals: toReview(accruals),
  };

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Month-End Adjustments"
        subtitle={`Scantrix spots prepayments, deferred income, fixed assets and missing bills as invoices arrive, then posts the journals to ${provider.name} each month.`}
        action={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="shrink-0">
            <SlidersHorizontal size={16} strokeWidth={2.25} />
            Detection settings
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)] max-w-full overflow-x-auto">
        <Tabs
          items={(Object.keys(TAB_LABELS) as AdjustmentType[]).map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))}
          value={tab}
          onChange={(v) => setTab(v as AdjustmentType)}
        />
      </div>
      <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Counts show items waiting for your review.</p>

      <div className="mt-[var(--space-md)]">
        {tab === "prepayments" && (
          <AmortisationTab
            key="prepayment"
            kind="prepayment"
            items={prepayments}
            onItemsChange={setPrepayments}
            defaultProration={settings.proration}
            detectionEnabled={settings.enabled.prepayments}
            ledgerOffset={LEDGER_OFFSETS.prepayments}
          />
        )}
        {tab === "deferred" && (
          <AmortisationTab
            key="deferred"
            kind="deferred"
            items={deferred}
            onItemsChange={setDeferred}
            defaultProration={settings.proration}
            detectionEnabled={settings.enabled.deferred}
            ledgerOffset={LEDGER_OFFSETS.deferred}
          />
        )}
        {tab === "fixedAssets" && (
          <FixedAssetsTab
            assets={assets}
            onAssetsChange={setAssets}
            threshold={settings.threshold}
            detectionEnabled={settings.enabled.fixedAssets}
            ledgerOffset={LEDGER_OFFSETS.fixedAssets}
          />
        )}
        {tab === "accruals" && (
          <AccruedExpensesTab
            accruals={accruals}
            onAccrualsChange={setAccruals}
            reversals={reversals}
            onReversalsChange={setReversals}
            detectionEnabled={settings.enabled.accruals}
            ledgerOffset={LEDGER_OFFSETS.accruals}
          />
        )}
      </div>

      {settingsOpen && <DetectionSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={setSettings} />}
    </div>
  );
}
