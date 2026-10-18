"use client";

import { Archive, CheckCircle2, ChevronDown, ChevronUp, Inbox, Receipt, Sparkles } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { AccrualDetailModal, AddAccrualModal, AddAdjustmentModal } from "./AccrualModals";
import { currentPeriod, dateLabel, formatMoney, periodOf, round2, todayIso } from "./schedule";
import { ALL, AddMenuButton, DisabledDetectionNote, ReconciliationCard, SECTION_TITLE_CLASS, TrackerTable, TrackerToolbar, countByStatus } from "./shared";
import type { TrackerRow } from "./shared";
import type { Accrual, AccrualReversal, AdjustmentStatus } from "./types";

interface Props {
  accruals: Accrual[];
  onAccrualsChange: (updater: (accruals: Accrual[]) => Accrual[]) => void;
  reversals: AccrualReversal[];
  onReversalsChange: (updater: (reversals: AccrualReversal[]) => AccrualReversal[]) => void;
  detectionEnabled: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function batchLabel(iso: string): { key: string; label: string } {
  const [y, m] = iso.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  return { key: `${y}-Q${q + 1}`, label: `Reversals ${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]} ${y}` };
}

export function AccruedExpensesTab({ accruals, onAccrualsChange, reversals, onReversalsChange, detectionEnabled }: Props) {
  const provider = useActiveProvider();
  const [status, setStatus] = useState<AdjustmentStatus>("review");
  const [account, setAccount] = useState(ALL);
  const [period, setPeriod] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set());

  const counts = countByStatus(accruals);
  const accountOptions = useMemo(() => Array.from(new Set(accruals.map((a) => a.expenseAccount))).sort(), [accruals]);
  const reversalFor = (id: string) => reversals.find((r) => r.accrualId === id);
  const filtered = account !== ALL || period !== ALL;

  const visible = accruals
    .filter((a) => a.status === status)
    .filter((a) => account === ALL || a.expenseAccount === account)
    .filter((a) => {
      if (period === ALL) return true;
      const rev = reversalFor(a.id);
      const end = rev ? periodOf(rev.date) : a.status === "active" ? currentPeriod() : periodOf(a.date);
      return periodOf(a.date) <= period && period <= end;
    });

  const rows: TrackerRow[] = visible.map((a) => {
    const rev = reversalFor(a.id);
    const reversed = a.status === "completed" ? a.amount : 0;
    return {
      id: a.id,
      description: a.description,
      party: a.vendor,
      sourceRef: rev?.billRef ?? a.matchedBill?.ref ?? "",
      account: a.expenseAccount,
      total: a.amount,
      range: `${dateLabel(a.date)} – ${rev ? dateLabel(rev.date) : a.status === "active" ? "open" : "—"}`,
      released: reversed,
      closing: a.status === "active" ? a.amount : 0,
      status: a.status,
      statusLabel: a.status === "active" && a.trackOnly ? "Track only" : undefined,
    };
  });

  const trackerBalance = round2(accruals.filter((a) => a.status === "active").reduce((s, a) => s + a.amount, 0));
  const pendingReversals = accruals.filter((a) => a.status === "active" && a.matchedBill);

  const batches = useMemo(() => {
    const map = new Map<string, { label: string; items: AccrualReversal[] }>();
    [...reversals]
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((r) => {
        const { key, label } = batchLabel(r.date);
        if (!map.has(key)) map.set(key, { label, items: [] });
        map.get(key)!.items.push(r);
      });
    return Array.from(map.entries());
  }, [reversals]);

  const update = (a: Accrual) => onAccrualsChange((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [a, ...list]));

  const approve = (a: Accrual) => {
    notifyBackendPending("Approve & post");
    update({ ...a, status: "active" });
    showToast(`Accrual posted to ${provider.name}. It reverses when the bill arrives.`, "success");
  };
  const dismiss = (a: Accrual) => {
    notifyBackendPending("Dismiss");
    update({ ...a, status: "archived" });
  };
  const reverse = (accrualId: string, data: Omit<AccrualReversal, "id" | "accrualId" | "description">) => {
    const original = accruals.find((a) => a.id === accrualId);
    if (!original) return;
    onReversalsChange((list) => [{ id: `rv-${Date.now()}`, accrualId, description: `Reverse: ${original.description}`, ...data }, ...list]);
    update({ ...original, status: "completed", matchedBill: undefined });
  };
  const postReversal = (a: Accrual) => {
    notifyBackendPending("Post reversal");
    reverse(a.id, { amount: a.amount, date: todayIso(), billRef: a.matchedBill?.ref });
    showToast("Reversal posted — the accrual moved to Completed.", "success");
  };
  const toggleBatch = (key: string) =>
    setOpenBatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const emptyCopy: Record<AdjustmentStatus, { icon: ReactNode; title: string; description: string }> = {
    review: {
      icon: <Inbox size={28} strokeWidth={1.75} />,
      title: "No suggested accruals",
      description: "When a recurring bill hasn't arrived by month end, Scantrix suggests an accrual here based on previous bills.",
    },
    active: { icon: <Receipt size={28} strokeWidth={1.75} />, title: "No open accruals", description: "Approved and manual accruals stay here until their bill arrives." },
    completed: { icon: <CheckCircle2 size={28} strokeWidth={1.75} />, title: "Nothing reversed yet", description: "Accruals move here once they've been reversed against the real bill." },
    archived: { icon: <Archive size={28} strokeWidth={1.75} />, title: "No archived accruals", description: "Dismissed suggestions and archived accruals are kept here." },
  };
  const empty = emptyCopy[status];
  const emptyNode = filtered ? (
    <EmptyState icon={empty.icon} title="No matches" description="Nothing matches these filters. Try another account or period." />
  ) : (
    <EmptyState
      icon={empty.icon}
      title={empty.title}
      description={empty.description}
      actionLabel={status === "active" ? "Add accrued expense" : undefined}
      onAction={status === "active" ? () => setAdding(true) : undefined}
    />
  );

