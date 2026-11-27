"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";

/**
 * Loads the invoice list for pages that read it but don't own it (Autopilot,
 * Archive's merge wizard). Mirrors the dashboard: fetch once a company is
 * picked, and only when the slice is still empty so revisits reuse the cache.
 */
export function useEnsureInvoices() {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const hasInvoices = useAppSelector((state) => state.invoice.invoices.length > 0);

  useEffect(() => {
    if (!qbConnectionId || hasInvoices) return;
    dispatch(getInvoices());
    // Keyed on the company only; hasInvoices is read as a guard, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId, dispatch]);
}
