"use client";

import { FileSearch } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, SearchInput } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";

import { formatDate, money } from "./format";
import type { CandidateBill, StatementLine } from "./mockData";

interface MatchBillModalProps {
  /** The statement line being matched; null keeps the modal closed. */
  line: StatementLine | null;
  vendor: string;
  currency: string;
  bills: CandidateBill[];
  /** Bills already linked to another line of this statement. */
  usedBillIds: Set<string>;
  onClose: () => void;
  onMatch: (billId: string) => void;
}

export function MatchBillModal({ line, vendor, currency, bills, usedBillIds, onClose, onMatch }: MatchBillModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");

  const candidates = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return bills
      .filter((b) => !usedBillIds.has(b.id))
      .filter((b) => !lower || b.number.toLowerCase().includes(lower) || b.vendor.toLowerCase().includes(lower) || String(b.amount).includes(lower))
      // Same vendor first, then closest amount — the likeliest match on top.
      .sort((a, b) => {
        const vendorRank = Number(b.vendor === vendor) - Number(a.vendor === vendor);
        if (vendorRank !== 0) return vendorRank;
        const target = line?.amount ?? 0;
        return Math.abs(a.amount - target) - Math.abs(b.amount - target);
      });
  }, [bills, usedBillIds, query, vendor, line]);

  const close = () => {
    setQuery("");
    setSelected("");
    onClose();
  };

  return (
    <Modal
      open={Boolean(line)}
      onClose={close}
      title="Match manually"
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => {
              onMatch(selected);
              setQuery("");
              setSelected("");
            }}
          >
            {beLabel("Match")}
          </Button>
        </>
      }
    >
      {line && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
            <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Statement line</p>
            <p className="mt-[2px] text-body-sm font-semibold text-content-primary">
              {line.reference} · {formatDate(line.date)} · {money(line.amount, currency)}
            </p>
          </div>

          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bills by number, vendor or amount…"
            widthClassName="w-full"
          />

          {candidates.length === 0 ? (
            <EmptyState
              icon={<FileSearch size={28} strokeWidth={1.75} />}
              title="No bills to match"
              description="No unmatched bills fit this search. Mark the line as a missing invoice instead and request it from the vendor."
            />
          ) : (
            <ul role="radiogroup" aria-label="Candidate bills" className="flex max-h-[320px] flex-col gap-[var(--space-xs)] overflow-y-auto">
              {candidates.map((bill) => {
                const active = bill.id === selected;
                const sameAmount = Math.abs(bill.amount - line.amount) < 0.005;
                return (
                  <li key={bill.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelected(bill.id)}
                      className={`flex w-full items-center justify-between gap-[var(--space-md)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-left transition-colors ${
                        active ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-alt"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
                        <span
                          aria-hidden
                          className={`h-4 w-4 shrink-0 rounded-full border-2 ${active ? "border-accent bg-accent" : "border-border-strong"}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm font-semibold text-content-primary">
                            {bill.number} · {bill.vendor}
                          </span>
                          <span className="block text-caption text-content-secondary">{formatDate(bill.date)}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-[2px]">
                        <span className="text-body-sm font-bold text-content-primary">{money(bill.amount, currency)}</span>
                        {sameAmount && <Badge variant="success">Same amount</Badge>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
