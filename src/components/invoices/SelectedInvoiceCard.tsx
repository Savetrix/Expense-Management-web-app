"use client";

import { ReactNode } from "react";
import { X } from "lucide-react";

import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount, TaxCode } from "@/store/quickBooks/quickBooksSlice";
import { taxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { InvoiceStatusTheme, getInvoiceTitle, getUserDisplayName } from "@/lib/invoiceDisplay";
import { formatDetailAmount, formatDetailDate, formatDetailDateTime, safeDetailValue } from "@/lib/invoiceDetailTheme";

// Shared by InvoiceListContent (row selection panel) and PendingInvoicesContent
// (same panel, pending-only list) — one source of truth for the "selected
// invoice" detail card instead of two drifting copies.

export function vendorInitials(invoice: InvoiceRecord): string {
  const name = (invoice.extractedData?.vendorName || invoice.file?.originalName || "").trim();
  return name ? name.slice(0, 2).toUpperCase() : "?";
}

export function DetailField({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  if (value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-[var(--space-sm)] py-[6px]">
      <span className="shrink-0 text-caption text-text-secondary">{label}</span>
      <span
        className={`text-right font-semibold text-text-primary ${emphasize ? "text-body-sm" : "text-caption"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-caption font-bold uppercase tracking-wide text-text-secondary">{title}</p>
      <div className="mt-[var(--space-xs)] divide-y divide-border">{children}</div>
    </div>
  );
}

// Full inline preview shown in a right-hand panel when a row is selected —
// reads the same InvoiceRecord already loaded for the list (no extra
// fetch, unlike the full detail page's own getInvoiceDetails call). "Open
// full page" is still the escape hatch for actions this panel doesn't do
// (reject/repost, viewing the original document).
export function SelectedInvoiceCard({
  invoice,
  theme,
  glAccounts,
  taxCodes,
  issueMessage,
  onViewFullDetails,
  onClose,
}: {
  invoice: InvoiceRecord;
  theme: InvoiceStatusTheme;
  glAccounts: GLAccount[];
  taxCodes: TaxCode[];
  /** Caller-computed notice banner — e.g. a failure reason for InvoiceListContent,
   * or a "why is this pending" reason for PendingInvoicesContent. Omit for none. */
  issueMessage?: string;
  onViewFullDetails: () => void;
  onClose: () => void;
}) {
  const data = invoice.extractedData;
  const currency = data?.currency || "";
  const confidence = invoice.confidenceScore != null ? `${Math.round(Number(invoice.confidenceScore))}%` : null;
  const statusHistory = invoice.statusHistory ?? [];
  const lineItems = data?.lineItems ?? [];
  const extraCharges = data?.extraCharges ?? [];

  const resolvedGlAccount = glAccounts.find((account) => account.qbAccountId === String(data?.glAccountId ?? ""));
  const resolvedTaxCode = taxCodes.find((code) => taxCodeId(code) === String(data?.taxCodeId ?? ""));

  return (
    <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex shrink-0 items-center justify-between gap-[var(--space-sm)] bg-primary-900 px-[var(--space-md)] py-[var(--space-sm)]">
        <span className="text-caption font-bold uppercase tracking-wide text-primary-200">Selected invoice</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-[var(--space-sm)] p-[var(--space-sm)] text-primary-200 hover:text-white"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--space-md)] pb-[var(--space-lg)]">
        <div className="flex items-center gap-[var(--space-sm)]">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-caption font-bold ${theme.cardBgClass} ${theme.accentTextClass}`}
          >
            {vendorInitials(invoice)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold text-text-primary">{getInvoiceTitle(invoice)}</p>
            <span
              className={`mt-[2px] inline-flex rounded-pill px-[var(--space-sm)] py-[1px] text-caption font-bold ${theme.badgeClass}`}
            >
              {theme.label}
            </span>
          </div>
        </div>

        <div className="mt-[var(--space-md)] rounded-md bg-background-soft p-[var(--space-sm)]">
          <p className="text-caption uppercase tracking-wide text-text-secondary">Total amount</p>
          <p className="text-h3 font-bold text-text-primary">{formatDetailAmount(data?.totalAmount, currency)}</p>
        </div>

        {confidence && (
          <div className="mt-[var(--space-sm)] flex items-center justify-between text-body-sm">
            <span className="text-text-secondary">Confidence</span>
            <span className="font-semibold text-text-primary">{confidence}</span>
          </div>
        )}

        {issueMessage && (
          <div className="mt-[var(--space-sm)] rounded-md border-l-4 border-error bg-error/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-medium text-error">
            {issueMessage}
          </div>
        )}

        <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-md)]">
          <DetailSection title="Invoice">
            <DetailField label="Invoice #" value={safeDetailValue(data?.invoiceNumber)} />
            <DetailField label="Invoice date" value={formatDetailDate(data?.invoiceDate)} />
            <DetailField label="Due date" value={formatDetailDate(data?.dueDate)} />
            <DetailField label="Currency" value={safeDetailValue(currency)} />
            <DetailField label="GL account" value={safeDetailValue(resolvedGlAccount?.name)} />
            <DetailField label="Tax code" value={safeDetailValue(resolvedTaxCode ? taxCodeName(resolvedTaxCode) : undefined)} />
          </DetailSection>

          <DetailSection title="Financials">
            <DetailField label="Before tax" value={formatDetailAmount(data?.amountBeforeTax, currency)} />
            <DetailField label="Tax" value={formatDetailAmount(data?.taxAmount, currency)} />
            <DetailField label="Total" value={formatDetailAmount(data?.totalAmount, currency)} emphasize />
          </DetailSection>

          {(data?.vendorAddress || data?.bankingDetails) && (
            <DetailSection title="Vendor">
              <DetailField label="Address" value={safeDetailValue(data?.vendorAddress)} />
              <DetailField label="Bank details" value={safeDetailValue(data?.bankingDetails)} />
            </DetailSection>
          )}

          {data?.description && (
            <DetailSection title="Description">
              <p className="whitespace-pre-line py-[6px] text-caption text-text-primary">{data.description}</p>
            </DetailSection>
          )}

          {lineItems.length > 0 && (
            <DetailSection title={`Line items (${lineItems.length})`}>
              {lineItems.map((item, index) => (
                <div key={index} className="flex items-center justify-between gap-[var(--space-sm)] py-[6px]">
                  <span className="min-w-0 truncate text-caption text-text-primary">{item.description}</span>
                  <span className="shrink-0 text-caption font-semibold text-text-primary">
                    {formatDetailAmount(item.amount)}
                  </span>
                </div>
              ))}
            </DetailSection>
          )}

          {extraCharges.length > 0 && (
            <DetailSection title={`Extra charges (${extraCharges.length})`}>
              {extraCharges.map((charge, index) => (
                <div key={index} className="flex items-center justify-between gap-[var(--space-sm)] py-[6px]">
                  <span className="min-w-0 truncate text-caption text-text-primary">{charge.description || "Extra charge"}</span>
                  <span className="shrink-0 text-caption font-semibold text-text-primary">
                    {formatDetailAmount(charge.amount)}
                  </span>
                </div>
              ))}
            </DetailSection>
          )}

          {statusHistory.length > 0 && (
            <DetailSection title="History">
              {statusHistory.map((entry, index) => {
                const changedByName = getUserDisplayName(entry.changedBy);
                return (
                  <div key={index} className="flex items-center justify-between gap-[var(--space-sm)] py-[6px]">
                    <span className="min-w-0 truncate text-caption font-semibold text-text-primary">
                      {entry.postedStatus ? entry.postedStatus.charAt(0).toUpperCase() + entry.postedStatus.slice(1) : "—"}
                      {changedByName && <span className="font-normal text-text-secondary"> · By {changedByName}</span>}
                    </span>
                    <span className="shrink-0 text-caption text-text-secondary">{formatDetailDateTime(entry.changedAt)}</span>
                  </div>
                );
              })}
            </DetailSection>
          )}
        </div>

        <button
          type="button"
          onClick={onViewFullDetails}
          className="mt-[var(--space-md)] w-full rounded-pill bg-primary px-[var(--space-md)] py-[var(--space-sm)] text-center text-body-sm font-bold text-text-primary hover:opacity-90"
        >
          Open full page
        </button>
      </div>
    </div>
  );
}
