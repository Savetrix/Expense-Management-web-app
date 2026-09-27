"use client";

import Link from "next/link";
import { Ban, Pencil, RotateCcw } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatInvoiceDate, getInvoiceAmount, getInvoiceStatus, INVOICE_STATUS_THEME } from "@/lib/invoiceDisplay";
import { taxCodeId as getTaxCodeId } from "@/lib/quickbooks/taxCode";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";

const RECENT_INVOICES_LIMIT = 5;

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

interface VendorDetailPanelProps {
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

export function VendorDetailPanel({
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
}: VendorDetailPanelProps) {
  const glName = glAccounts.find((a) => a.qbAccountId === vendor.glAccountId)?.name;
  const taxName = taxCodes.find((t) => getTaxCodeId(t) === vendor.taxCodeId)?.name;

  const vendorInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.vendor?.vendorDbId === vendor._id).sort((a, b) => invoiceSortDate(b) - invoiceSortDate(a)),
    [invoices, vendor._id],
  );

  const recentInvoices = vendorInvoices.slice(0, RECENT_INVOICES_LIMIT);

  return (
    <Card className="flex flex-col gap-[var(--space-md)]">
      <div className="flex items-start gap-[var(--space-sm)]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-trust-navy text-body-sm font-bold text-white">
          {vendorInitials(vendor.displayName) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-text-primary">{vendor.displayName}</p>
          {(vendor.email || vendor.phone) && (
            <p className="truncate text-caption text-text-secondary">
              {[vendor.email, vendor.phone].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {vendor.currency && <Badge variant="neutral">{vendor.currency}</Badge>}
      </div>

      <div className="flex flex-col gap-[var(--space-xs)] rounded-md bg-background-alt p-[var(--space-sm)]">
        <p className="text-caption font-bold uppercase tracking-wide text-text-secondary">Default coding</p>
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
              className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md bg-primary/10 text-caption font-bold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw size={14} strokeWidth={2.25} />
              {reactivating ? "Reactivating…" : "Reactivate"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md border border-border text-caption font-bold text-trust-navy hover:bg-background-alt"
              >
                <Pencil size={14} strokeWidth={2.25} />
                Edit
              </button>
              <button
                type="button"
                onClick={onDeactivate}
                disabled={deactivating}
                className="flex h-10 flex-1 items-center justify-center gap-[var(--space-xs)] rounded-md bg-error/10 text-caption font-bold text-error disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="text-caption font-bold uppercase tracking-wide text-text-secondary">Scanned invoices</p>
          <p className="text-caption font-semibold text-text-secondary">{vendorInvoices.length}</p>
        </div>

        {recentInvoices.length === 0 ? (
          <p className="mt-[var(--space-sm)] text-body-sm text-text-secondary">No invoices scanned for this vendor yet.</p>
        ) : (
          <div className="mt-[var(--space-sm)] flex flex-col divide-y divide-border">
            {recentInvoices.map((invoice) => {
              const theme = INVOICE_STATUS_THEME[getInvoiceStatus(invoice.postedStatus)];
              return (
                <Link
                  key={invoice._id}
                  href={`/invoices/${invoice._id}`}
                  className="flex items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)] hover:bg-background-alt"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-text-primary">
                      {invoice.extractedData?.invoiceNumber || "Invoice"}
                    </p>
                    <p className="text-caption text-text-secondary">{formatInvoiceDate(invoice.extractedData?.invoiceDate)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-[var(--space-xs)]">
                    <p className="text-body-sm font-semibold text-text-primary">{getInvoiceAmount(invoice)}</p>
                    <span className={`rounded-pill px-[var(--space-sm)] py-[2px] text-[11px] font-semibold ${theme.badgeClass}`}>
                      {theme.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
