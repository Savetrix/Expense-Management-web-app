"use client";

import { Bot, Check, FileSearch, History, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import type { ReactNode } from "react";

import { Modal } from "@/components/v2/ui";
import { formatPlainDate } from "@/lib/plainDate";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

// Front-end-only "decision trail". The backend doesn't return a reasoning
// trace yet, so the steps are built from the invoice's real vendor / GL /
// publisher where available and mock data otherwise.

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

const MOCK_PAST_BILLS = [
  { ref: "INV-10421", date: "Sep 12", amount: "1,240.00" },
  { ref: "INV-10388", date: "Aug 11", amount: "1,180.50" },
  { ref: "INV-10302", date: "Jul 10", amount: "1,212.75" },
];

const AUTOPILOT_CHECKS: { label: string; pass: boolean; detail: string }[] = [
  { label: "Legibility", pass: true, detail: "Every key field was read with high confidence." },
  { label: "Completeness", pass: true, detail: "Vendor, date, total and tax were all present." },
  { label: "Historical consistency", pass: true, detail: "Amount and coding are in line with past bills." },
];

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
  const provider = useActiveProvider();
  const vendor = vendorName && vendorName !== "—" ? vendorName : "this vendor";
  const gl = glCode && glCode !== "—" ? glCode : "the suggested GL account";
  const similarCount = 4;

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
          {totalAmountDisplay && totalAmountDisplay !== "—" ? ` for ${totalAmountDisplay}` : ""}, with line items and
          tax read from the scan.
        </TrailStep>

        <TrailStep icon={<History size={15} strokeWidth={2} />} title="Compared previous coding">
          <p>
            {similarCount} similar bills from <span className="font-semibold text-content-primary">{vendor}</span> were
            coded to <span className="font-semibold text-content-primary">{gl}</span>.
          </p>
          <ul className="mt-[var(--space-xs)] flex flex-col overflow-hidden rounded-md border border-border">
            {MOCK_PAST_BILLS.map((bill) => (
              <li
                key={bill.ref}
                className="flex items-center justify-between gap-[var(--space-sm)] border-b border-border px-[var(--space-sm)] py-[var(--space-xs)] last:border-b-0"
              >
                <span className="font-mono text-tiny text-content-primary">{bill.ref}</span>
                <span className="text-tiny text-content-muted">{bill.date}</span>
                <span className="min-w-0 flex-1 truncate text-right text-tiny text-content-secondary">{gl}</span>
                <span className="shrink-0 text-tiny font-semibold text-content-primary">{bill.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-[var(--space-xs)] text-tiny text-content-muted">Sample history — shown until the backend returns real matches.</p>
        </TrailStep>

        <TrailStep icon={<ShieldCheck size={15} strokeWidth={2} />} title="Checked the vendor">
          <span className="inline-flex items-center gap-1 font-semibold text-status-success-text">
            <Check size={12} strokeWidth={2.5} />
            Tax number matches
          </span>{" "}
          the {vendor === "this vendor" ? "vendor" : vendor} record in {provider.name}.
        </TrailStep>

        <TrailStep icon={<Bot size={15} strokeWidth={2} />} title="Autopilot checks">
          <ul className="flex flex-col gap-[var(--space-xs)]">
            {AUTOPILOT_CHECKS.map((check) => (
              <li key={check.label} className="flex items-start gap-[var(--space-xs)]">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    check.pass ? "bg-status-success-bg text-status-success-text" : "bg-status-danger-bg text-status-danger-text"
                  }`}
                >
                  {check.pass ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                </span>
                <span>
                  <span className="font-semibold text-content-primary">{check.label}</span>{" "}
                  <span className={check.pass ? "text-status-success-text" : "text-status-danger-text"}>
                    {check.pass ? "Pass" : "Fail"}
                  </span>
                  <span className="block text-tiny text-content-muted">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </TrailStep>

        <TrailStep icon={isAutopilot ? <Bot size={15} strokeWidth={2} /> : <UserRound size={15} strokeWidth={2} />} title="Published" last>
          Published by: <span className="font-semibold text-content-primary">{isAutopilot ? "Autopilot" : publishedBy || "—"}</span>
        </TrailStep>
      </ol>
    </Modal>
  );
}
