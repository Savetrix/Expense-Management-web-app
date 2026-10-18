"use client";

import { Bot, FileSearch, History, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { Modal } from "@/components/v2/ui";
import { formatPlainDate } from "@/lib/plainDate";
import { BE_SUFFIX } from "@/lib/bePlaceholder";

// "Decision trail" built only from the invoice's real fields. The backend
// doesn't return a reasoning trace yet (BE).

export interface CodingReasoningModalProps {
  open: boolean;
  onClose: () => void;
  vendorName: string;
  glCode: string;
  /** "Autopilot" when auto-posted, otherwise the person who posted it. */
  publishedBy: string;
  isAutopilot: boolean;
  totalAmountDisplay?: string;
  invoiceDate?: string;
}

function TrailStep({ icon, title, children, last }: { icon: ReactNode; title: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-[var(--space-sm)]">
      {!last && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-alt text-content-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pb-[var(--space-md)]">
        <p className="text-body-sm font-semibold text-content-primary">{title}</p>
        <div className="mt-[var(--space-xs)] text-caption text-content-secondary">{children}</div>
      </div>
    </li>
  );
}

export function CodingReasoningModal({
  open,
  onClose,
  vendorName,
  glCode,
  publishedBy,
  isAutopilot,
  totalAmountDisplay,
  invoiceDate,
}: CodingReasoningModalProps) {
  const vendor = vendorName && vendorName !== "—" ? vendorName : "this vendor";
  const gl = glCode && glCode !== "—" ? glCode : "the suggested GL account";

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-lg"
      ariaLabel="Why Scantrix coded it this way"
      title={
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
            <Sparkles size={18} strokeWidth={2} className="text-content-secondary" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Decision trail</span>
            <span className="truncate text-h3 font-bold text-content-primary">Why Scantrix coded it this way</span>
          </span>
        </span>
      }
    >
      <ol className="flex flex-col">
        <TrailStep icon={<FileSearch size={15} strokeWidth={2} />} title="Read the document">
          A bill from <span className="font-semibold text-content-primary">{vendor}</span>
          {invoiceDate && invoiceDate !== "—"
            ? ` dated ${formatPlainDate(invoiceDate, { month: "short", day: "numeric", year: "numeric" })}`
            : ""}
          {totalAmountDisplay && totalAmountDisplay !== "—" ? ` for ${totalAmountDisplay}` : ""}.
        </TrailStep>

        <TrailStep icon={<History size={15} strokeWidth={2} />} title="Coded to">
          <span className="font-semibold text-content-primary">{gl}</span>
        </TrailStep>

        <TrailStep icon={isAutopilot ? <Bot size={15} strokeWidth={2} /> : <UserRound size={15} strokeWidth={2} />} title="Published" last>
          Published by: <span className="font-semibold text-content-primary">{isAutopilot ? "Autopilot" : publishedBy || "—"}</span>
        </TrailStep>
      </ol>
      <p className="mt-[var(--space-xs)] text-caption text-content-muted">
        Detailed reasoning and past-bill comparison come from the backend {BE_SUFFIX}.
      </p>
    </Modal>
  );
}
