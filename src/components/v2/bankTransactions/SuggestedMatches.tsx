"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";

import type { StrongSuggestion } from "./matching";

interface SuggestedMatchesProps {
  suggestions: StrongSuggestion[];
  onAccept: (s: StrongSuggestion) => void;
  onDismiss: (txnId: string) => void;
  onAcceptAll: () => void;
}

/** Strip above the "To review" list: bank lines whose best bill matches on amount and date. */
export function SuggestedMatches({ suggestions, onAccept, onDismiss, onAcceptAll }: SuggestedMatchesProps) {
  if (suggestions.length === 0) return null;
  return (
    <section className="border-b border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]" aria-label="Suggested matches">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
        <h3 className="flex items-center gap-[var(--space-xs)] text-body-sm font-bold text-content-primary">
          <Sparkles size={16} strokeWidth={2.25} />
          Suggested matches ({suggestions.length})
        </h3>
        <Button size="sm" onClick={onAcceptAll}>
          {`Accept all ${suggestions.length} strong match${suggestions.length === 1 ? "" : "es"}`}
        </Button>
      </div>
      <ul className="mt-[var(--space-xs)] max-h-48 overflow-y-auto">
        {suggestions.map((s) => (
          <li key={s.txn.id} className="flex flex-wrap items-center gap-[var(--space-sm)] py-[var(--space-xs)]">
            <span className="min-w-0 flex-1 truncate text-body-sm text-content-primary">
              <span className="font-semibold">{s.txn.description || "—"}</span>
              {" → "}
              {s.invoice.vendor}
              {s.invoice.number && ` #${s.invoice.number}`}
            </span>
            <Button size="sm" onClick={() => onAccept(s)}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDismiss(s.txn.id)}>
              Not this
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
