"use client";

import { AlertTriangle, ChevronDown, ChevronUp, Clock3, Lightbulb, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/Card";
import { taxCodeId as getTaxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

// A vendor with no posted invoice in this long is flagged as possibly unused.
const STALE_MONTHS = 6;
// A GL/tax code suggestion only fires if it's the majority choice across the
// vendor's own coded invoices — otherwise there's no clear default to propose.
const MAJORITY_THRESHOLD = 0.5;

type SuggestionKind = "gl-deleted" | "tax-deleted" | "gl-suggest" | "tax-suggest" | "stale";

interface Suggestion {
  id: string;
  kind: SuggestionKind;
  vendor: Vendor;
  message: string;
  actionLabel: string;
  payload?: string;
}

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

function mostFrequent(values: string[]): { value: string | null; count: number; total: number } {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let value: string | null = null;
  let count = 0;
  for (const [v, c] of counts) {
    if (c > count) {
      value = v;
      count = c;
    }
  }
  return { value, count, total: values.length };
}

function buildSuggestions(
  vendors: Vendor[],
  glAccounts: GLAccount[],
  taxCodes: TaxCode[],
  invoices: InvoiceRecord[],
  providerName: string,
): Suggestion[] {
  const glById = new Map(glAccounts.map((a) => [a.qbAccountId, a]));
  const taxById = new Map(taxCodes.map((t) => [getTaxCodeId(t), t]));
  const staleCutoff = monthsAgo(STALE_MONTHS);

  const invoicesByVendor = new Map<string, InvoiceRecord[]>();
  for (const invoice of invoices) {
    if (invoice.postedStatus !== "auto" && invoice.postedStatus !== "manual") continue;
    const vendorId = invoice.vendor?.vendorDbId;
    if (!vendorId) continue;
    const list = invoicesByVendor.get(vendorId);
    if (list) list.push(invoice);
    else invoicesByVendor.set(vendorId, [invoice]);
  }

  const results: Suggestion[] = [];

  for (const vendor of vendors) {
    const vendorInvoices = invoicesByVendor.get(vendor._id) || [];

    // GL account: either fix a dangling reference, or propose one from history.
    if (vendor.glAccountId) {
      const account = glById.get(vendor.glAccountId);
      if (!account || account.isDeleted) {
        results.push({
          id: `${vendor._id}-gl-deleted`,
          kind: "gl-deleted",
          vendor,
          message: `"${vendor.displayName}"'s default GL account no longer exists in ${providerName}.`,
          actionLabel: "Fix GL account",
        });
      }
    } else {
      const glValues = vendorInvoices.map((inv) => inv.extractedData?.glAccountId).filter((v): v is string => !!v);
      if (glValues.length > 0) {
        const best = mostFrequent(glValues);
        if (best.value && best.count / best.total >= MAJORITY_THRESHOLD) {
          const name = glById.get(best.value)?.name || best.value;
          results.push({
            id: `${vendor._id}-gl-suggest`,
            kind: "gl-suggest",
            vendor,
            message: `"${vendor.displayName}" has no default GL account — ${best.count} of their last ${best.total} coded invoices used ${name}.`,
            actionLabel: `Set ${name} as default`,
            payload: best.value,
          });
        }
      }
    }

    // Tax code: same pattern as GL account above.
    if (vendor.taxCodeId) {
      const code = taxById.get(vendor.taxCodeId);
      if (!code || code.isDeleted) {
        results.push({
          id: `${vendor._id}-tax-deleted`,
          kind: "tax-deleted",
          vendor,
          message: `"${vendor.displayName}"'s default tax code no longer exists in ${providerName}.`,
          actionLabel: "Fix tax code",
        });
      }
    } else {
      const taxValues = vendorInvoices.map((inv) => inv.extractedData?.taxCodeId).filter((v): v is string => !!v);
      if (taxValues.length > 0) {
        const best = mostFrequent(taxValues);
        if (best.value && best.count / best.total >= MAJORITY_THRESHOLD) {
          const code = taxById.get(best.value);
          const name = code ? taxCodeName(code) : best.value;
          results.push({
            id: `${vendor._id}-tax-suggest`,
            kind: "tax-suggest",
            vendor,
            message: `"${vendor.displayName}" has no default tax code — ${best.count} of their last ${best.total} coded invoices used ${name}.`,
            actionLabel: `Set ${name} as default`,
            payload: best.value,
          });
        }
      }
    }

    // Staleness: last posted invoice (or, failing that, when the vendor was
    // added) older than the cutoff suggests they're no longer in active use.
    let lastActivity: Date | null = null;
    for (const invoice of vendorInvoices) {
      const dateStr = invoice.extractedData?.invoiceDate || invoice.createdAt;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (!Number.isNaN(d.getTime()) && (!lastActivity || d > lastActivity)) lastActivity = d;
    }
    if (!lastActivity && vendor.createdAt) {
      const d = new Date(vendor.createdAt);
      if (!Number.isNaN(d.getTime())) lastActivity = d;
    }
    if (lastActivity && lastActivity < staleCutoff) {
      const activitySuffix =
        vendorInvoices.length > 0
          ? `hasn't had an invoice posted in over ${STALE_MONTHS} months`
          : "has never had an invoice posted since being added";
      results.push({
        id: `${vendor._id}-stale`,
        kind: "stale",
        vendor,
        message: `"${vendor.displayName}" ${activitySuffix}.`,
        actionLabel: "Deactivate",
      });
    }
  }

  return results;
}

const KIND_ICON: Record<SuggestionKind, React.ReactNode> = {
  "gl-deleted": <AlertTriangle size={16} strokeWidth={2} className="text-warning" />,
  "tax-deleted": <AlertTriangle size={16} strokeWidth={2} className="text-warning" />,
  "gl-suggest": <Wand2 size={16} strokeWidth={2} className="text-primary" />,
  "tax-suggest": <Wand2 size={16} strokeWidth={2} className="text-primary" />,
  stale: <Clock3 size={16} strokeWidth={2} className="text-text-secondary" />,
};

interface VendorCleanupSuggestionsProps {
  vendors: Vendor[];
  glAccounts: GLAccount[];
  taxCodes: TaxCode[];
  invoices: InvoiceRecord[];
  onApplyGlAccount: (vendor: Vendor, glAccountId: string) => Promise<boolean>;
  onApplyTaxCode: (vendor: Vendor, taxCodeId: string) => Promise<boolean>;
  onOpenEdit: (vendor: Vendor) => void;
  onDeactivate: (vendor: Vendor) => void;
}

export function VendorCleanupSuggestions({
  vendors,
  glAccounts,
  taxCodes,
  invoices,
  onApplyGlAccount,
  onApplyTaxCode,
  onOpenEdit,
  onDeactivate,
}: VendorCleanupSuggestionsProps) {
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const providerName = useActiveProvider().name;

  const suggestions = useMemo(
    () => buildSuggestions(vendors, glAccounts, taxCodes, invoices, providerName).filter((s) => !dismissed.has(s.id)),
    [vendors, glAccounts, taxCodes, invoices, providerName, dismissed],
  );

  if (suggestions.length === 0) return null;

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  const handleAction = async (suggestion: Suggestion) => {
    switch (suggestion.kind) {
      case "gl-deleted":
      case "tax-deleted":
        onOpenEdit(suggestion.vendor);
        return;
      case "stale":
        onDeactivate(suggestion.vendor);
        return;
      case "gl-suggest":
      case "tax-suggest": {
        if (!suggestion.payload) return;
        setApplyingId(suggestion.id);
        try {
          const ok =
            suggestion.kind === "gl-suggest"
              ? await onApplyGlAccount(suggestion.vendor, suggestion.payload)
              : await onApplyTaxCode(suggestion.vendor, suggestion.payload);
          if (ok) dismiss(suggestion.id);
        } finally {
          setApplyingId(null);
        }
        return;
      }
    }
  };

  return (
    <Card className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]"
      >
        <span className="flex items-center gap-[var(--space-xs)]">
          <Lightbulb size={16} strokeWidth={2} className="text-trust-navy" />
          <span className="text-body-sm font-bold text-trust-navy">Suggested cleanups</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold text-white">
            {suggestions.length}
          </span>
        </span>
        {open ? (
          <ChevronUp size={16} strokeWidth={2.25} className="text-text-secondary" />
        ) : (
          <ChevronDown size={16} strokeWidth={2.25} className="text-text-secondary" />
        )}
      </button>
      {open && (
        <div className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto border-t border-border">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="flex gap-[var(--space-sm)] p-[var(--space-md)]">
              <div className="mt-[2px] shrink-0">{KIND_ICON[suggestion.kind]}</div>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-text-primary">{suggestion.message}</p>
                <div className="mt-[var(--space-sm)] flex items-center gap-[var(--space-sm)]">
                  <button
                    type="button"
                    onClick={() => handleAction(suggestion)}
                    disabled={applyingId === suggestion.id}
                    className="rounded-md bg-primary/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {applyingId === suggestion.id ? "…" : suggestion.actionLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(suggestion.id)}
                    className="text-caption font-semibold text-text-secondary hover:text-text-primary"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
