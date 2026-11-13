"use client";

import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { taxCodeLabel } from "@/lib/quickbooks/taxCode";

import { codingFor, picksFor, type Lookups } from "./coding";
import { formatAmount } from "./format";
import { LINE_COLUMN_WIDTH } from "./SuggestedMatches";
import type { BankTransaction } from "./types";

interface SureLinesProps {
  lines: BankTransaction[];
  lookups: Lookups;
  providerName: string;
  /** True when Post also sends the line to QuickBooks/Xero. */
  sends: boolean;
  /** The GL name, from the backend's list or the company's chart. */
  glName: (id: string | undefined) => string | undefined;
  onPost: (t: BankTransaction) => void;
  onPostAll: () => void;
  onOpen: (id: string) => void;
}

/** What Scantrix would code this line to, filled in or not ("Suggest only"). */
function shown(t: BankTransaction) {
  const c = codingFor(t);
  return c.source === "autopilot" ? c : { ...c, ...(c.offered ?? {}) };
}

/**
 * Section above the lines to review: the lines Scantrix is sure about — a
 * company rule, or 3 matching earlier lines for the payee. Each row shows the
 * vendor, GL account, tax code and why, so a person can check it and post it
 * with one click. Nothing here is posted until someone clicks.
 */
export function SureLines({ lines, lookups, providerName, sends, glName, onPost, onPostAll, onOpen }: SureLinesProps) {
  if (lines.length === 0) return null;
  const n = lines.length;

  const columns: DataTableColumn<BankTransaction>[] = [
    { key: "select", header: "", width: LINE_COLUMN_WIDTH.select, render: () => <CheckCircle2 size={14} strokeWidth={2.25} className="text-status-success-text" aria-hidden /> },
    { key: "date", header: "Date", width: LINE_COLUMN_WIDTH.date, render: (t) => <span className="whitespace-nowrap">{t.date}</span> },
    {
      key: "description",
      header: "Description",
      width: LINE_COLUMN_WIDTH.description,
      render: (t) => (
        <button type="button" onClick={() => onOpen(t.id)} className="block w-full min-w-0 text-left" title="Open details">
          <span className="block truncate font-semibold text-content-primary hover:underline">{t.description || "—"}</span>
          <span className="block truncate text-content-secondary">{t.accountName || "—"}</span>
        </button>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: LINE_COLUMN_WIDTH.amount,
      align: "right",
      render: (t) => <span className={`font-semibold ${t.amount < 0 ? "text-status-danger-text" : "text-status-success-text"}`}>{formatAmount(t.amount)}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      width: LINE_COLUMN_WIDTH.vendor,
      render: (t) => {
        const c = shown(t);
        return <span className="block truncate">{(c.vendorId && lookups.vendorById.get(c.vendorId)?.displayName) || c.payee || "—"}</span>;
      },
    },
    {
      key: "gl",
      header: "GL account",
      width: LINE_COLUMN_WIDTH.gl,
      render: (t) => {
        const c = shown(t);
        const pick = picksFor(t, lookups, glName).find((p) => p.pick.glAccountId === c.glAccountId);
        const why = pick?.reason ?? c.suggestion?.reason.replace(/^Coded by Scantrix — /, "") ?? "";
        return (
          <>
            <span className="block truncate font-semibold">{glName(c.glAccountId) || "—"}</span>
            <span className="block truncate text-content-secondary" title={why}>
              {why}
            </span>
          </>
        );
      },
    },
    {
      key: "tax",
      header: "Tax",
      width: LINE_COLUMN_WIDTH.tax,
      render: (t) => {
        const c = shown(t);
        const tax = c.taxCodeId ? lookups.taxById.get(c.taxCodeId) : undefined;
        return <span className="block truncate">{tax ? taxCodeLabel(tax) : "—"}</span>;
      },
    },
    { key: "paperwork", header: "", width: LINE_COLUMN_WIDTH.paperwork, render: () => null },
    {
      key: "actions",
      header: "",
      width: LINE_COLUMN_WIDTH.actions,
      align: "right",
      render: (t) => (
        <span className="inline-flex items-center gap-[var(--space-xs)]">
          <Button size="sm" onClick={() => onPost(t)} title={sends ? `Post to ${providerName} now` : "Save as ready to post"}>
            Post
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpen(t.id)}>
            Change
          </Button>
        </span>
      ),
    },
  ];

  return (
    <section className="border-b border-border bg-status-success-bg/40" aria-label="Scantrix is sure">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
        <div>
          <h3 className="flex items-center gap-[var(--space-xs)] text-body-sm font-bold text-content-primary">
            <CheckCircle2 size={16} strokeWidth={2.25} className="text-status-success-text" />
            Scantrix is sure ({n})
          </h3>
          <p className="text-caption text-content-secondary">
            A company rule, or 3 matching earlier lines for the same payee. Check the vendor, GL account and tax, then post.
            {sends ? ` Post sends the line to ${providerName}.` : ""}
          </p>
        </div>
        <Button size="sm" onClick={onPostAll}>
          {`Post all ${n}`}
        </Button>
      </div>
      <DataTable columns={columns} rows={lines} getRowKey={(t) => t.id} bordered={false} maxHeightClassName="max-h-80" />
    </section>
  );
}
