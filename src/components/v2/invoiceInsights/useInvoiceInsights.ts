"use client";

import { useCallback, useEffect, useState } from "react";

import { authFetch } from "@/lib/authFetch";
import { useAppSelector } from "@/store/hooks";
import type { BankTransactionDto } from "@/store/bankFeeds/bankFeedsApi";

// What Scantrix noticed on one invoice (GET /api/invoices/:id/insights): the
// period it covers, and the bank line that paid it. Silent when the server has
// nothing to say or isn't set up — the card simply shows no extra rows.

export interface InvoiceInsights {
  period: { start: string; end: string; months: number; evidence: string; source: "range" | "duration" } | null;
  prepayment: boolean;
  dismissed: boolean;
  bank: { matched: BankTransactionDto[]; candidates: BankTransactionDto[] } | null;
}

export function useInvoiceInsights(invoiceId: string | null | undefined) {
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [data, setData] = useState<InvoiceInsights | null>(null);

  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!invoiceId || !qbConnectionId) return;
    let cancelled = false;
    authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}/insights`, { headers: { "X-QB-Id": qbConnectionId } })
      .then((response) => (response.ok ? (response.json() as Promise<InvoiceInsights>) : null))
      .catch(() => null)
      .then((next) => {
        // A late answer for a previous invoice must not land on this one.
        if (!cancelled) setData(next);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, qbConnectionId, version]);

  const setDismissed = useCallback(
    async (dismissed: boolean) => {
      if (!invoiceId || !qbConnectionId) return false;
      setData((d) => (d ? { ...d, dismissed } : d));
      const response = await authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}/prepayment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-QB-Id": qbConnectionId },
        body: JSON.stringify({ dismissed }),
      }).catch(() => null);
      if (!response?.ok) setData((d) => (d ? { ...d, dismissed: !dismissed } : d));
      return Boolean(response?.ok);
    },
    [invoiceId, qbConnectionId],
  );

  return { data, reload, setDismissed };
}
