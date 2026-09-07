"use client";

import Link from "next/link";
import { Ban, Pencil, RotateCcw } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/Badge";
import { formatInvoiceDate, getInvoiceAmount, getInvoiceStatus, INVOICE_STATUS_THEME } from "@/lib/invoiceDisplay";
import { taxCodeId as getTaxCodeId } from "@/lib/quickbooks/taxCode";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";
import { Avatar } from "@/components/v2/ui";

const RECENT_INVOICES_LIMIT = 5;

// Mirrors InvoiceListContentV2's local status→Badge-variant mapping — kept
// per-screen rather than shared, same as that file does.
const STATUS_BADGE_VARIANT: Record<ReturnType<typeof getInvoiceStatus>, "success" | "warning" | "error"> = {
  auto: "success",
  manual: "warning",
  pending: "warning",
  processing: "warning",
  failed: "error",
};

function vendorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function invoiceSortDate(invoice: InvoiceRecord): number {
  const dateStr = invoice.extractedData?.invoiceDate || invoice.createdAt;
  const time = dateStr ? new Date(dateStr).getTime() : NaN;
  return Number.isNaN(time) ? 0 : time;
}

interface VendorDetailV2Props {
  vendor: Vendor;
  glAccounts: GLAccount[];
  taxCodes: TaxCode[];
  invoices: InvoiceRecord[];
  canManage: boolean;
  isInactive: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  deactivating: boolean;
  reactivating: boolean;
}

export function VendorDetailV2({
  vendor,
  glAccounts,
  taxCodes,
  invoices,
  canManage,
  isInactive,
  onEdit,
  onDeactivate,
  onReactivate,
  deactivating,
  reactivating,
}: VendorDetailV2Props) {
  const glName = glAccounts.find((a) => a.qbAccountId === vendor.glAccountId)?.name;
  const taxName = taxCodes.find((t) => getTaxCodeId(t) === vendor.taxCodeId)?.name;

  const vendorInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.vendor?.vendorDbId === vendor._id)
        .sort((a, b) => invoiceSortDate(b) - invoiceSortDate(a)),
    [invoices, vendor._id],
  );

  const recentInvoices = vendorInvoices.slice(0, RECENT_INVOICES_LIMIT);

  return (
    <div className="flex flex-col gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
      <div className="flex items-start gap-[var(--space-sm)]">
        <Avatar
          name={vendor.displayName}
          initials={vendorInitials(vendor.displayName) || "?"}
          size="lg"
          toneClassName="bg-nav-bg text-white"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-content-primary">{vendor.displayName}</p>
          {(vendor.email || vendor.phone) && (
            <p className="truncate text-caption text-content-secondary">
              {[vendor.email, vendor.phone].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {vendor.currency && <Badge variant="neutral">{vendor.currency}</Badge>}
      </div>

      <div className="flex flex-col gap-[var(--space-xs)] rounded-md bg-page p-[var(--space-sm)]">
        <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Default coding</p>
        <div className="flex flex-wrap gap-[var(--space-xs)]">
          {glName ? <Badge variant="neutral">GL: {glName}</Badge> : <Badge variant="warning">No GL account set</Badge>}
          {taxName ? <Badge variant="neutral">Tax: {taxName}</Badge> : <Badge variant="warning">No tax code set</Badge>}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-[var(--space-sm)]">
          {isInactive ? (
            <button
              type="button"
              onClick={onReactivate}
              disabled={reactivating}
              className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md bg-accent/10 text-caption font-bold text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw size={14} strokeWidth={2.25} />
              {reactivating ? "Reactivating…" : "Reactivate"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md border border-border text-caption font-bold text-content-primary hover:bg-surface-alt"
              >
                <Pencil size={14} strokeWidth={2.25} />
                Edit
              </button>
              <button
                type="button"
                onClick={onDeactivate}
                disabled={deactivating}
                className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md bg-status-danger-bg text-caption font-bold text-status-danger-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Ban size={14} strokeWidth={2.25} />
                {deactivating ? "Deactivating…" : "Deactivate"}
              </button>
            </>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Scanned invoices</p>
          <p className="text-caption font-semibold text-content-secondary">{vendorInvoices.length}</p>
        </div>

        {recentInvoices.length === 0 ? (
          <p className="mt-[var(--space-sm)] text-body-sm text-content-secondary">No invoices scanned for this vendor yet.</p>
        ) : (
          <div className="mt-[var(--space-sm)] flex flex-col divide-y divide-border">
            {recentInvoices.map((invoice) => {
              const status = getInvoiceStatus(invoice.postedStatus);
              return (
                <Link
                  key={invoice._id}
                  href={`/invoices/${invoice._id}`}
                  className="flex items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)] hover:bg-surface-alt"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-content-primary">
                      {invoice.extractedData?.invoiceNumber || "Invoice"}
                    </p>
                    <p className="text-caption text-content-secondary">{formatInvoiceDate(invoice.extractedData?.invoiceDate)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-[var(--space-xs)]">
                    <p className="text-body-sm font-semibold text-content-primary">{getInvoiceAmount(invoice)}</p>
                    <Badge variant={STATUS_BADGE_VARIANT[status]}>{INVOICE_STATUS_THEME[status].label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
