"use client";

import { useEffect, useMemo } from "react";

import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";
import { pickReason, type SuggestionPick } from "@/lib/suggestions/picks";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts, fetchQuickBooksTaxCodes, fetchQuickBooksVendors } from "@/store/quickBooks/quickBooksApi";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";


import type { BankTransaction } from "./types";

// How a bank line is coded (vendor, GL account, tax code) and where that came
// from. GL accounts are identified by the accounting software's own id
// (qbAccountId), the same id invoices and vendor defaults use, so a bank line
// coded "Travel" and a bill coded "Travel" agree.

export { codingFor, isSuggestedField, suggestionOf, surePatch, isSureLine, type Coding, type CodingSource, type LineSuggestion, type Offered } from "./lineCoding";
import { suggestionOf, type Coding } from "./lineCoding";

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

/** "Uber · Travel · GST 5%" — the parts that are known. */
export function codingLabel(c: Coding, lookups: Lookups): string {
  const vendor = c.vendorId ? lookups.vendorById.get(c.vendorId)?.displayName : undefined;
  const gl = c.glAccountId ? lookups.glById.get(c.glAccountId)?.name : undefined;
  const tax = c.taxCodeId ? lookups.taxById.get(c.taxCodeId) : undefined;
  return [vendor ?? c.payee, gl, tax ? taxCodeLabel(tax) : undefined].filter(Boolean).join(" · ");
}

/** The line's top 3 accounts for the account dropdown: name, reason, confidence. */
export function picksFor(txn: BankTransaction, lookups: Lookups, accountName?: (id: string) => string | undefined): { pick: SuggestionPick; name: string; reason: string }[] {
  if (txn.status !== "review") return [];
  const picks = suggestionOf(txn)?.picks ?? [];
  return picks.flatMap((pick) => {
    const name = accountName?.(pick.glAccountId) ?? lookups.glById.get(pick.glAccountId)?.name;
    return name ? [{ pick, name, reason: pickReason(pick, name) }] : [];
  });
}
