"use client";

import { useEffect, useMemo } from "react";

import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksTaxCodes } from "@/store/quickBooks/quickBooksApi";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";

import { useMonthEndLookups } from "../monthEnd/lookups";

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
  useMonthEndLookups();
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.user?.data?.accessToken);
  const qb = useAppSelector((s) => s.quickBooks);
  const taxLoaded = qb.taxCodesConnectionId === qb.qbConnectionId;
  useEffect(() => {
    if (accessToken && qb.qbConnectionId && !taxLoaded && !qb.taxCodesLoading) dispatch(fetchQuickBooksTaxCodes({ accessToken }));
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * No history yet? A vendor already in the accounting software whose name the
 * bank line carries is still a good first guess, with that vendor's own
 * default GL account and tax code.
 */
export function vendorMatch(txn: BankTransaction, vendors: Vendor[]): Vendor | null {
  const names = [txn.merchantName, txn.payee, txn.description].filter(Boolean).map((n) => norm(n as string));
  if (names.length === 0) return null;
  let best: Vendor | null = null;
  for (const v of vendors) {
    const key = norm(v.displayName || "");
    if (key.length < 3) continue;
    const hit = names.some((n) => n === key || (n.startsWith(key) && key.length >= 4));
    if (hit && (!best || key.length > norm(best.displayName).length)) best = v;
  }
  return best;
}

export type CodingSource = "user" | "autopilot" | "suggested" | "vendor" | "none";

export interface Coding {
  vendorId?: string;
  payee?: string;
  glAccountId?: string;
  taxCodeId?: string;
  source: CodingSource;
  reason: string | null;
  suggestion: LineSuggestion | null;
}

/** What a line is coded as now, or what Scantrix would suggest. */
export function codingFor(txn: BankTransaction, lookups: Lookups): Coding {
  const suggestion = suggestionOf(txn);
  if (txn.categoryId || txn.vendorId || txn.taxCodeId) {
    return {
      vendorId: txn.vendorId,
      payee: txn.payee,
      glAccountId: txn.categoryId,
      taxCodeId: txn.taxCodeId,
      source: suggestion?.autoCoded && txn.categoryId === suggestion.glAccountId ? "autopilot" : "user",
      reason: suggestion?.autoCoded ? suggestion.reason : null,
      suggestion,
    };
  }
  if (suggestion?.kind === "expense" && suggestion.glAccountId) {
    return { vendorId: suggestion.vendorId, payee: suggestion.payee, glAccountId: suggestion.glAccountId, taxCodeId: suggestion.taxCodeId, source: "suggested", reason: suggestion.reason, suggestion };
  }
  const vendor = vendorMatch(txn, lookups.vendors);
  if (vendor) {
    return {
      vendorId: vendor._id,
      payee: vendor.displayName,
      glAccountId: vendor.glAccountId ?? undefined,
      taxCodeId: vendor.taxCodeId ?? undefined,
      source: "vendor",
      reason: `Matches ${vendor.displayName}, already a vendor${vendor.glAccountId ? "; uses its default account" : ""}.`,
      suggestion,
    };
  }
  return { source: "none", reason: suggestion?.reason ?? null, suggestion };
}

/** "Uber · Travel · GST 5%" — the parts that are known. */
export function codingLabel(c: Coding, lookups: Lookups): string {
  const vendor = c.vendorId ? lookups.vendorById.get(c.vendorId)?.displayName : undefined;
  const gl = c.glAccountId ? lookups.glById.get(c.glAccountId)?.name : undefined;
  const tax = c.taxCodeId ? lookups.taxById.get(c.taxCodeId) : undefined;
  return [vendor ?? c.payee, gl, tax ? taxCodeLabel(tax) : undefined].filter(Boolean).join(" · ");
}
