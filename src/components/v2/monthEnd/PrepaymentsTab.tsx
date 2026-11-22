"use client";

import { Archive, CalendarClock, CheckCircle2, Inbox } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import type { PrepaymentDisplayStatus, PrepaymentDto } from "@/store/monthEnd/monthEndApi";

import { formatMoney, rangeLabel, STATUS_LABELS } from "./format";
import { StatusBadge } from "./shared";

const ALL = "all";

const EMPTY: Record<PrepaymentDisplayStatus, { icon: ReactNode; title: string; description: string }> = {
  review: {
    icon: <Inbox size={28} strokeWidth={1.75} />,
    title: "Nothing to review",
    description: "When an invoice covering more than a month is posted to the prepaid account, its schedule lands here for you to check.",
  },
  active: {
    icon: <CalendarClock size={28} strokeWidth={1.75} />,
    title: "No active prepayments",
    description: "Published schedules show here until their last month has been released.",
  },
  completed: {
    icon: <CheckCircle2 size={28} strokeWidth={1.75} />,
    title: "Nothing completed yet",
    description: "Schedules move here once their final month has been released.",
  },
  archived: {
    icon: <Archive size={28} strokeWidth={1.75} />,
    title: "No archived prepayments",
    description: "Archived schedules are kept here and can be restored to To review.",
  },
};

interface Props {
  prepayments: PrepaymentDto[];
  loading: boolean;
  /** The list couldn't be loaded — never shown as "nothing here". */
  failed?: boolean;
  onOpen: (prepayment: PrepaymentDto) => void;
}

/** One line per prepayment (PRD): vendor, total, months and the accounts it moves from and to. */
export function PrepaymentsTab({ prepayments, loading, failed = false, onOpen }: Props) {
  const [status, setStatus] = useState<PrepaymentDisplayStatus>("review");
  const [account, setAccount] = useState(ALL);

  const counts = useMemo(() => {
    const c: Record<PrepaymentDisplayStatus, number> = { review: 0, active: 0, completed: 0, archived: 0 };
    prepayments.forEach((p) => (c[p.displayStatus] += 1));
    return c;
  }, [prepayments]);

  const accountOptions = useMemo(
    () => Array.from(new Set(prepayments.map((p) => p.pnlAccountName ?? p.pnlAccountId).filter((a): a is string => !!a))).sort(),
    [prepayments],
  );

  const rows = prepayments.filter((p) => p.displayStatus === status).filter((p) => account === ALL || (p.pnlAccountName ?? p.pnlAccountId) === account);

  const columns: DataTableColumn<PrepaymentDto>[] = [
    { key: "vendor", header: "Vendor", width: "170px", render: (p) => <span className="block truncate font-bold">{p.vendorName ?? "—"}</span> },
    { key: "source", header: "Invoice", width: "110px", render: (p) => <span className="block truncate text-content-secondary">{p.sourceRef ?? "—"}</span> },
    { key: "total", header: "Total", width: "120px", align: "right", render: (p) => <span className="font-semibold">{formatMoney(p.total, p.currency)}</span> },
    { key: "months", header: "Months", width: "80px", align: "right", render: (p) => p.months },
    { key: "period", header: "Service period", width: "210px", render: (p) => <span className="block truncate text-content-secondary">{rangeLabel(p.startDate, p.endDate)}</span> },
    {
      key: "accounts",
      header: "From → to",
      width: "230px",
      render: (p) => (
        <span className="block truncate text-content-secondary" title={`${p.balanceAccountName ?? "—"} → ${p.pnlAccountName ?? "—"}`}>
          {p.balanceAccountName ?? "—"} → {p.pnlAccountName ?? "—"}
        </span>
      ),
    },
    { key: "balance", header: "Balance today", width: "130px", align: "right", render: (p) => formatMoney(p.balance, p.currency) },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (p) => (
        <span className="flex items-center gap-1">
          <StatusBadge status={p.displayStatus} />
          {p.failedCount > 0 && <span className="text-caption font-semibold text-error">{p.failedCount} failed</span>}
          {p.posting && <span className="text-caption text-content-secondary">{p.postingJob === "archive" ? "removing…" : "posting…"}</span>}
        </span>
      ),
    },
  ];

  const empty = EMPTY[status];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-full overflow-x-auto">
          <Tabs
            items={(Object.keys(STATUS_LABELS) as PrepaymentDisplayStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s], count: counts[s] }))}
            value={status}
            onChange={(v) => setStatus(v as PrepaymentDisplayStatus)}
          />
        </div>
        <SelectDropdown uiSize="sm" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Filter by expense account" className="max-w-[240px]">
          <option value={ALL}>All expense accounts</option>
          {accountOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </SelectDropdown>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(p) => p._id}
        onRowClick={onOpen}
        bordered={false}
        maxHeightClassName="max-h-[560px]"
        emptyState={
          loading ? (
            <p className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">Loading prepayments…</p>
          ) : failed ? (
            <p className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">Couldn&apos;t load prepayments — try again above.</p>
          ) : account !== ALL ? (
            <EmptyState icon={empty.icon} title="No matches" description="Nothing matches this account. Try another one." />
          ) : (
            <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
          )
        }
      />
    </div>
  );
}
