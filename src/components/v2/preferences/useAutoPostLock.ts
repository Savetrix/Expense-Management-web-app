"use client";

import { useEffect, useMemo, useState } from "react";

import { authFetch } from "@/lib/authFetch";
import { autoPostLock, DEFAULT_AUTOPOST_UNLOCK_DAYS, earliest, type AutoPostLock } from "@/lib/suggestions/autoPostLock";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

/** When a bill was posted: its "posted" status change, else when it was last changed. */
function postedAt(inv: InvoiceRecord): string | null {
  const change = inv.statusHistory?.find((h) => h.postedStatus && /manual|auto|posted/i.test(h.postedStatus) && h.changedAt);
  return change?.changedAt ?? inv.updatedAt ?? inv.createdAt ?? null;
}

/**
 * The auto-post lock for the company picked in the header (lib/suggestions/autoPostLock.ts):
 * locked until it has N days of coding in Scantrix — posted bills or coded bank lines.
 * While the numbers load, the switch can't be turned on.
 */
export function useAutoPostLock(): AutoPostLock & { loading: boolean } {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const { manualPostedInvoices, autoPostedInvoices, pendingInvoices, invoices, loading: invoicesLoading } = useAppSelector((s) => s.invoice);
  const [bank, setBank] = useState<{ for: string | null; requiredDays: number; firstAt: string | null } | null>(null);

  // The invoice lists are only loaded by some pages: load them here if nothing is cached.
  const noInvoices = manualPostedInvoices.length + autoPostedInvoices.length + pendingInvoices.length + invoices.length === 0;
  useEffect(() => {
    if (qbConnectionId && noInvoices && !invoicesLoading) dispatch(getInvoices());
    // Once per company; getInvoices de-duplicates a request already in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  useEffect(() => {
    if (!qbConnectionId) return;
    let cancelled = false;
    void (async () => {
      let next = { for: qbConnectionId, requiredDays: DEFAULT_AUTOPOST_UNLOCK_DAYS, firstAt: null as string | null };
      try {
        const res = await authFetch("/api/suggestions/auto-post-readiness", { headers: { "X-QB-Id": qbConnectionId } });
        const body = res.ok ? await res.json() : null;
        if (body) next = { for: qbConnectionId, requiredDays: Number(body.requiredDays) || DEFAULT_AUTOPOST_UNLOCK_DAYS, firstAt: body.firstBankDecisionAt ?? null };
      } catch {
        // Bank feeds off or unreachable here: the posted bills decide alone.
      }
      if (!cancelled) setBank(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [qbConnectionId]);

  const firstBill = useMemo(() => earliest(...[...manualPostedInvoices, ...autoPostedInvoices].map(postedAt)), [manualPostedInvoices, autoPostedInvoices]);
  const loading = !bank || bank.for !== qbConnectionId || (noInvoices && invoicesLoading);
  const requiredDays = bank?.requiredDays ?? DEFAULT_AUTOPOST_UNLOCK_DAYS;
  const lock = autoPostLock(earliest(firstBill, bank?.firstAt), requiredDays);
  return loading ? { ...lock, locked: true, note: "Checking how long this company has been coding in Scantrix…", loading } : { ...lock, loading };
}
