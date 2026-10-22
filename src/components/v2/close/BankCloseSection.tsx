"use client";

import { Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { authFetch } from "@/lib/authFetch";
import { useAppSelector } from "@/store/hooks";

// "Clear the bank": every bank line dated on or before the period end must be
// sorted (matched, posted, a transfer or excluded) before the period closes.
// Counts come from the bank feed (GET /api/bank-transactions/unsorted).

export interface BankUnsorted {
  toReview: number;
  readyToPost: number;
}

/** Bank lines still open up to `periodEnd`; null while loading or when bank feeds aren't set up. */
export function useBankUnsorted(periodEnd: string | null): BankUnsorted | null {
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [counts, setCounts] = useState<{ key: string; value: BankUnsorted | null } | null>(null);
  const key = `${qbConnectionId}|${periodEnd}`;
  useEffect(() => {
    if (!qbConnectionId || !periodEnd) return;
    let cancelled = false;
    authFetch(`/api/bank-transactions/unsorted?to=${encodeURIComponent(periodEnd)}`, { headers: { "X-QB-Id": qbConnectionId } })
      .then((r) => (r.ok ? (r.json() as Promise<BankUnsorted>) : null))
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setCounts({ key, value });
      });
    return () => {
      cancelled = true;
    };
  }, [qbConnectionId, periodEnd, key]);
  return counts?.key === key ? counts.value : null;
}

export function bankSummary(counts: BankUnsorted | null): string {
  if (!counts) return "Waiting for bank feeds";
  const open = counts.toReview + counts.readyToPost;
  if (open === 0) return "Every bank line is sorted";
  const parts = [counts.toReview ? `${counts.toReview} to review` : "", counts.readyToPost ? `${counts.readyToPost} ready to post` : ""].filter(Boolean);
  return `${parts.join(", ")}`;
}

export function BankCloseSection({ counts, periodName }: { counts: BankUnsorted | null; periodName: string }) {
  const router = useRouter();
  const open = counts ? counts.toReview + counts.readyToPost : null;
  return (
    <div className="flex flex-col items-center">
      <EmptyState
        icon={<Landmark size={28} strokeWidth={1.75} />}
        title={open === null ? "Bank lines can't be checked yet" : open === 0 ? "The bank is clear" : `${open} bank line${open === 1 ? "" : "s"} still open`}
        description={
          open === null
            ? "Connect a bank or import a statement in Bank Transactions. This step stays open until the bank lines can be counted."
            : open === 0
              ? `Every bank line up to the end of ${periodName} is matched, posted, a transfer or excluded.`
              : `Up to the end of ${periodName}: ${bankSummary(counts)}. Sort them in Bank Transactions to finish this step.`
        }
      />
      <Button size="sm" variant="outline" onClick={() => router.push("/bank-transactions")}>
        Open Bank Transactions
      </Button>
    </div>
  );
}
