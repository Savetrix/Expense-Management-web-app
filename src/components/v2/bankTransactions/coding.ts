"use client";

import { useEffect, useMemo } from "react";

import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts, fetchQuickBooksTaxCodes, fetchQuickBooksVendors } from "@/store/quickBooks/quickBooksApi";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";


import type { BankTransaction } from "./types";

// How a bank line is coded (vendor, GL account, tax code) and where that came
// from. GL accounts are identified by the accounting software's own id
// (qbAccountId), the same id invoices and vendor defaults use, so a bank line
// coded "Travel" and a bill coded "Travel" agree.

/** The suggestion the server stores on a line (lib/bankFeeds/suggest.ts). */
export interface LineSuggestion {
  kind: "expense" | "transfer" | "exclude" | "bill" | null;
  glAccountId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  transferLabel?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  checks: Record<"legibility" | "completeness" | "history", { ok: boolean; detail: string }>;
  autoCoded: boolean;
  basis: { agreeing: number; total: number; lines: number };
}

export function suggestionOf(txn: BankTransaction): LineSuggestion | null {
  const s = txn.suggestion as LineSuggestion | undefined;
  return s && typeof s === "object" && "reason" in s ? s : null;
}

export interface Lookups {
  glById: Map<string, GLAccount>;
  vendorById: Map<string, Vendor>;
  taxById: Map<string, TaxCode>;
  vendors: Vendor[];
  glAccounts: GLAccount[];
  taxCodes: TaxCode[];
}

/** Loads the company's GL accounts, vendors and tax codes once, and indexes them. */
export function useBankLookups(): Lookups {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.user?.data?.accessToken);
  const qb = useAppSelector((s) => s.quickBooks);
  const accountsLoaded = qb.accountsConnectionId === qb.qbConnectionId;
  const vendorsLoaded = qb.vendorsConnectionId === qb.qbConnectionId;
  const taxLoaded = qb.taxCodesConnectionId === qb.qbConnectionId;
  useEffect(() => {
    if (!accessToken || !qb.qbConnectionId) return;
    if (!accountsLoaded) dispatch(fetchQuickBooksAccounts({ accessToken }));
    if (!vendorsLoaded) dispatch(fetchQuickBooksVendors({ accessToken }));
    if (!taxLoaded && !qb.taxCodesLoading) dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, qb.qbConnectionId]);
  return useMemo(() => {
    const glAccounts = qb.accounts.filter((a) => !a.isDeleted);
    return {
      glAccounts,
      vendors: qb.vendors,
      taxCodes: qb.taxCodes.filter((t) => !t.isDeleted),
      glById: new Map(glAccounts.map((a) => [a.qbAccountId, a])),
      vendorById: new Map(qb.vendors.map((v) => [v._id, v])),
      taxById: new Map(qb.taxCodes.map((t) => [taxCodeId(t), t])),
    };
  }, [qb.accounts, qb.vendors, qb.taxCodes]);
}

export type CodingSource = "user" | "autopilot" | "suggested" | "none";

export interface Coding {
  vendorId?: string;
  payee?: string;
  glAccountId?: string;
  taxCodeId?: string;
  source: CodingSource;
  reason: string | null;
  suggestion: LineSuggestion | null;
}

/**
 * What a line shows: the user's own coding, Scantrix's coding, or — for a line
 * still to review whose payee was seen before — the suggestion from history.
 * A payee seen for the first time stays blank (the client's rule).
 */
export function codingFor(txn: BankTransaction): Coding {
  const suggestion = suggestionOf(txn);
  const own = { vendorId: txn.vendorId, payee: txn.payee, glAccountId: txn.categoryId, taxCodeId: txn.taxCodeId };
  const hasOwn = Boolean(own.vendorId || own.glAccountId || own.taxCodeId);
  // Scantrix coded it itself: the values are saved, but not yet confirmed by a person.
  if (hasOwn && suggestion?.autoCoded && own.glAccountId === suggestion.glAccountId) {
    return { ...own, source: "autopilot", reason: suggestion.reason, suggestion };
  }
  // History fills, field by field, whatever the user hasn't set on a line still to review.
  const fromHistory = txn.status === "review" && suggestion?.kind === "expense" && suggestion.glAccountId ? suggestion : null;
  const merged = {
    vendorId: own.vendorId ?? fromHistory?.vendorId,
    payee: own.payee ?? fromHistory?.payee,
    glAccountId: own.glAccountId ?? fromHistory?.glAccountId,
    taxCodeId: own.taxCodeId ?? fromHistory?.taxCodeId,
  };
  if (hasOwn) return { ...merged, source: "user", reason: fromHistory?.reason ?? null, suggestion };
  if (fromHistory) return { ...merged, source: "suggested", reason: fromHistory.reason, suggestion };
  return { source: "none", reason: suggestion?.reason ?? null, suggestion };
}

/** True when this field shows a value the user hasn't chosen (a suggestion, or Scantrix's own coding). */
export function isSuggestedField(txn: BankTransaction, field: "vendorId" | "categoryId" | "taxCodeId"): boolean {
  const c = codingFor(txn);
  if (c.source === "autopilot") return true;
  const shown = field === "vendorId" ? c.vendorId : field === "categoryId" ? c.glAccountId : c.taxCodeId;
  return Boolean(shown) && !txn[field];
}

/** "Uber · Travel · GST 5%" — the parts that are known. */
export function codingLabel(c: Coding, lookups: Lookups): string {
  const vendor = c.vendorId ? lookups.vendorById.get(c.vendorId)?.displayName : undefined;
  const gl = c.glAccountId ? lookups.glById.get(c.glAccountId)?.name : undefined;
  const tax = c.taxCodeId ? lookups.taxById.get(c.taxCodeId) : undefined;
  return [vendor ?? c.payee, gl, tax ? taxCodeLabel(tax) : undefined].filter(Boolean).join(" · ");
}