  const selected = accruals.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <ReconciliationCard label="Accrued expenses" trackerBalance={trackerBalance} />
      {!detectionEnabled && <DisabledDetectionNote typeLabel="accrued expenses" />}

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
          exportName="accrued expenses"
          actions={
            <>
              {status === "active" && (
                <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
                  Add adjustment
                </Button>
              )}
              <AddMenuButton label="Add accrued expense" onAdd={() => setAdding(true)} />
            </>
          }
        />

        {status === "review" ? (
          visible.length === 0 ? (
            emptyNode
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((a) => (
                <li key={a.id} className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)] md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-alt text-content-secondary">
                      <Sparkles size={18} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-sm font-bold text-content-primary">
                        {a.description} · {formatMoney(a.amount)}
                      </p>
                      <p className="text-caption text-content-secondary">
                        {a.vendor} · accrue at {dateLabel(a.date)} · {a.expenseAccount}
                      </p>
                      {a.basis && <p className="mt-[var(--space-xs)] text-caption text-content-secondary">{a.basis}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-[var(--space-sm)]">
                    <Button variant="outline" size="sm" onClick={() => dismiss(a)}>
                      {beLabel("Dismiss")}
                    </Button>
                    <Button size="sm" onClick={() => approve(a)}>
                      {beLabel("Approve & post")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {status === "active" && pendingReversals.length > 0 && (
              <div className="flex flex-col gap-[var(--space-sm)] border-b border-border p-[var(--space-md)]">
                <p className={SECTION_TITLE_CLASS}>Bills arrived — reversal suggested</p>
                {pendingReversals.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-col gap-[var(--space-sm)] rounded-md border border-status-info-border bg-status-info-bg p-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-body-sm text-status-info-text">
                      <span className="font-semibold">{a.matchedBill!.ref}</span> from {a.vendor} arrived on {dateLabel(a.matchedBill!.date)} for{" "}
                      {formatMoney(a.matchedBill!.amount)}. Reverse the {formatMoney(a.amount)} accrual &ldquo;{a.description}&rdquo;?
                    </p>
                    <Button size="sm" className="shrink-0" onClick={() => postReversal(a)}>
                      {beLabel("Post reversal")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <TrackerTable
              rows={rows}
              partyLabel="Vendor"
              releasedHeader="Reversed"
              closingHeader="Open balance"
              onRowClick={(r) => setSelectedId(r.id)}
              emptyState={emptyNode}
            />
            {status === "active" && batches.length > 0 && (
              <div className="flex flex-col gap-[var(--space-sm)] border-t border-border p-[var(--space-md)]">
                <p className={SECTION_TITLE_CLASS}>Reversal batches</p>
                {batches.map(([key, batch]) => {
                  const open = openBatches.has(key);
                  const total = round2(batch.items.reduce((s, r) => s + r.amount, 0));
                  return (
                    <div key={key} className="rounded-md border border-border">
                      <div className="flex items-center justify-between gap-[var(--space-sm)] p-[var(--space-sm)]">
                        <div className="min-w-0">
                          <p className="text-body-sm font-semibold text-content-primary">{batch.label}</p>
                          <p className="text-caption text-content-secondary">
                            {batch.items.length} reversal{batch.items.length === 1 ? "" : "s"} · {formatMoney(total)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleBatch(key)}
                          aria-expanded={open}
                          className="inline-flex h-8 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt"
                        >
                          {open ? "Hide" : "Show"}
                          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                      {open && (
                        <ul className="divide-y divide-border border-t border-border">
                          {batch.items.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] px-[var(--space-sm)] py-[var(--space-xs)] text-caption">
                              <span className="min-w-0 truncate text-content-primary">{r.description}</span>
                              <span className="flex items-center gap-[var(--space-sm)] text-content-secondary">
                                {dateLabel(r.date)}
                                {r.billRef && <Badge variant="neutral">{r.billRef}</Badge>}
                                <span className="font-semibold text-content-primary">{formatMoney(r.amount)}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <AccrualDetailModal key={selected.id + selected.status} accrual={selected} reversal={reversalFor(selected.id)} onClose={() => setSelectedId(null)} onChange={update} />
      )}
      {adding && (
        <AddAccrualModal
          onClose={() => setAdding(false)}
          onCreate={(a) => {
            update(a);
            setStatus("active");
          }}
        />
      )}
      {adjusting && (
        <AddAdjustmentModal
          activeAccruals={accruals.filter((a) => a.status === "active")}
          onClose={() => setAdjusting(false)}
          onCreate={update}
          onReverse={reverse}
        />
      )}
    </div>
  );
}
