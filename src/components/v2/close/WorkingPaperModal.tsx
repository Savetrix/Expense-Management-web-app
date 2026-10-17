"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Download, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { BalanceSheetAccount, WorkingPaper } from "./mockData";
import { accountSupportBalance } from "./BalanceSheetSection";
import { TABLE_HEADER_CLASS, date, dateTime, money, round2 } from "./closeShared";

interface WorkingPaperModalProps {
  paper: WorkingPaper | null;
  /** True while another close is open — reopening is then blocked. */
  hasOpenClose: boolean;
  canManage: boolean;
  onClose: () => void;
  onExport: (paper: WorkingPaper) => void;
  onReopen: (paper: WorkingPaper) => void;
}

const reconciledBy = (a: BalanceSheetAccount) => {
  if (a.managedBy) return "Schedule";
  if (a.dormant) return "Auto (dormant)";
  return a.reconciled ? `${a.reconciled.by}, ${date(a.reconciled.at)}` : "—";
};

// Read-only snapshot of a closed working paper, taken at the moment of close.
export function WorkingPaperModal({ paper, hasOpenClose, canManage, onClose, onExport, onReopen }: WorkingPaperModalProps) {
  const provider = useActiveProvider();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reopenBlockedReason = hasOpenClose
    ? "Finish or remove the open close before reopening an earlier period."
    : !canManage
      ? "Only users with the Manage periods permission can reopen a period."
      : undefined;

  return (
    <Modal
      open={!!paper}
      onClose={() => {
        setExpanded(new Set());
        onClose();
      }}
      title="View working paper"
      widthClassName="max-w-4xl"
      footer={
        paper && (
          <div className="flex w-full flex-col-reverse gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-end">
            {reopenBlockedReason && <p className="text-caption text-content-secondary sm:mr-auto">{reopenBlockedReason}</p>}
            <span title={reopenBlockedReason}>
              <Button variant="outline" size="sm" className="w-full sm:w-auto" disabled={!!reopenBlockedReason} onClick={() => onReopen(paper)}>
                <RotateCcw size={16} strokeWidth={2.25} />
                {beLabel("Reopen period")}
              </Button>
            </span>
            <Button size="sm" onClick={() => onExport(paper)}>
              <Download size={16} strokeWidth={2.25} />
              {beLabel("Export to Excel")}
            </Button>
          </div>
        )
      }
    >
      {paper && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div>
            <ModalDefinitionRow label="Period">{paper.name}</ModalDefinitionRow>
            <ModalDefinitionRow label="Dates">
              {date(paper.periodStart)} – {date(paper.periodEnd)}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Closed by">{paper.closedBy ?? "—"}</ModalDefinitionRow>
            <ModalDefinitionRow label="Closed on">{dateTime(paper.closedAt)}</ModalDefinitionRow>
          </div>

          <p className="text-caption text-content-secondary">
            The export is a ZIP with the working paper workbook and every attachment added during the close.
          </p>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="border-b border-border bg-page">
                <tr>
                  <th className={`${TABLE_HEADER_CLASS} w-10`} />
                  <th className={TABLE_HEADER_CLASS}>Account</th>
                  <th className={`${TABLE_HEADER_CLASS} text-right`}>Per {provider.name}</th>
                  <th className={`${TABLE_HEADER_CLASS} text-right`}>Per support</th>
                  <th className={`${TABLE_HEADER_CLASS} text-right`}>Difference</th>
                  <th className={TABLE_HEADER_CLASS}>Reconciled by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paper.accounts.map((a) => {
                  const open = expanded.has(a.id);
                  const diff = round2(a.ledgerBalance - accountSupportBalance(a));
                  return (
                    <Fragment key={a.id}>
                      <tr className="hover:bg-surface-alt">
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)]">
                          <button
                            type="button"
                            onClick={() => toggle(a.id)}
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} change log for ${a.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt"
                          >
                            <ChevronDown size={16} strokeWidth={2.25} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">
                          <span className="font-mono font-semibold">{a.code}</span> · {a.name}
                        </td>
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(a.ledgerBalance)}</td>
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(accountSupportBalance(a))}</td>
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(diff)}</td>
                        <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">
                          {reconciledBy(a)}
                          {a.reconciled?.justification && <Badge variant="warning" className="ml-[var(--space-xs)]">Justified</Badge>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-page">
                          <td />
                          <td colSpan={5} className="px-[var(--space-sm)] py-[var(--space-sm)]">
                            {a.changeLog.length === 0 ? (
                              <p className="text-caption text-content-secondary">No changes recorded for this account.</p>
                            ) : (
                              <ol className="flex flex-col gap-[var(--space-xs)]">
                                {a.changeLog.map((entry) => (
                                  <li key={entry.id} className="text-caption text-content-primary">
                                    <span className="text-content-secondary">{dateTime(entry.at)} · {entry.by} — </span>
                                    {entry.message}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
