"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ruleForVendor } from "@/lib/suggestions/match";
import { fetchSuggestionRules, fetchSuggestionSettings, type AutoClassification, type SuggestionRuleDto } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

// Smart Suggestions, step 1, on the invoice review screen: the company's rule
// for this vendor ("Always code Uber to Travel"). A rule beats the vendor's
// default GL, but it never replaces a GL already on the invoice by itself:
//   - GL empty and Auto-classification "Fill in when sure": filled in here;
//   - otherwise: offered with "Use rule".
// Either way nothing is saved until the person saves or posts the invoice.
// Without bank feeds on the server (or with Auto-classification Off) it shows nothing.

interface InvoiceRuleHintProps {
  vendorName: string;
  glAccountId: string;
  taxCodeId: string;
  glAccounts: GLAccount[];
  /** Only a pending invoice is filled in by itself; a posted one being edited is only offered the rule. */
  allowFill: boolean;
  onUse: (rule: { glAccountId: string; taxCodeId: string | null }) => void;
}

export function InvoiceRuleHint({ vendorName, glAccountId, taxCodeId, glAccounts, allowFill, onUse }: InvoiceRuleHintProps) {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [rules, setRules] = useState<SuggestionRuleDto[]>([]);
  const [mode, setMode] = useState<AutoClassification>("off");
  const [filledBy, setFilledBy] = useState<string | null>(null);
  const filledOnce = useRef(false);

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

  const found = mode === "off" ? null : ruleForVendor(rules.filter((r) => !r.broken), vendorName);
  // Only an account this screen can select (the GL list for bills).
  const account = found ? glAccounts.find((a) => a.qbAccountId === found.glAccountId && !a.isDeleted) : undefined;
  const rule = found && account ? found : null;
  const agrees = Boolean(rule && rule.glAccountId === glAccountId && (!rule.taxCodeId || rule.taxCodeId === taxCodeId));

  useEffect(() => {
    if (!rule || filledOnce.current || mode !== "fill" || !allowFill || glAccountId) return;
    filledOnce.current = true;
    setFilledBy(rule.id);
    onUse({ glAccountId: rule.glAccountId, taxCodeId: rule.taxCodeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule?.id, mode, allowFill, glAccountId]);

  if (!rule || !account) return null;
  return (
    <div className="mt-[var(--space-xs)] flex flex-wrap items-center justify-end gap-[var(--space-xs)] text-right text-caption text-content-secondary">
      <Sparkles size={13} strokeWidth={2.25} className="shrink-0 text-accent" />
      {agrees ? (
        <span>
          {filledBy === rule.id ? "Filled in by" : "Matches"} your company rule for <span className="font-semibold text-content-primary">{rule.label}</span>
          {filledBy === rule.id && ". Save to keep it"}.
        </span>
      ) : (
        <>
          <span>
            Your company rule for <span className="font-semibold text-content-primary">{rule.label}</span> says{" "}
            <span className="font-semibold text-content-primary">{account.name}</span>.
          </span>
          <Button size="sm" variant="outline" onClick={() => onUse({ glAccountId: rule.glAccountId, taxCodeId: rule.taxCodeId })}>
            Use rule
          </Button>
        </>
      )}
      <Link href="/autopilot?tab=rules" className="font-semibold text-accent hover:underline">
        Rules
      </Link>
    </div>
  );
}
