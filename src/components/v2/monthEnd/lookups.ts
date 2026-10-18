"use client";

import { useEffect, useMemo } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts, fetchQuickBooksVendors } from "@/store/quickBooks/quickBooksApi";

// Real GL accounts and vendors from the active accounting connection. Nothing
// here is invented: an empty list means the connection has none (or they are
// still loading).

/** Loads the company's GL accounts and vendors once per company. Call once per page. */
export function useMonthEndLookups(): void {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.user?.data?.accessToken);
  const connections = useAppSelector((s) => s.quickBooks.connections);
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const accountsLoaded = useAppSelector((s) => s.quickBooks.accountsConnectionId === s.quickBooks.qbConnectionId);
  const vendorsLoaded = useAppSelector((s) => s.quickBooks.vendorsConnectionId === s.quickBooks.qbConnectionId);
  const active = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);

  useEffect(() => {
    if (!accessToken || !active?._id) return;
    if (!accountsLoaded) dispatch(fetchQuickBooksAccounts({ accessToken }));
    if (!vendorsLoaded) dispatch(fetchQuickBooksVendors({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, active?._id]);
}

export interface GlAccountGroups {
  prepayment: string[];
  expense: string[];
  deferred: string[];
  income: string[];
  asset: string[];
  accumulated: string[];
  depreciationExpense: string[];
  accrualLiability: string[];
  proceeds: string[];
  gainLoss: string[];
  loading: boolean;
}

const test = (re: RegExp) => (type: string) => re.test(type);
const isExpense = test(/expense|overhead|direct\s?cost|cost of goods/i);
const isIncome = test(/income|revenue|sales/i);
const isLiability = test(/liab/i);
const isFixed = test(/fixed|non-?current|other asset/i);
const isCurrentAsset = test(/current asset|prepayment|^current$|bank|receivable/i);
const isAnyAsset = test(/asset|bank|receivable|^current$|^fixed$|^noncurrent$|prepayment|inventory/i);

/** Real GL accounts grouped by what the form needs them for (by account type). */
export function useGlAccountGroups(): GlAccountGroups {
  const accounts = useAppSelector((s) => s.quickBooks.accounts);
  const loading = useAppSelector((s) => s.quickBooks.accountsLoading);
  return useMemo(() => {
    const live = accounts.filter((a) => !a.isDeleted && a.name);
    const names = (pred: (type: string) => boolean) => Array.from(new Set(live.filter((a) => pred(a.accountType || "")).map((a) => a.name))).sort();
    const all = names(() => true);
    // A type filter that matches nothing falls back to every account, so a
    // provider with unusual type names never blocks the form.
    const pick = (pred: (type: string) => boolean) => {
      const list = names(pred);
      return list.length ? list : all;
    };
    const expense = pick(isExpense);
    const liability = pick(isLiability);
    const fixed = pick(isFixed);
    return {
      prepayment: pick((t) => isCurrentAsset(t) || isFixed(t)),
      expense,
      deferred: liability,
      income: pick(isIncome),
      asset: fixed,
      accumulated: fixed,
      depreciationExpense: expense,
      accrualLiability: liability,
      proceeds: pick(isAnyAsset),
      gainLoss: pick((t) => isIncome(t) || isExpense(t)),
      loading,
    };
  }, [accounts, loading]);
}

/** Real vendor names, for the vendor pickers. */
export function useVendorNames(): string[] {
  const vendors = useAppSelector((s) => s.quickBooks.vendors);
  return useMemo(() => Array.from(new Set(vendors.map((v) => v.displayName).filter(Boolean))).sort(), [vendors]);
}
