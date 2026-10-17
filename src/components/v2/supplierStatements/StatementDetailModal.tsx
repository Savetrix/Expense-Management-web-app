"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Mail, Send } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { DataTable, Modal, ProgressBar, RoleInfoBanner } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";

import { MatchBillModal } from "./MatchBillModal";
import {
  FIELD_NAMES,
  RESULT_META,
  ROW_ACTION_CLASS,
  ROW_ACTION_NEUTRAL_CLASS,
  STATUS_META,
  billValueFor,
  formatDate,
  formatPeriod,
  money,
  summarize,
} from "./format";
import type { CandidateBill, StatementLine, SupplierStatement } from "./mockData";

interface StatementDetailModalProps {
  statement: SupplierStatement | null;
  bills: CandidateBill[];
  onClose: () => void;
  onChange: (id: string, update: (statement: SupplierStatement) => SupplierStatement) => void;
}

function SummaryTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "warning" | "error" }) {
  const dot = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : tone === "error" ? "bg-error" : "";
  return (
    <div className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
      <p className="flex items-center gap-[var(--space-xs)] text-tiny font-bold uppercase tracking-wider text-content-muted">
        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-[2px] truncate text-body font-bold text-content-primary">{value}</p>
    </div>
  );
}

export function StatementDetailModal({ statement, bills, onClose, onChange }: StatementDetailModalProps) {
  const router = useRouter();
  const [matchingLine, setMatchingLine] = useState<StatementLine | null>(null);

  const summary = useMemo(() => (statement ? summarize(statement, bills) : null), [statement, bills]);
  const usedBillIds = useMemo(
    () => new Set((statement?.lines ?? []).filter((l) => l.result === "matched" && l.billId).map((l) => l.billId as string)),
    [statement],
  );

  if (!statement || !summary) return null;

  const readOnly = statement.status !== "needs_matching";
  const billFor = (line: StatementLine) => (line.billId ? bills.find((b) => b.id === line.billId) : undefined);

  const updateLine = (lineId: string, patch: Partial<StatementLine>) =>
    onChange(statement.id, (s) => ({ ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }));

  const acceptMatch = (line: StatementLine) => {
    notifyBackendPending("Accept match");
    updateLine(line.id, { result: "matched", matchedBy: "accepted", differingField: undefined });
  };

  const rejectMatch = (line: StatementLine) => {
    notifyBackendPending("Reject");
    updateLine(line.id, { result: "unmatched", billId: undefined, differingField: undefined, matchedBy: undefined });
  };

  const markMissing = (line: StatementLine) => {
    updateLine(line.id, { result: "missing", billId: undefined, differingField: undefined, matchedBy: undefined });
    showToast(`${line.reference} marked as a missing invoice. You can request it from ${statement.vendor}.`, "info");
  };

  const requestInvoice = (line: StatementLine) => {
    const params = new URLSearchParams({
      new: "1",
      vendor: statement.vendor,
      item: line.reference,
      amount: String(line.amount),
      date: line.date,
    });
    onClose();
    router.push(`/requests?${params.toString()}`);
  };

  const reconcile = async () => {
    const ok = await confirmDialog({
      title: "Mark statement reconciled?",
      message:
        summary.difference === 0
          ? `Every line on the ${statement.vendor} statement is accounted for.`
          : `A difference of ${money(summary.difference, statement.currency)} remains from missing invoices. You can still reconcile and chase them separately.`,
      confirmLabel: beLabel("Mark reconciled"),
    });
    if (!ok) return;
    notifyBackendPending("Mark statement reconciled");
    onChange(statement.id, (s) => ({ ...s, status: "reconciled" }));
    showToast(`${statement.vendor} statement reconciled.`, "success");
  };

  const columns: DataTableColumn<StatementLine>[] = [
    { key: "date", header: "Date", width: "13%", render: (l) => <span className="block truncate">{formatDate(l.date)}</span> },
    { key: "ref", header: "Reference", width: "14%", render: (l) => <span className="block truncate font-bold">{l.reference}</span> },
    {
      key: "amount",
      header: "Amount",
      width: "14%",
      align: "right",
      render: (l) => <span className="block truncate font-semibold">{money(l.amount, statement.currency)}</span>,
    },
    {
      key: "bill",
      header: "Matched bill",
      width: "17%",
      render: (l) => {
        const bill = billFor(l);
        if (!bill) return <span className="text-content-muted">—</span>;
        return (
          <span className="block min-w-0">
            <span className="block truncate font-semibold">{bill.number}</span>
            <span className="block truncate text-content-secondary">{money(bill.amount, statement.currency)}</span>
          </span>
        );
      },
    },
    {
      key: "result",
      header: "Match result",
      width: "18%",
      render: (l) => {
        const meta = RESULT_META[l.result];
        const bill = billFor(l);
        return (
          <span className="flex min-w-0 flex-col items-start gap-[2px]">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            {l.result === "partial" && l.differingField && bill && (
              <span className="block max-w-full truncate text-tiny text-content-secondary" title={`Bill shows ${billValueFor(bill, l.differingField)}`}>
                {FIELD_NAMES[l.differingField]} differs · bill: {billValueFor(bill, l.differingField)}
              </span>
            )}
            {l.result === "matched" && l.matchedBy && (
              <span className="text-tiny text-content-secondary">
                {l.matchedBy === "auto" ? "All 4 details agree" : l.matchedBy === "accepted" ? "Accepted by you" : "Matched by you"}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      width: "24%",
      align: "right",
      render: (l) => {
        if (readOnly) return null;
        if (l.result === "partial") {
          return (
            <span className="flex flex-wrap justify-end gap-[var(--space-xs)]">
              <button type="button" className={ROW_ACTION_CLASS} onClick={() => acceptMatch(l)}>
                {beLabel("Accept match")}
              </button>
              <button type="button" className={ROW_ACTION_NEUTRAL_CLASS} onClick={() => rejectMatch(l)}>
                {beLabel("Reject")}
              </button>
            </span>
          );
        }
        if (l.result === "unmatched") {
          return (
            <span className="flex flex-wrap justify-end gap-[var(--space-xs)]">
              <button type="button" className={ROW_ACTION_CLASS} onClick={() => setMatchingLine(l)}>
                Match manually
              </button>
              <button type="button" className={ROW_ACTION_NEUTRAL_CLASS} onClick={() => markMissing(l)}>
                Mark as missing invoice
              </button>
            </span>
          );
        }
        if (l.result === "missing") {
          return (
            <span className="flex flex-wrap justify-end gap-[var(--space-xs)]">
              <button type="button" className={ROW_ACTION_CLASS} onClick={() => requestInvoice(l)}>
                <Send size={12} strokeWidth={2.25} />
                Request invoice from vendor
              </button>
              <button
                type="button"
                className={ROW_ACTION_NEUTRAL_CLASS}
                onClick={() => updateLine(l.id, { result: "unmatched" })}
              >
                Undo
              </button>
            </span>
          );
        }
        return null;
      },
    },
  ];

  const statusMeta = STATUS_META[statement.status];
  const progress = summary.total ? Math.round((summary.resolved / summary.total) * 100) : 0;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`${statement.vendor} statement`}
        widthClassName="max-w-4xl"
        footer={
          statement.status === "needs_matching" ? (
            <div className="flex w-full flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 sm:max-w-xs">
                <p className="text-caption font-semibold text-content-secondary">
                  {summary.resolved} of {summary.total} lines resolved
                </p>
                <div className="mt-[var(--space-xs)]">
                  <ProgressBar percent={progress} colorClassName="bg-accent" label="Lines resolved" />
                </div>
              </div>
              <div className="flex gap-[var(--space-sm)]">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button size="sm" onClick={reconcile} disabled={!summary.allResolved} title={summary.allResolved ? undefined : "Resolve every line first"}>
                  <CheckCircle2 size={16} strokeWidth={2.25} />
                  {beLabel("Mark statement reconciled")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="flex flex-wrap items-center gap-x-[var(--space-md)] gap-y-[var(--space-xs)] text-caption text-content-secondary">
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            <span className="flex min-w-0 items-center gap-[var(--space-xs)]">
              <FileText size={14} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{statement.fileName}</span>
            </span>
            <span>Period {formatPeriod(statement.periodStart, statement.periodEnd)}</span>
            <span className="flex items-center gap-[var(--space-xs)]">
              {statement.source === "Email" && <Mail size={14} strokeWidth={2} />}
              {statement.source === "Email" ? "Received by email" : "Uploaded"} · {formatDate(statement.statementDate)}
            </span>
          </div>

          {statement.status === "processing" ? (
            <div className="flex flex-col items-center gap-[var(--space-sm)] py-[var(--space-xl)] text-center">
              <Spinner size="md" />
              <p className="text-body-sm font-semibold text-content-primary">Reading statement lines…</p>
              <p className="max-w-sm text-caption text-content-secondary">
                Each line is compared with your bills by vendor, date, amount and reference. This usually takes under a minute.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[var(--space-sm)] sm:grid-cols-3">
                <SummaryTile label="Fully matched" value={summary.counts.matched} tone="success" />
                <SummaryTile label="Partly matched" value={summary.counts.partial} tone="warning" />
                <SummaryTile label="Unmatched" value={summary.counts.unmatched + summary.counts.missing} tone="error" />
                <SummaryTile label="Statement balance" value={money(statement.balance, statement.currency)} />
                <SummaryTile label="Bills in Scantrix" value={money(summary.billsTotal, statement.currency)} />
                <SummaryTile
                  label="Difference"
                  value={
                    <span className={summary.difference === 0 ? "text-success" : "text-error"}>
                      {money(summary.difference, statement.currency)}
                    </span>
                  }
                />
              </div>

              {statement.status === "reconciled" ? (
                <RoleInfoBanner>This statement is reconciled. Lines are locked; upload a newer statement to continue.</RoleInfoBanner>
              ) : (
                <RoleInfoBanner>
                  A line matches automatically when vendor, date, amount and reference all agree. Bills you upload later are matched
                  to open statements on their own.
                </RoleInfoBanner>
              )}

              <div className="overflow-x-auto rounded-lg border border-border">
                <div className="min-w-[760px]">
                  <DataTable columns={columns} rows={statement.lines} getRowKey={(l) => l.id} bordered={false} maxHeightClassName="max-h-[420px]" />
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      <MatchBillModal
        line={matchingLine}
        vendor={statement.vendor}
        currency={statement.currency}
        bills={bills}
        usedBillIds={usedBillIds}
        onClose={() => setMatchingLine(null)}
        onMatch={(billId) => {
          if (!matchingLine) return;
          notifyBackendPending("Match");
          updateLine(matchingLine.id, { result: "matched", billId, matchedBy: "manual", differingField: undefined });
          setMatchingLine(null);
        }}
      />
    </>
  );
}
