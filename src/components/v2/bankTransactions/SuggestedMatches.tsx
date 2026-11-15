"use client";

import { AlertTriangle, Paperclip, Sparkles } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { taxCodeLabel } from "@/lib/quickbooks/taxCode";

import type { Lookups } from "./coding";
import { formatAmount } from "./format";
import type { StrongSuggestion } from "./matching";

/**
 * Column widths shared with the lines table below (TransactionsTab), so a
 * suggested match lines up with the same Date / Description / Amount / Vendor /
 * GL account / Tax columns. "select" is the lines table's checkbox column.
 */
export const LINE_COLUMN_WIDTH = {
  select: "2.5rem",
  date: "96px",
  description: "22%",
  amount: "104px",
  vendor: "15%",
  gl: "17%",
  tax: "12%",
  paperwork: "56px",
  actions: "236px",
} as const;

interface SuggestedMatchesProps {
  suggestions: StrongSuggestion[];
  lookups: Lookups;
  providerName: string;
  /** True when Accept also sends the payment to QuickBooks/Xero. */
  sends: boolean;
  onAccept: (s: StrongSuggestion) => void;
  onDismiss: (txnId: string) => void;
  onAcceptAll: () => void;
}

/**
 * Box above the "To review" list: bank lines whose best bill matches on amount,
 * date and vendor. Each one shows the same details as a line below — the bill's
 * vendor, GL account and tax code — so the person sees where the money goes.
 */
export function SuggestedMatches({ suggestions, lookups, providerName, sends, onAccept, onDismiss, onAcceptAll }: SuggestedMatchesProps) {
  if (suggestions.length === 0) return null;
  const n = suggestions.length;

  const columns: DataTableColumn<StrongSuggestion>[] = [
    { key: "select", header: "", width: LINE_COLUMN_WIDTH.select, render: () => <Sparkles size={14} strokeWidth={2.25} className="text-accent" aria-hidden /> },
    { key: "date", header: "Date", width: LINE_COLUMN_WIDTH.date, render: (s) => <span className="whitespace-nowrap">{s.txn.date}</span> },
    {
      key: "description",
      header: "Description",
      width: LINE_COLUMN_WIDTH.description,
      render: (s) => (
        <>
          <span className="block truncate font-semibold text-content-primary">{s.txn.description || "—"}</span>
          <span className="block truncate text-content-secondary">{s.txn.accountName || "—"}</span>
        </>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: LINE_COLUMN_WIDTH.amount,
      align: "right",
      render: (s) => <span className="font-semibold text-status-danger-text">{formatAmount(s.txn.amount)}</span>,
    },
    { key: "vendor", header: "Vendor", width: LINE_COLUMN_WIDTH.vendor, render: (s) => <span className="block truncate">{s.invoice.vendor}</span> },
    {
      key: "gl",
      header: "GL account",
      width: LINE_COLUMN_WIDTH.gl,
      render: (s) => {
        const gl = s.invoice.glAccountId ? lookups.glById.get(s.invoice.glAccountId)?.name : undefined;
        const bill = `Pays bill${s.invoice.number ? ` #${s.invoice.number}` : ""} · ${s.invoice.date}`;
        return (
          <>
            <span className="block truncate">{gl || "—"}</span>
            {s.invoice.billId ? (
              <span className="block truncate text-content-secondary" title={bill}>
                {bill}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 truncate font-semibold text-status-warning-text" title={`Post the bill to ${providerName} first; until then this payment can't be sent.`}>
                <AlertTriangle size={12} strokeWidth={2.25} className="shrink-0" />
                Bill not in {providerName} yet
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "tax",
      header: "Tax",
      width: LINE_COLUMN_WIDTH.tax,
      render: (s) => {
        const tax = s.invoice.taxCodeId ? lookups.taxById.get(s.invoice.taxCodeId) : undefined;
        return <span className="block truncate">{tax ? taxCodeLabel(tax) : "—"}</span>;
      },
    },
    {
      key: "paperwork",
      header: <Paperclip size={13} strokeWidth={2.25} aria-label="Invoice or receipt" />,
      width: LINE_COLUMN_WIDTH.paperwork,
      render: (s) => (
        <Link href={`/invoices/${s.invoice.id}`} title={`${s.invoice.vendor}${s.invoice.number ? ` #${s.invoice.number}` : ""} in Scantrix`} className="inline-flex text-accent hover:opacity-80">
          <Paperclip size={16} strokeWidth={2.25} />
        </Link>
      ),
    },
    {
      key: "actions",
      header: "",
      width: LINE_COLUMN_WIDTH.actions,
      align: "right",
      render: (s) => {
        const sendsThis = sends && Boolean(s.invoice.billId);
        return (
          <span className="inline-flex items-center gap-[var(--space-xs)]">
            <Button size="sm" onClick={() => onAccept(s)} title={sendsThis ? `Match and send the payment to ${providerName}` : "Match only; send it later from Matched"}>
              {sendsThis ? "Accept & send" : "Accept"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDismiss(s.txn.id)}>
              Not this
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <section className="border-b border-border bg-surface-alt" aria-label="Suggested matches">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
        <div>
          <h3 className="flex items-center gap-[var(--space-xs)] text-body-sm font-bold text-content-primary">
            <Sparkles size={16} strokeWidth={2.25} />
            Suggested matches ({n})
          </h3>
          <p className="text-caption text-content-secondary">
            Same amount, within 7 days, same vendor.{" "}
            {sends ? `Accepting pays the bill in ${providerName} straight away.` : `Accepting matches the line; send it to ${providerName} from Matched.`}
          </p>
        </div>
        <Button size="sm" onClick={onAcceptAll}>
          {sends ? `Accept & send all ${n}` : `Accept all ${n} strong match${n === 1 ? "" : "es"}`}
        </Button>
      </div>
      <DataTable columns={columns} rows={suggestions} getRowKey={(s) => s.txn.id} bordered={false} maxHeightClassName="max-h-72" />
    </section>
  );
}
