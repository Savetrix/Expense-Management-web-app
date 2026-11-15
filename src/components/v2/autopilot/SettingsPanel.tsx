"use client";

import { useEffect, useState } from "react";

import { SkeletonListRows } from "@/components/ui/Skeleton";
import { showToast } from "@/lib/dialogManager";
import { fetchSuggestionSettings, saveSuggestionSettings, type AutoClassification, type SuggestionSettingsDto } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { HistorySetting } from "./HistorySetting";

// The company's Smart Suggestions settings (Autopilot > Settings):
// Auto-classification, and learning from the company's QuickBooks history.
// There are no Scantrix rules: the company's rules live in QuickBooks, and a
// line a QuickBooks rule coded shows here as already handled.

const MODES: { value: AutoClassification; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "No suggestions on bank lines or invoices." },
  {
    value: "suggest",
    label: "Suggest only",
    detail: "The vendor, GL and tax boxes stay empty. Lines Scantrix is sure about go to the top of Bank Transactions, and other ideas appear in each box's dropdown under \"Suggested\".",
  },
  {
    value: "fill",
    label: "Fill in when sure",
    detail: "Lines with 3 past lines on the same vendor, GL and tax get them filled in, shown at the top of the list. Nothing is posted until a person clicks Post.",
  },
];

export function SettingsPanel({ providerName }: { providerName: string }) {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [settings, setSettings] = useState<SuggestionSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!qbConnectionId) return;
    let cancelled = false;
    void dispatch(fetchSuggestionSettings()).then((r) => {
      if (!cancelled && fetchSuggestionSettings.fulfilled.match(r)) setSettings(r.payload);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, qbConnectionId]);

  const changeMode = async (mode: AutoClassification) => {
    if (!settings || mode === settings.autoClassification) return;
    setSaving(true);
    const result = await dispatch(saveSuggestionSettings(mode));
    setSaving(false);
    if (!saveSuggestionSettings.fulfilled.match(result)) {
      showToast(result.payload?.message ?? "Couldn't change the setting.", "error");
      return;
    }
    setSettings(result.payload);
    showToast(`Auto-classification is now "${MODES.find((m) => m.value === mode)?.label ?? mode}". Bank lines to review were updated.`, "success");
  };

  return (
    <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
      <section className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
        <p className="text-body-sm font-bold text-content-primary">Auto-classification</p>
        <p className="text-caption text-content-secondary">How Scantrix uses what it learned from your coding, on bank lines and invoices.</p>
        {settings ? (
          <div className="mt-[var(--space-sm)] grid gap-[var(--space-sm)] md:grid-cols-3" role="radiogroup" aria-label="Auto-classification">
            {MODES.map((m) => {
              const checked = settings.autoClassification === m.value;
              return (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-start gap-[var(--space-xs)] rounded-md border px-[var(--space-sm)] py-[var(--space-xs)] ${
                    checked ? "border-accent bg-surface-alt" : "border-border"
                  } ${!settings.canChange || saving ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input type="radio" name="auto-classification" className="mt-1" checked={checked} disabled={!settings.canChange || saving} onChange={() => changeMode(m.value)} />
                  <span>
                    <span className="block text-body-sm font-semibold text-content-primary">{m.label}</span>
                    <span className="block text-caption text-content-secondary">{m.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-[var(--space-sm)]">
            <SkeletonListRows count={1} />
          </div>
        )}
        {settings && !settings.canChange && <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Only an Owner or Admin can change this.</p>}
      </section>

      <HistorySetting providerName={providerName} />
    </div>
  );
}
