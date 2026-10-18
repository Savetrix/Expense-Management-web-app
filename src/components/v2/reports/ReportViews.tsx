"use client";

import { DataTable, ProgressBar } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import { currenciesOf, totalsByCurrency, type Money, type MonthRow, type SpendRow } from "./aggregate";

export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries.map(([currency, amount]) => formatDetailAmount(amount, currency)).join(" · ");
}

const CARD = "rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm";

// ---------- Spend by vendor / GL account ----------

export function SpendTable({ rows, firstHeader }: { rows: SpendRow[]; firstHeader: string }) {
  const columns: DataTableColumn<SpendRow>[] = [
    {
      key: "label",
      header: firstHeader,
      width: "30%",
      render: (r) => <span className="block truncate font-semibold" title={r.label}>{r.label}</span>,
    },
    { key: "count", header: "Bills", width: "10%", align: "right", render: (r) => r.count },
    {
      key: "total",
      header: "Total",
      width: "20%",
      align: "right",
      render: (r) => <span className="font-semibold">{formatDetailAmount(r.total, r.currency)}</span>,
    },
    {
      key: "share",
      header: "Share",
      width: "22%",
      render: (r) => <ProgressBar percent={r.share} label={`${r.label} share of ${r.currency} spend`} />,
    },
    { key: "avg", header: "Average bill", width: "18%", align: "right", render: (r) => formatDetailAmount(r.average, r.currency) },
  ];
  return (
    <div className="min-w-[560px]">
      <DataTable columns={columns} rows={rows} getRowKey={(r) => `${r.currency}:${r.key}`} maxHeightClassName="max-h-[560px]" />
    </div>
  );
}

// ---------- Stacked per-currency cell ----------

function Stack({ row, pick }: { row: MonthRow; pick: (m: Money) => number }) {
  return (
    <div className="flex flex-col">
      {currenciesOf([row]).map((currency) => (
        <span key={currency}>{formatDetailAmount(pick(row.byCurrency[currency]), currency)}</span>
      ))}
    </div>
  );
}

// ---------- Spend by month ----------

export function MonthReport({ rows }: { rows: MonthRow[] }) {
  const currencies = currenciesOf(rows);
  const columns: DataTableColumn<MonthRow>[] = [
    { key: "month", header: "Month", width: "30%", render: (r) => <span className="font-semibold">{r.label}</span> },
    { key: "count", header: "Bills", width: "20%", align: "right", render: (r) => r.count },
    { key: "total", header: "Total", width: "50%", align: "right", render: (r) => <Stack row={r} pick={(m) => m.total} /> },
  ];
  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      {currencies.map((currency) => {
        const max = Math.max(...rows.map((r) => r.byCurrency[currency]?.total ?? 0), 0);
        return (
          <div key={currency} className={CARD}>
            <p className="mb-[var(--space-sm)] text-body-sm font-bold text-content-primary">Monthly spend, {currency}</p>
            <div className="flex flex-col gap-[var(--space-xs)]">
              {rows.map((r) => {
                const money = r.byCurrency[currency];
                if (!money) return null;
                const pct = max > 0 ? (Math.max(money.total, 0) / max) * 100 : 0;
                return (
                  <div key={r.key} className="flex items-center gap-[var(--space-sm)] text-caption">
                    <span className="w-16 shrink-0 text-content-secondary">{r.label}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded-sm bg-chart-4">
                      <div className="h-full rounded-sm bg-chart-1" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-right font-semibold text-content-primary sm:w-32">
                      {formatDetailAmount(money.total, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.key} maxHeightClassName="max-h-[480px]" />
    </div>
  );
}

// ---------- Tax paid ----------

export function TaxReport({ rows }: { rows: MonthRow[] }) {
  const columns: DataTableColumn<MonthRow>[] = [
    { key: "month", header: "Month", width: "16%", render: (r) => <span className="font-semibold">{r.label}</span> },
    { key: "count", header: "Bills", width: "10%", align: "right", render: (r) => r.count },
    { key: "pre", header: "Pre-tax", width: "24%", align: "right", render: (r) => <Stack row={r} pick={(m) => m.pretax} /> },
    { key: "tax", header: "Tax", width: "24%", align: "right", render: (r) => <span className="font-semibold"><Stack row={r} pick={(m) => m.tax} /></span> },
    { key: "total", header: "Total", width: "26%", align: "right", render: (r) => <Stack row={r} pick={(m) => m.total} /> },
  ];
  const taxTotals = totalsByCurrency(rows, "tax");
  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <div className="grid gap-[var(--space-sm)] sm:grid-cols-3">
        <Summary label="Pre-tax" value={formatTotals(totalsByCurrency(rows, "pretax"))} />
        <Summary label="Tax" value={formatTotals(taxTotals)} strong />
        <Summary label="Total" value={formatTotals(totalsByCurrency(rows, "total"))} />
      </div>
      <p className="text-caption text-content-secondary">
        Tax is taken from the invoices Scantrix has read. It does not include tax on anything that was never uploaded, so
        treat it as a working figure, not a tax filing.
      </p>
      <div className="min-w-[560px]">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.key} maxHeightClassName="max-h-[480px]" />
      </div>
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={CARD}>
      <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">{label}</p>
      <p className={`mt-[var(--space-xs)] break-words text-body-sm ${strong ? "font-bold" : "font-semibold"} text-content-primary`}>
        {value}
      </p>
    </div>
  );
}
