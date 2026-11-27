"use client";

import { useEffect, useState } from "react";

import { SkeletonListRows } from "@/components/ui/Skeleton";
import { showToast } from "@/lib/dialogManager";
import { ALL_FEATURES_OFF, fetchSuggestionSettings, saveSuggestionSettings, type AutoClassification, type FeatureKey, type SuggestionSettingsDto } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// The company's Smart Suggestions settings (Autopilot > Settings):
// Auto-classification. Learning from the company's QuickBooks history has no
// switch on screen (Saurabh, 20 Nov): it is a per-company setting in the
// database (suggestion_settings.learnFromHistory, lib/bankFeeds/history.ts).
// There are no ScanTrix rules: the company's rules live in QuickBooks, and a
// line a QuickBooks rule coded shows here as already handled.

const MODES: { value: AutoClassification; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "No suggestions on bank lines or invoices." },
  {
    value: "suggest",
    label: "Suggest only",
    detail: "Every suggestion is shown in the vendor, GL and tax boxes with an AI sign, line by line. No group at the top and no Post all: a person checks and posts each line.",
  },
  {
    value: "fill",
    label: "Fill in when sure",
    detail: "Lines with 3 past lines on the same vendor, GL and tax are filled in and shown at the top, with Post all. Every other suggestion is shown in its line's boxes with an AI sign. Nothing is posted until a person clicks Post.",
  },
];

// Per-company switches for the 24 Nov features, in case one causes trouble (lib/bankFeeds/settings.ts).
const FEATURES: { key: FeatureKey; label: string; detail: string }[] = [
  { key: "aiPrefill", label: "Fill suggestions into the boxes", detail: "Show the best suggestion in the vendor, GL and tax boxes with an AI sign." },
  { key: "receiptWarning", label: "Warn when no receipt is attached", detail: "Ask \"Post it anyway?\" before posting a line with nothing attached." },
  { key: "autoMatch", label: "Find bills to match", detail: "Read open bills from your accounting software and offer Post bill & pay." },
  { key: "transferSuggestions", label: "Suggest transfers", detail: "Pair money that left one of your accounts and arrived in another." },
];

export function SettingsPanel() {
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

  const changeFeature = async (key: FeatureKey, on: boolean) => {
    if (!settings) return;
    setSaving(true);
    const result = await dispatch(saveSuggestionSettings({ features: { [key]: on } }));
    setSaving(false);
    if (!saveSuggestionSettings.fulfilled.match(result)) {
      showToast(result.payload?.message ?? "Couldn't change the setting.", "error");
      return;
    }
    setSettings(result.payload);
  };
  const features = settings?.features ?? ALL_FEATURES_OFF;

  return (
    <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
      <section className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
        <p className="text-body-sm font-bold text-content-primary">Auto-classification</p>
        <p className="text-caption text-content-secondary">How ScanTrix uses what it learned from your coding, on bank lines and invoices.</p>
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

      {settings && (
        <section className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
          <p className="text-body-sm font-bold text-content-primary">Bank Transactions features</p>
          <p className="text-caption text-content-secondary">Each one can be switched off for this company.</p>
          <div className="mt-[var(--space-sm)] grid gap-[var(--space-sm)] md:grid-cols-2">
            {FEATURES.map((f) => (
              <label key={f.key} className={`flex items-start gap-[var(--space-xs)] ${!settings.canChange || saving ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                <input type="checkbox" className="mt-1" checked={features[f.key]} disabled={!settings.canChange || saving} onChange={(e) => void changeFeature(f.key, e.target.checked)} />
                <span>
                  <span className="block text-body-sm font-semibold text-content-primary">{f.label}</span>
                  <span className="block text-caption text-content-secondary">{f.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
