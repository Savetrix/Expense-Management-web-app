"use client";

import { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import type { SectionStatus } from "./mockData";
import { SectionStatusBadge } from "./closeShared";

interface CloseSectionCardProps {
  index: number;
  title: string;
  summary: string;
  status: SectionStatus;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

// One row of the close checklist — collapsed it shows the step number,
// title, one-line summary and status; expanded it renders the section's flow.
export function CloseSectionCard({ index, title, summary, status, open, onToggle, children }: CloseSectionCardProps) {
  const panelId = `close-section-${index}`;
  return (
    <section className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-md)] text-left transition-colors hover:bg-surface-alt"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-sm font-bold ${
            status === "done" ? "bg-accent-bg text-accent-text-on-bg" : "bg-surface-alt text-content-secondary"
          }`}
        >
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-content-primary">{title}</span>
          <span className="block truncate text-caption text-content-secondary">{summary}</span>
        </span>
        <SectionStatusBadge status={status} />
        <ChevronDown
          size={18}
          strokeWidth={2.25}
          className={`shrink-0 text-content-secondary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="border-t border-border bg-page p-[var(--space-md)]">
          {children}
        </div>
      )}
    </section>
  );
}
