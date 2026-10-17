"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Lock, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, ProgressBar, RoleInfoBanner, Tabs } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { BalanceSheetSection } from "./BalanceSheetSection";
import { ClosedPeriodsTab } from "./ClosedPeriodsTab";
import { CloseSectionCard } from "./CloseSectionCard";
import { FixedAssetsSection } from "./FixedAssetsSection";
import { PayablesReceivablesSection } from "./PayablesReceivablesSection";
import { PendingAdjustmentsSection } from "./PendingAdjustmentsSection";
import { PendingInvoicesSection } from "./PendingInvoicesSection";
import { StartCloseModal } from "./StartCloseModal";
import {
  CARD_CLASS,
  SECTION_ORDER,
  SECTION_TITLES,
  accountIsReconciled,
  date,
  fixedAssetsMatched,
  money,
  sectionStatus,
  useCanManagePeriods,
  useCloseActor,
} from "./closeShared";
import { INITIAL_CLOSED_PERIODS, createWorkingPaper, newId, type SectionKey, type WorkingPaper } from "./mockData";
import type { CloseSectionProps } from "./sectionTypes";

type CloseTab = "current" | "closed";

const SECTION_COMPONENTS: Record<SectionKey, (props: CloseSectionProps) => ReactNode> = {
  invoices: PendingInvoicesSection,
  adjustments: PendingAdjustmentsSection,
  payablesReceivables: PayablesReceivablesSection,
  fixedAssets: FixedAssetsSection,
  balanceSheet: BalanceSheetSection,
};

/** Mock drift found on the first close attempt — the backend re-reads balances. */
const DRIFT_AMOUNT = 125;

function sectionSummary(wp: WorkingPaper, key: SectionKey): string {
  switch (key) {
    case "invoices":
      return wp.documents.length ? `${wp.documents.length} unposted document${wp.documents.length === 1 ? "" : "s"}` : "Everything posted";
    case "adjustments":
      return wp.adjustments.length ? `${wp.adjustments.length} adjustment${wp.adjustments.length === 1 ? "" : "s"} to post` : "All adjustments posted";
    case "payablesReceivables": {
      const flags = [...wp.payables, ...wp.receivables].filter((c) => c.flag && !c.resolution).length;
      const sides = Number(!!wp.payablesReconciled) + Number(!!wp.receivablesReconciled);
      return flags ? `${flags} flagged contact${flags === 1 ? "" : "s"} to review` : `${sides} of 2 ledgers reconciled`;
    }
    case "fixedAssets":
      return fixedAssetsMatched(wp) ? "Register agrees with ledger" : wp.fixedAssets.reconciled ? "Reconciled with justified difference" : "Register differs from ledger";
    case "balanceSheet": {
      const left = wp.accounts.filter((a) => !accountIsReconciled(a)).length;
      return left ? `${left} account${left === 1 ? "" : "s"} to reconcile` : "All accounts reconciled";
    }
  }
}

