"use client";

import { History } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Switch } from "@/components/ui/Switch";
import { fetchHistoryState, requestHistoryRead, saveLearnFromHistory, type HistoryStateDto } from "@/components/v2/suggestions/historyClient";
import { showToast } from "@/lib/dialogManager";
import { formatPlainDate } from "@/lib/plainDate";
import { useAppSelector } from "@/store/hooks";

/**
 * "Learn from QuickBooks or Xero history" (lib/bankFeeds/history.ts): on by
 * default. Shows what was read and how many bank payees matched a vendor in
 * the books; the rest are left for step 3 (similar items).
 */
export function HistorySetting({ providerName }: { providerName: string }) {
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [state, setState] = useState<HistoryStateDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!qbConnectionId) return;
    setState(await fetchHistoryState(qbConnectionId));
  }, [qbConnectionId]);

  useEffect(() => {
    if (!qbConnectionId) return;
    let cancelled = false;
    void (async () => {
      // Opening the page reads the books if the last read is over a day old.
      await requestHistoryRead(qbConnectionId);
      if (!cancelled) setState(await fetchHistoryState(qbConnectionId));
    })();
    return () => {
      cancelled = true;
    };
  }, [qbConnectionId]);

  const toggle = async (on: boolean) => {
    if (!qbConnectionId) return;
    setBusy(true);
    const error = await saveLearnFromHistory(qbConnectionId, on);
    if (error) showToast(error, "error");
    else if (on) {
      const read = await requestHistoryRead(qbConnectionId, true);
      if (read.error) showToast(read.error, "error");
      else showToast(`Scantrix is learning from your ${providerName} history.`, "success");
    } else showToast(`Scantrix no longer uses your ${providerName} history. What it read was removed.`, "success");
    await load();
    setBusy(false);
  };

  if (!state) return null;
  const s = state.status;
  const line =
    !state.learnFromHistory
      ? "Off. Suggestions come only from what your team codes in Scantrix."
      : state.running
        ? `Reading the last 12 months from ${providerName}…`
        : !s
          ? `Not read yet. It is read when someone who can post opens Bank Transactions or this page.`
          : s.outcome === "provider_terms"
            ? `Not available for ${providerName}: its developer terms don't allow learning from its data.`
            : s.outcome === "real_company"
              ? "Coming soon for live companies. For now it works on sandbox (test) companies only."
              : s.outcome === "error"
                ? `The last read didn't finish${s.error ? `: ${s.error}` : ""}.`
                : `Read ${s.entries.toLocaleString()} entries (${s.lines.toLocaleString()} coded lines) from ${formatPlainDate(s.from ?? "", { day: "numeric", month: "short", year: "numeric" })} to ${formatPlainDate(
                    s.to ?? "",
                    { day: "numeric", month: "short", year: "numeric" },
                  )}${s.skippedScantrix ? `, leaving out ${s.skippedScantrix} that Scantrix posted itself` : ""}.`;

  return (
    <section className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
      <div className="flex items-start justify-between gap-[var(--space-md)]">
        <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
          <History size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-body-sm font-bold text-content-primary">Learn from QuickBooks or Xero history</p>
            <p className="text-caption text-content-secondary">
              Scantrix reads the last 12 months of your coding in {providerName} (bills, expenses, card charges, deposits and bill payments) and suggests
              the same accounts from day one. Nothing is posted, and no AI reads it.
            </p>
            <p className="mt-[var(--space-xs)] text-caption font-semibold text-content-primary">{line}</p>
            {state.learnFromHistory && s?.outcome === "done" && state.payees.total > 0 && (
              <p className="text-caption text-content-secondary">
                {state.payees.matched} of {state.payees.total} payees on your bank lines matched a vendor in {providerName}. The rest are matched once someone picks
                their vendor.
              </p>
            )}
          </div>
        </div>
        <span title={state.canChange ? undefined : "Only an Owner or Admin can change this."}>
          <Switch checked={state.learnFromHistory} onChange={(v) => void toggle(v)} disabled={busy || !state.canChange} label="Learn from QuickBooks or Xero history" />
        </span>
      </div>
    </section>
  );
}
