"use client";

import { Download, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { WorkingPaper } from "./types";
import { date, dateTime } from "./closeShared";

interface WorkingPaperModalProps {
  paper: WorkingPaper | null;
  /** True while another close is open — reopening is then blocked. */
  hasOpenClose: boolean;
  canManage: boolean;
  onClose: () => void;
  onExport: (paper: WorkingPaper) => void;
  onReopen: (paper: WorkingPaper) => void;
}

// Read-only snapshot of a closed working paper, taken at the moment of close.
export function WorkingPaperModal({ paper, hasOpenClose, canManage, onClose, onExport, onReopen }: WorkingPaperModalProps) {
  const provider = useActiveProvider();
  const reopenBlockedReason = hasOpenClose
    ? "Finish or remove the open close before reopening an earlier period."
    : !canManage
      ? "Only users with the Manage periods permission can reopen a period."
      : undefined;

  return (
    <Modal
      open={!!paper}
      onClose={onClose}
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
            The account-by-account snapshot and attachments for this period load from {provider.name} and the backend once it is connected {beLabel("").trim()}.
          </p>
        </div>
      )}
    </Modal>
  );
}