export function CloseContentV2() {
  const provider = useActiveProvider();
  const actor = useCloseActor();
  const { canManage, companyName } = useCanManagePeriods();

  const [tab, setTab] = useState<CloseTab>("current");
  const [current, setCurrent] = useState<WorkingPaper | null>(null);
  const [closed, setClosed] = useState<WorkingPaper[]>(INITIAL_CLOSED_PERIODS);
  const [startOpen, setStartOpen] = useState(false);
  const [openSection, setOpenSection] = useState<SectionKey | null>("invoices");
  const [closing, setClosing] = useState(false);
  const [driftAccountId, setDriftAccountId] = useState<string | null>(null);
  const [justClosed, setJustClosed] = useState<WorkingPaper | null>(null);

  const lastClosedEnd = closed.reduce<string | undefined>((max, p) => (!max || p.periodEnd > max ? p.periodEnd : max), undefined);

  const handleStart = (start: string, end: string) => {
    notifyBackendPending("Start close");
    const paper = createWorkingPaper(start, end, actor);
    setCurrent(paper);
    setStartOpen(false);
    setJustClosed(null);
    setDriftAccountId(null);
    setOpenSection("invoices");
    setTab("current");
    showToast(`${paper.name} started.`, "success");
  };

  const updateSection = (key: SectionKey) => (change: (wp: WorkingPaper) => WorkingPaper) =>
    setCurrent((wp) => (wp ? { ...change(wp), touched: { ...wp.touched, [key]: true } } : wp));

  const handleClosePeriod = async () => {
    if (!current) return;
    const ok = await confirmDialog({
      title: `Close ${current.name}?`,
      message: `Every balance is re-checked against ${provider.name} first. If nothing has changed since it was reconciled, the period is locked and the working paper becomes a read-only snapshot.`,
      confirmLabel: beLabel("Close period"),
    });
    if (!ok) return;
    notifyBackendPending("Close period");
    setClosing(true);
    // Simulated balance re-check; the backend will do this server-side.
    window.setTimeout(() => {
      setClosing(false);
      const drifted = !current.driftChecked ? current.accounts.find((a) => a.id === current.driftAccountId && a.reconciled) : undefined;
      if (drifted) {
        const now = new Date().toISOString();
        const newBalance = Math.round((drifted.ledgerBalance + DRIFT_AMOUNT) * 100) / 100;
        setCurrent({
          ...current,
          driftChecked: true,
          accounts: current.accounts.map((a) =>
            a.id === drifted.id
              ? {
                  ...a,
                  ledgerBalance: newBalance,
                  reconciled: undefined,
                  changeLog: [
                    ...a.changeLog,
                    { id: newId("log"), at: now, by: "System", message: `Balance changed in ${provider.name} from ${money(a.ledgerBalance)} to ${money(newBalance)} after reconciliation — marked unreconciled` },
                  ],
                }
              : a,
          ),
        });
        setDriftAccountId(drifted.id);
        setOpenSection("balanceSheet");
        showToast("Close blocked: 1 account changed since it was reconciled.", "warning");
        return;
      }
      const closedPaper: WorkingPaper = { ...current, driftChecked: true, closedBy: actor, closedAt: new Date().toISOString() };
      setClosed((list) => [closedPaper, ...list]);
      setCurrent(null);
      setDriftAccountId(null);
      setJustClosed(closedPaper);
      showToast(`${closedPaper.name} is closed and locked.`, "success");
    }, 900);
  };

  const handleExport = (paper: WorkingPaper) => {
    notifyBackendPending(`Export ${paper.name} to Excel`);
  };

  const handleReopen = async (paper: WorkingPaper) => {
    if (current) return;
    const ok = await confirmDialog({
      title: `Reopen ${paper.name}?`,
      message: "The period is unlocked so its working paper can be edited again. It must be closed again before the snapshot and export are updated.",
      confirmLabel: beLabel("Reopen period"),
      tone: "destructive",
    });
    if (!ok) return;
    notifyBackendPending("Reopen period");
    setClosed((list) => list.filter((p) => p.id !== paper.id));
    setCurrent({ ...paper, closedAt: undefined, closedBy: undefined });
    setJustClosed(null);
    setOpenSection(null);
    setTab("current");
  };

  const statuses = current ? SECTION_ORDER.map((key) => sectionStatus(current, key)) : [];
  const doneCount = statuses.filter((s) => s === "done").length;
  const allDone = doneCount === SECTION_ORDER.length;
  const driftAccount = current && driftAccountId ? current.accounts.find((a) => a.id === driftAccountId) : undefined;
  const showBlocked = Boolean(driftAccount && !driftAccount.reconciled);

  const renderCurrent = () => {
    if (!current) {
      if (justClosed) {
        return (
          <EmptyState
            tone="primary"
            icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
            title={`${justClosed.name} is closed`}
            description={`Balances matched ${provider.name} and the period is locked. The working paper is saved under Closed periods.`}
            actionLabel="View closed periods"
            onAction={() => setTab("closed")}
          />
        );
      }
      return (
        <EmptyState
          tone="primary"
          icon={<CalendarCheck size={28} strokeWidth={1.75} />}
          title={closed.length === 0 ? "Start your first close" : "No close in progress"}
          description="Work through posting, reviews and reconciliations for a period in one checklist, then lock it with a full working paper."
          actionLabel={closed.length === 0 ? "Start your first close" : "Start next close"}
          onAction={() => setStartOpen(true)}
        />
      );
    }

    return (
      <div className="flex flex-col">
        <div className="flex flex-col gap-[var(--space-sm)] border-b border-border p-[var(--space-md)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
            <div className="min-w-0">
              <h2 className="text-h3 font-bold text-content-primary">{current.name}</h2>
              <p className="text-caption text-content-secondary">
                {date(current.periodStart)} – {date(current.periodEnd)} · started by {current.createdBy}
              </p>
            </div>
            <span className="text-body-sm font-semibold text-content-primary">
              {doneCount} of {SECTION_ORDER.length} sections done
            </span>
          </div>
          <ProgressBar percent={(doneCount / SECTION_ORDER.length) * 100} label="Close progress" />
        </div>

        {showBlocked && driftAccount && (
          <div className="m-[var(--space-md)] mb-0 flex items-start gap-[var(--space-sm)] rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-danger-text">
            <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">1 account changed since it was reconciled — re-reconcile to close.</span> {driftAccount.code} ·{" "}
              {driftAccount.name} now shows {money(driftAccount.ledgerBalance)} in {provider.name}.
            </p>
          </div>
        )}

        <div className="m-[var(--space-md)] overflow-hidden rounded-md border border-border bg-surface">
          {SECTION_ORDER.map((key, i) => {
            const Section = SECTION_COMPONENTS[key];
            return (
              <CloseSectionCard
                key={key}
                index={i + 1}
                title={SECTION_TITLES[key]}
                summary={sectionSummary(current, key)}
                status={statuses[i]}
                open={openSection === key}
                onToggle={() => setOpenSection((s) => (s === key ? null : key))}
              >
                <Section paper={current} onUpdate={updateSection(key)} actor={actor} />
              </CloseSectionCard>
            );
          })}
        </div>

        <div className="flex flex-col gap-[var(--space-md)] border-t border-border bg-page p-[var(--space-md)]">
          <RoleInfoBanner>
            {canManage
              ? "Anyone on the team can prepare this working paper. Only users with the Manage periods permission can close the period."
              : `You can prepare this working paper — post, review and reconcile — but closing needs the Manage periods permission on ${companyName}.`}
          </RoleInfoBanner>
          <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-content-secondary">
              {allDone ? "All sections are done. Balances are re-checked when you close." : `Finish all ${SECTION_ORDER.length} sections to close the period.`}
            </p>
            <Button onClick={handleClosePeriod} disabled={!allDone || !canManage} loading={closing} className="w-full sm:w-auto">
              <Lock size={16} strokeWidth={2.25} />
              {closing ? "Re-checking balances…" : beLabel("Close period")}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Working Papers"
        subtitle="Month-end close checklist and working papers."
        action={
          !current && tab === "current" ? (
            <Button size="sm" onClick={() => setStartOpen(true)} className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              Start close
            </Button>
          ) : undefined
        }
      />
      <p className="mt-[var(--space-xs)] text-caption text-content-muted">Available for supported accounting software.</p>

      <div className={`mt-[var(--space-lg)] ${CARD_CLASS}`}>
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center">
          <Tabs
            items={[
              { value: "current", label: "Current close" },
              { value: "closed", label: "Closed periods", count: closed.length },
            ]}
            value={tab}
            onChange={(v) => setTab(v as CloseTab)}
          />
        </div>
        {tab === "current" ? (
          renderCurrent()
        ) : (
          <ClosedPeriodsTab periods={closed} hasOpenClose={!!current} canManage={canManage} onExport={handleExport} onReopen={handleReopen} />
        )}
      </div>

      <StartCloseModal open={startOpen} lastClosedEnd={lastClosedEnd} onClose={() => setStartOpen(false)} onStart={handleStart} />
    </div>
  );
}
