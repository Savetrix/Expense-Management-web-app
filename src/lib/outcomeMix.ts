// Auto/manual/failed split per week — no backend endpoint for this exists,
// so it's derived client-side the same way DashboardContent's "Weekly
// scans" chart already is: rolling 7-day windows ending now (bucketed by
// createdAt, i.e. when the invoice was scanned), not calendar weeks, so
// "this week" always means "the last 7 days" regardless of what day it is.
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

// A "failed" invoice a person rejected on purpose — not a scan or post that
// went wrong. Rejections from before the backend stamped rejectedAt only
// carry the default reason in their history.
export function isRejectedInvoice(invoice: InvoiceRecord): boolean {
  if (invoice.postedStatus !== "failed") return false;
  if (invoice.rejectedAt) return true;
  const last = invoice.statusHistory?.[invoice.statusHistory.length - 1];
  return last?.reason === "Rejected by user";
}

export interface OutcomeMixBucket {
  auto: number;
  manual: number;
  failed: number;
  rejected: number;
  total: number;
}

export interface OutcomeMixResult {
  buckets: OutcomeMixBucket[];
  totals: OutcomeMixBucket;
  max: number;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function computeOutcomeMix(invoices: InvoiceRecord[], weeks: number): OutcomeMixResult {
  const now = Date.now();
  const buckets: OutcomeMixBucket[] = Array.from({ length: weeks }, () => ({
    auto: 0,
    manual: 0,
    failed: 0,
    rejected: 0,
    total: 0,
  }));

  for (const invoice of invoices) {
    if (!invoice.createdAt) continue;
    const scannedAt = new Date(invoice.createdAt).getTime();
    if (Number.isNaN(scannedAt)) continue;

    const age = now - scannedAt;
    if (age < 0 || age >= weeks * MS_PER_WEEK) continue;

    // Pending/other statuses aren't part of this mix — the invoices page
    // this feeds only ever shows auto/manual/failed anyway.
    if (invoice.postedStatus !== "auto" && invoice.postedStatus !== "manual" && invoice.postedStatus !== "failed") {
      continue;
    }

    const bucketFromNewest = Math.floor(age / MS_PER_WEEK);
    const bucket = buckets[weeks - 1 - bucketFromNewest];
    bucket[isRejectedInvoice(invoice) ? "rejected" : invoice.postedStatus] += 1;
    bucket.total += 1;
  }

  const totals = buckets.reduce<OutcomeMixBucket>(
    (acc, bucket) => ({
      auto: acc.auto + bucket.auto,
      manual: acc.manual + bucket.manual,
      failed: acc.failed + bucket.failed,
      rejected: acc.rejected + bucket.rejected,
      total: acc.total + bucket.total,
    }),
    { auto: 0, manual: 0, failed: 0, rejected: 0, total: 0 },
  );

  return {
    buckets,
    totals,
    max: Math.max(...buckets.map((bucket) => bucket.total), 1),
  };
}
