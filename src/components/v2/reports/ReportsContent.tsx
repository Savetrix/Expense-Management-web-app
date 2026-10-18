"use client";

import { BarChart3, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { PageHeader, SelectDropdown, Tabs } from "@/components/v2/ui";
import { useEnsureInvoices } from "@/components/v2/autopilot/useEnsureInvoices";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";

import {
  customRange,
  filterInvoices,
  groupByGlAccount,
  groupByMonth,
  groupByVendor,
  presetRange,
  summarize,
  type RangePreset,
} from "./aggregate";
import { downloadCsv, toCsv } from "./csv";
import { monthRowsCsv, spendRowsCsv, taxRowsCsv, type CsvTable } from "./reportCsv";
import { MonthReport, SpendTable, TaxReport } from "./ReportViews";

type ReportTab = "vendor" | "month" | "gl" | "tax";

const TABS = [
  { value: "vendor", label: "Spend by vendor" },
  { value: "month", label: "Spend by month" },
  { value: "gl", label: "Spend by GL account" },
  { value: "tax", label: "Tax paid" },
];

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

const DATE_INPUT =
  "h-8 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";

export function ReportsContent() {
  const dispatch = useAppDispatch();
  useEnsureInvoices();

  const invoices = useAppSelector((s) => s.invoice.invoices);
  const loading = useAppSelector((s) => s.invoice.loading);
  const accounts = useAppSelector((s) => s.quickBooks.accounts);
  const accessToken = useAppSelector((s) => s.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);

  const [tab, setTab] = useState<ReportTab>("vendor");
  const [preset, setPreset] = useState<RangePreset>("this_year");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [postedOnly, setPostedOnly] = useState(false);

  // GL names come from the accounting software's account list, same as the
  // GL / tax codes page; only fetch when it isn't there yet.
  useEffect(() => {
    if (!accessToken || !qbConnectionId || accounts.length > 0) return;
    dispatch(fetchQuickBooksAccounts({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, qbConnectionId, dispatch]);

  const range = useMemo(
    () => (preset === "custom" ? customRange(from, to) : presetRange(preset)),
    [preset, from, to],
  );
  const filtered = useMemo(() => filterInvoices(invoices, { range, postedOnly }), [invoices, range, postedOnly]);
  const stats = useMemo(() => summarize(filtered), [filtered]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) {
      if (a.isDeleted) continue;
      if (a._id) map[a._id] = a.name;
      if (a.qbAccountId) map[a.qbAccountId] = a.name;
    }
    return map;
  }, [accounts]);

  const vendorRows = useMemo(() => groupByVendor(filtered), [filtered]);
  const glRows = useMemo(() => groupByGlAccount(filtered, names), [filtered, names]);
  const monthRows = useMemo(() => groupByMonth(filtered), [filtered]);

  const csvTable = (): CsvTable => {
    if (tab === "vendor") return spendRowsCsv("Vendor", vendorRows);
    if (tab === "gl") return spendRowsCsv("GL account", glRows);
    if (tab === "month") return monthRowsCsv(monthRows);
    return taxRowsCsv(monthRows);
  };

  const handleDownload = () => {
    const { headers, rows } = csvTable();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`scantrix-report-${tab}-${stamp}.csv`, toCsv(headers, rows));
  };

  const onPreset = (value: RangePreset) => {
    setPreset(value);
    if (value !== "custom") {
      setFrom("");
      setTo("");
    }
  };

  const statCards = [
    { label: "Invoices in range", value: stats.invoices },
    { label: "Vendors", value: stats.vendors },
    { label: "Posted", value: stats.posted },
    { label: "Held for review", value: stats.held },
  ];

  const showSkeleton = loading && invoices.length === 0;

  return (
    <div className="flex flex-col gap-[var(--space-lg)]">
      <PageHeader
        title="Reports"
        subtitle="Spend and tax from the invoices Scantrix has read for this company."
        action={
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" aria-hidden /> Download CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
        <SelectDropdown
          uiSize="sm"
          aria-label="Date range"
          value={preset}
          onChange={(e) => onPreset(e.target.value as RangePreset)}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </SelectDropdown>
        <input
          type="date"
          aria-label="From date"
          className={DATE_INPUT}
          value={from}
          max={to || undefined}
          onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
        />
        <span className="text-caption text-content-secondary">to</span>
        <input
          type="date"
          aria-label="To date"
          className={DATE_INPUT}
          value={to}
          min={from || undefined}
          onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
        />
        <Tabs
          items={[{ value: "all", label: "All invoices" }, { value: "posted", label: "Posted only" }]}
          value={postedOnly ? "posted" : "all"}
          onChange={(v) => setPostedOnly(v === "posted")}
        />
      </div>

      <div className="grid grid-cols-2 gap-[var(--space-sm)] md:grid-cols-4">
        {statCards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
            <p className="text-body-sm font-medium text-content-secondary">{c.label}</p>
            <p className="mt-[var(--space-xs)] text-h2 font-bold text-content-primary">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="max-w-full overflow-x-auto">
        <Tabs items={TABS} value={tab} onChange={(v) => setTab(v as ReportTab)} />
      </div>

      {showSkeleton ? (
        <SkeletonListRows count={4} />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<BarChart3 className="h-8 w-8" aria-hidden />}
            title="No invoices in this range"
            description={
              postedOnly
                ? "No posted invoices match these dates. Try All invoices or a wider range."
                : "Try a wider date range, or upload invoices to see them here."
            }
          />
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          {tab === "vendor" && <SpendTable rows={vendorRows} firstHeader="Vendor" />}
          {tab === "gl" && <SpendTable rows={glRows} firstHeader="GL account" />}
          {tab === "month" && <MonthReport rows={monthRows} />}
          {tab === "tax" && <TaxReport rows={monthRows} />}
        </div>
      )}
    </div>
  );
}
