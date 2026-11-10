"use client";

import { useEffect, useMemo, useState } from "react";

import { billVotes, invoicePicks, sameVendorName, type PastBill } from "@/lib/suggestions/invoicePicks";
import { ruleForVendor } from "@/lib/suggestions/match";
import { pickReason, type MemoryVote, type SuggestionPick } from "@/lib/suggestions/picks";
import {
  fetchSuggestionRules,
  fetchSuggestionSettings,
  fetchVendorMemory,
  type AutoClassification,
  type SuggestionRuleDto,
} from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

// Smart Suggestions on the invoice review screen: the company's rules and
// Auto-classification setting (for InvoiceRuleHint), and the top 3 GL
// accounts for the account dropdown (lib/suggestions/invoicePicks.ts).
// With Auto-classification Off, or without bank feeds on the server, there
// are no picks; the vendor default the API fills in stays as it is.

function pastBill(inv: InvoiceRecord): PastBill {
  const d = inv.extractedData;
  return {
    id: inv._id,
    vendorId: inv.vendor?.vendorDbId ?? null,
    vendorName: d?.vendorName ?? "",
    number: d?.invoiceNumber ?? "",
    date: (d?.invoiceDate ?? "").slice(0, 10),
    total: typeof d?.totalAmount === "number" ? d.totalAmount : null,
    glAccountId: d?.glAccountId ?? null,
    taxCodeId: d?.taxCodeId ?? null,
    decidedAt: inv.quickbooks?.postedAt ?? inv.updatedAt ?? inv.createdAt ?? new Date(0).toISOString(),
  };
}

export interface InvoiceSuggestions {
  rules: SuggestionRuleDto[];
  mode: AutoClassification;
  picks: { pick: SuggestionPick; name: string; reason: string }[];
}

export function useInvoiceSuggestions(args: { invoiceId: string; vendorId: string; vendorName: string; glAccounts: GLAccount[] }): InvoiceSuggestions {
  const { invoiceId, vendorId, vendorName, glAccounts } = args;
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const vendors = useAppSelector((s) => s.quickBooks.vendors);
  // Bills a person posted: postedStatus "manual". Auto-posted ones were never a person's choice.
  const posted = useAppSelector((s) => s.invoice.manualPostedInvoices);
  const [rules, setRules] = useState<SuggestionRuleDto[]>([]);
  const [mode, setMode] = useState<AutoClassification>("off");
  const [bankVotes, setBankVotes] = useState<{ vendorId: string; votes: MemoryVote[] }>({ vendorId: "", votes: [] });

  useEffect(() => {
    if (!qbConnectionId) return;
    let cancelled = false;
    void Promise.all([dispatch(fetchSuggestionRules()), dispatch(fetchSuggestionSettings())]).then(([r, s]) => {
      if (cancelled) return;
      setRules(fetchSuggestionRules.fulfilled.match(r) ? r.payload : []);
      setMode(fetchSuggestionSettings.fulfilled.match(s) ? s.payload.autoClassification : "off");
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, qbConnectionId]);

  const vendor = useMemo(
    () => (vendorId ? vendors.find((v) => v._id === vendorId) : undefined) ?? vendors.find((v) => sameVendorName(v.displayName, vendorName)),
    [vendors, vendorId, vendorName],
  );
  const memoryVendorId = vendor?._id ?? vendorId;

  useEffect(() => {
    if (!qbConnectionId || !memoryVendorId || mode === "off") return;
    let cancelled = false;
    void dispatch(fetchVendorMemory(memoryVendorId)).then((r) => {
      if (!cancelled) setBankVotes({ vendorId: memoryVendorId, votes: fetchVendorMemory.fulfilled.match(r) ? r.payload : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, qbConnectionId, memoryVendorId, mode]);

  const picks = useMemo(() => {
    if (mode === "off" || !vendorName.trim()) return [];
    const rule = ruleForVendor(rules.filter((r) => !r.broken), vendorName);
    const votes = [
      ...billVotes(posted.map(pastBill), { id: memoryVendorId || null, name: vendorName }, invoiceId),
      ...(bankVotes.vendorId === memoryVendorId ? bankVotes.votes : []),
    ];
    const found = invoicePicks({
      vendorName: vendor?.displayName ?? vendorName,
      rule: rule ? { id: rule.id, glAccountId: rule.glAccountId, taxCodeId: rule.taxCodeId, label: rule.label } : null,
      vendorDefault: vendor ? { glAccountId: vendor.glAccountId ?? null, taxCodeId: vendor.taxCodeId ?? null } : null,
      votes,
    });
    // Only accounts this screen can post to; a deleted one drops out and the rest move up.
    return found.flatMap((pick) => {
      const account = glAccounts.find((a) => a.qbAccountId === pick.glAccountId && !a.isDeleted);
      return account ? [{ pick, name: account.name, reason: pickReason(pick, account.name) }] : [];
    });
  }, [mode, rules, vendorName, vendor, posted, memoryVendorId, invoiceId, bankVotes, glAccounts]);

  return { rules, mode, picks };
}
