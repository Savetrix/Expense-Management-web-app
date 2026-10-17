"use client";

import { CalendarRange, Download } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { DataTable, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

import { USAGE, USAGE_RANGE_LABELS, type UsageRange, type UsageRow } from "./mockData";

type UsageView = "companies" | "users";

const percent = (row: Pick<UsageRow, "autopublished" | "published">) =>
  row.published > 0 ? Math.round((row.autopublished / row.published) * 100) : 0;

const num = (value: number) => value.toLocaleString("en-US");

export function UsagePanel() {
  const [range, setRange] = useState<UsageRange>("thisMonth");
  const [view, setView] = useState<UsageView>("companies");
  const [exporting, setExporting] = useState(false);

  const rows = USAGE[range][view];
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          processed: acc.processed + r.processed,
          published: acc.published + r.published,
          autopublished: acc.autopublished + r.autopublished,
          adjustments: acc.adjustments + r.adjustments,
        }),
        { processed: 0, published: 0, autopublished: 0, adjustments: 0 },
      ),
    [rows],
  );

  const handleExport = () => {
    setExporting(true);
    notifyBackendPending("Export CSV");
    window.setTimeout(() => setExporting(false), 500);
  };

  const columns: DataTableColumn<UsageRow>[] = [
    {
      key: "name",
      header: view === "companies" ? "Company" : "User",
      width: "28%",
      render: (r) => <span className="block truncate py-[var(--space-sm)] font-bold text-content-primary">{r.name}</span>,
    },
    { key: "processed", header: "Processed", align: "right", width: "14%", render: (r) => num(r.processed) },
    { key: "published", header: "Published", align: "right", width: "14%", render: (r) => num(r.published) },
    { key: "autopublished", header: "Autopublished", align: "right", width: "16%", render: (r) => num(r.autopublished) },
    { key: "rate", header: "Autopublish %", align: "right", width: "14%", render: (r) => <span className="font-semibold">{percent(r)}%</span> },
    { key: "adjustments", header: "Adjustments", align: "right", width: "14%", render: (r) => num(r.adjustments) },
  ];

  return (
    <div>
      <div className="flex flex-col gap-[var(--space-md)] border-b border-border p-[var(--space-md)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <Tabs
            items={[
              { value: "companies", label: "Companies" },
              { value: "users", label: "Users" },
            ]}
            value={view}
            onChange={(v) => setView(v as UsageView)}
          />
          <SelectDropdown
            uiSize="sm"
            icon={<CalendarRange size={14} strokeWidth={2.25} />}
            value={range}
            onChange={(e) => setRange(e.target.value as UsageRange)}
            aria-label="Date range"
          >
            {(Object.keys(USAGE_RANGE_LABELS) as UsageRange[]).map((key) => (
              <option key={key} value={key}>
                {USAGE_RANGE_LABELS[key]}
              </option>
            ))}
          </SelectDropdown>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} loading={exporting} className="shrink-0">
          {!exporting && <Download size={16} strokeWidth={2.25} />}
          {beLabel("Export CSV")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-[var(--space-md)] p-[var(--space-md)] sm:grid-cols-4">
        {[
          { label: "Processed", value: num(totals.processed) },
          { label: "Published", value: num(totals.published) },
          { label: "Autopublished", value: `${num(totals.autopublished)} (${percent(totals)}%)` },
          { label: "Adjustments detected", value: num(totals.adjustments) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-page p-[var(--space-md)]">
            <p className="text-caption text-content-secondary">{s.label}</p>
            <p className="mt-[var(--space-xs)] text-h3 font-bold text-content-primary">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border-t border-border">
        <div className="min-w-[640px]">
          <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} bordered={false} />
        </div>
      </div>
      <p className="border-t border-border p-[var(--space-md)] text-caption text-content-secondary">
        Autopublish % is autopublished ÷ published for the selected range. Only documents that were published count — items
        still in review aren&apos;t included. Adjustments are edits made after a document was autopublished.
      </p>
    </div>
  );
}
