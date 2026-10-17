"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, PageHeader, SearchInput, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { STATUS_META, formatDate, formatPeriod, money, summarize } from "./format";
import { MOCK_BILLS, MOCK_STATEMENTS, MOCK_VENDORS, mockExtractedLines, type StatementStatus, type SupplierStatement } from "./mockData";
import { StatementDetailModal } from "./StatementDetailModal";
import { UploadStatementModal } from "./UploadStatementModal";

type StatusTab = "all" | StatementStatus;

// How long the mock "processing" step takes before lines appear.
const MOCK_PROCESSING_MS = 2500;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierStatementsContentV2() {
  const provider = useActiveProvider();
  const [statements, setStatements] = useState<SupplierStatement[]>(MOCK_STATEMENTS);
  const [tab, setTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const counts = useMemo(() => {
    const c = { all: statements.length, processing: 0, needs_matching: 0, reconciled: 0 };
    statements.forEach((s) => (c[s.status] += 1));
    return c;
  }, [statements]);

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return statements
      .filter((s) => tab === "all" || s.status === tab)
      .filter((s) => !lower || s.vendor.toLowerCase().includes(lower) || s.fileName.toLowerCase().includes(lower));
  }, [statements, tab, search]);

  const updateStatement = useCallback((id: string, update: (s: SupplierStatement) => SupplierStatement) => {
    setStatements((list) => list.map((s) => (s.id === id ? update(s) : s)));
  }, []);

  const handleUpload = (file: File, vendor: string) => {
    notifyBackendPending("Upload");
    const id = `st-${Date.now()}`;
    const today = todayYmd();
    const draft: SupplierStatement = {
      id,
      vendor: vendor || "Detecting vendor…",
      statementDate: today,
      periodStart: today,
      periodEnd: today,
      currency: "CAD",
      balance: 0,
      status: "processing",
      source: "Upload",
      fileName: file.name,
      lines: [],
    };
    setStatements((list) => [draft, ...list]);
    setUploadOpen(false);
    setTab("all");

    // Mock the backend's extraction + auto-matching pass.
    timers.current.push(
      setTimeout(() => {
        const detectedVendor = vendor || "Office Depot";
        const lines = mockExtractedLines(detectedVendor);
        updateStatement(id, (s) => ({
          ...s,
          vendor: detectedVendor,
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          balance: Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100,
          status: "needs_matching",
          lines,
        }));
        showToast(`Statement from ${detectedVendor} is ready to match.`, "success");
      }, MOCK_PROCESSING_MS),
    );
  };

  const openStatement = statements.find((s) => s.id === openId) ?? null;

  const columns: DataTableColumn<SupplierStatement>[] = [
    {
      key: "vendor",
      header: "Vendor",
      width: "26%",
      render: (s) => (
        <span className="block min-w-0 py-[var(--space-xs)]">
          <span className="block truncate font-bold text-content-primary">{s.vendor}</span>
          <span className="block truncate text-content-secondary">{s.fileName}</span>
        </span>
      ),
    },
    { key: "date", header: "Statement date", width: "15%", render: (s) => <span className="block truncate">{formatDate(s.statementDate)}</span> },
    {
      key: "period",
      header: "Period",
      width: "24%",
      render: (s) => (
        <span className="block truncate text-content-secondary">{s.status === "processing" ? "—" : formatPeriod(s.periodStart, s.periodEnd)}</span>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      width: "15%",
      render: (s) => {
        if (s.status === "processing") return <span className="text-content-muted">—</span>;
        const sum = summarize(s, MOCK_BILLS);
        return (
          <span className="block truncate">
            <span className="font-semibold">{sum.total}</span>
            {s.status === "needs_matching" && <span className="text-content-secondary"> · {sum.total - sum.resolved} open</span>}
          </span>
        );
      },
    },
    {
      key: "balance",
      header: "Balance",
      width: "12%",
      align: "right",
      render: (s) => <span className="block truncate font-semibold">{s.status === "processing" ? "—" : money(s.balance, s.currency)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      align: "right",
      render: (s) => <Badge variant={STATUS_META[s.status].variant}>{STATUS_META[s.status].label}</Badge>,
    },
  ];

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Supplier Statements"
        subtitle={`Check vendor statements line by line against the bills in Scantrix before they reach ${provider.name}.`}
        action={
          <Button size="sm" className="shrink-0" onClick={() => setUploadOpen(true)}>
            <Upload size={16} strokeWidth={2.5} />
            Upload statement
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center">
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={[
                { value: "all", label: "All", count: counts.all },
                { value: "needs_matching", label: "Needs matching", count: counts.needs_matching },
                { value: "processing", label: "Processing", count: counts.processing },
                { value: "reconciled", label: "Reconciled", count: counts.reconciled },
              ]}
              value={tab}
              onChange={(v) => setTab(v as StatusTab)}
            />
          </div>
          {statements.length > 0 && (
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor or file…"
              widthClassName="w-full lg:w-80"
            />
          )}
        </div>

        {statements.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet size={28} strokeWidth={1.75} />}
            title="No statements yet"
            description="Upload a vendor statement, or email one to your Scantrix inbox, and each line will be checked against your bills."
            actionLabel="Upload statement"
            onAction={() => setUploadOpen(true)}
          />
        ) : filtered.length === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">
            {search.trim() ? <>No statements match &quot;{search}&quot;.</> : "No statements with this status."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <DataTable
                columns={columns}
                rows={filtered}
                getRowKey={(s) => s.id}
                onRowClick={(s) => setOpenId(s.id)}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        )}
      </div>

      <UploadStatementModal open={uploadOpen} vendors={MOCK_VENDORS} onClose={() => setUploadOpen(false)} onUpload={handleUpload} />

      <StatementDetailModal statement={openStatement} bills={MOCK_BILLS} onClose={() => setOpenId(null)} onChange={updateStatement} />
    </div>
  );
}
