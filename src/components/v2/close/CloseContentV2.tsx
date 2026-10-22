"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Lock, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, ProgressBar, RoleInfoBanner, Tabs } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { ClosedPeriodsTab } from "./ClosedPeriodsTab";
import { CloseSectionCard } from "./CloseSectionCard";
import { PendingInvoicesSection, invoiceDateOf } from "./PendingInvoicesSection";
import { StartCloseModal } from "./StartCloseModal";
import { BankCloseSection, bankSummary, useBankUnsorted } from "./BankCloseSection";
import { WaitingSection, waitingSummary } from "./WaitingSection";
import { CARD_CLASS, SECTION_ORDER, SECTION_TITLES, date, sectionStatus, useCanManagePeriods, useCloseActor } from "./closeShared";
import { createWorkingPaper } from "./period";
import type { SectionKey, WorkingPaper } from "./types";

type CloseTab = "current" | "closed";

function invoiceSummary(loading: boolean, failed: boolean, count: number | null): string {
  if (loading) return "Loading invoices…";
  if (failed || count === null) return "Couldn't load invoices";
  return count ? `${count} unposted invoice${count === 1 ? "" : "s"}` : "Everything posted";
}

export function CloseContentV2() {
  const provider = useActiveProvider();
  const dispatch = useAppDispatch();
  const actor = useCloseActor();
  const { canManage, companyName } = useCanManagePeriods();
  const pendingInvoices = useAppSelector((state) => state.invoice.pendingInvoices);
  const invoicesFetching = useAppSelector((state) => state.invoice.invoicesFetchPending);

  const [tab, setTab] = useState<CloseTab>("current");
  const [current, setCurrent] = useState<WorkingPaper | null>(null);
  const [closed, setClosed] = useState<WorkingPaper[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  const [openSection, setOpenSection] = useState<SectionKey | null>("invoices");
  const [justClosed, setJustClosed] = useState<WorkingPaper | null>(null);
  // null = the invoice list hasn't settled yet; true/false = loaded OK / failed.
  const [invoicesOk, setInvoicesOk] = useState<boolean | null>(null);

  // Pending invoices are real data: load them for this company on mount.
  useEffect(() => {
    let cancelled = false;
    dispatch(getInvoices()).then((result) => {
      if (cancelled) return;
      const skipped = getInvoices.rejected.match(result) && result.meta.condition;
      setInvoicesOk(getInvoices.fulfilled.match(result) || Boolean(skipped));
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const lastClosedEnd = closed.reduce<string | undefined>((max, p) => (!max || p.periodEnd > max ? p.periodEnd : max), undefined);

  const dueInvoices = useMemo(
    () => (current ? pendingInvoices.filter((inv) => !invoiceDateOf(inv) || invoiceDateOf(inv) <= current.periodEnd) : []),
    [pendingInvoices, current],
  );
  const invoicesLoading = invoicesOk === null || invoicesFetching;
  const invoicesFailed = invoicesOk === false;
  const pendingCount = invoicesLoading || invoicesFailed ? null : dueInvoices.length;

  const handleStart = (start: string, end: string) => {
    notifyBackendPending("Start close");
    const paper = createWorkingPaper(start, end, actor);
    setCurrent(paper);
    setStartOpen(false);
    setJustClosed(null);
    setOpenSection("invoices");
    setTab("current");
    showToast(`${paper.name} started.`, "success");
  };

  const handleClosePeriod = async () => {
    if (!current) return;
    const ok = await confirmDialog({
      title: `Close ${current.name}?`,
      message: `Every balance is re-checked against ${provider.name} first. If nothing has changed since it was reconciled, the period is locked and the working paper becomes a read-only snapshot.`,
      confirmLabel: beLabel("Close period"),
    });
    if (!ok) return;
    notifyBackendPending("Close period");
    const closedPaper: WorkingPaper = { ...current, closedBy: actor, closedAt: new Date().toISOString() };
    setClosed((list) => [closedPaper, ...list]);
    setCurrent(null);
    setJustClosed(closedPaper);
    showToast(`${closedPaper.name} is closed and locked.`, "success");
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

  const bankCounts = useBankUnsorted(current?.periodEnd ?? null);
  const bankOpenCount = bankCounts ? bankCounts.toReview + bankCounts.readyToPost : null;
  const statuses = current
    ? SECTION_ORDER.map((key) => sectionStatus(key, { pendingInvoiceCount: pendingCount, bankOpenCount }, Boolean(current.touched[key])))
    : [];
  const doneCount = statuses.filter((s) => s === "done").length;
  const allDone = doneCount === SECTION_ORDER.length;
  const waitingCount = statuses.filter((s) => s === "waiting").length;

  const closeBlockedReason = !canManage
    ? `Closing needs the Manage periods permission on ${companyName}.`
    : waitingCount > 0
      ? `${waitingCount} section${waitingCount === 1 ? " is" : "s are"} waiting for data from ${provider.name} ${beLabel("").trim()}, so the period can't be shown as reconciled yet.`
      : !allDone
        ? `Finish all ${SECTION_ORDER.length} sections to close the period.`
        : "";

  const renderSection = (key: SectionKey, paper: WorkingPaper) =>
    key === "invoices" ? (
      <PendingInvoicesSection paper={paper} invoices={dueInvoices} loading={invoicesLoading} loadFailed={invoicesFailed} />
    ) : key === "bank" ? (
      <BankCloseSection counts={bankCounts} periodName={paper.name} />
    ) : (
      <WaitingSection section={key} />
    );

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

    const summaryFor = (key: SectionKey) =>
      key === "invoices" ? invoiceSummary(invoicesLoading, invoicesFailed, pendingCount) : key === "bank" ? bankSummary(bankCounts) : waitingSummary();

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

        <div className="m-[var(--space-md)] overflow-hidden rounded-md border border-border bg-surface">
          {SECTION_ORDER.map((key, i) => (
            <CloseSectionCard
              key={key}
              index={i + 1}
              title={SECTION_TITLES[key]}
              summary={summaryFor(key)}
              status={statuses[i]}
              open={openSection === key}
              onToggle={() => setOpenSection((s) => (s === key ? null : key))}
            >
              {renderSection(key, current)}
            </CloseSectionCard>
          ))}
        </div>

        <div className="flex flex-col gap-[var(--space-md)] border-t border-border bg-page p-[var(--space-md)]">
          <RoleInfoBanner>
            {canManage
              ? "Anyone on the team can prepare this working paper. Only users with the Manage periods permission can close the period."
              : `You can prepare this working paper — post, review and reconcile — but closing needs the Manage periods permission on ${companyName}.`}
          </RoleInfoBanner>
          <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-content-secondary">{closeBlockedReason || "All sections are done. Balances are re-checked when you close."}</p>
            <Button onClick={handleClosePeriod} disabled={Boolean(closeBlockedReason)} className="w-full sm:w-auto">
              <Lock size={16} strokeWidth={2.25} />
              {beLabel("Close period")}
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
