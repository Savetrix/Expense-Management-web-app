// SERVER-ONLY. What the invoice page shows beside a bill: the bank line that
// paid it ("Matching bank transaction found") and the period it covers
// ("Prepayment detected").
//
// The invoice itself is read from the backend with the caller's own token, so
// a user sees insights only for invoices the backend lets them see.
import { SAVETRIX_API_BASE_URL } from "./config";
import type { Db } from "./db";
import { findPeriod, isPrepaymentPeriod, type InvoicePeriod } from "./period";
import { toView, type BankTransactionView } from "./transactions";

interface BackendInvoice {
  _id: string;
  updatedAt?: string;
  extractedData?: {
    invoiceDate?: string | null;
    dueDate?: string | null;
    totalAmount?: number | null;
    currency?: string | null;
    description?: string | null;
    lineItems?: { description?: string | null }[];
  };
  pipelineLog?: { ocrText?: string | null };
}

export type InvoiceFetch = { ok: true; invoice: BackendInvoice } | { ok: false; status: 401 | 404 | 503 };

export async function fetchInvoice(accessToken: string, qbConnectionId: string, invoiceId: string): Promise<InvoiceFetch> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(invoiceId)) return { ok: false, status: 404 };
  let response: Response;
  try {
    response = await fetch(`${SAVETRIX_API_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "X-QB-Id": qbConnectionId, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 503 };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, status: 401 };
  if (response.status === 404) return { ok: false, status: 404 };
  if (!response.ok) return { ok: false, status: 503 };
  const body = (await response.json().catch(() => null)) as { data?: { invoice?: BackendInvoice } } | null;
  const invoice = body?.data?.invoice;
  return invoice?._id ? { ok: true, invoice } : { ok: false, status: 404 };
}

/** "2026-09-01", "2026-09-01T00:00:00Z", or anything Date.parse reads → YYYY-MM-DD. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (direct) return direct[1];
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface PeriodInsight {
  period: InvoicePeriod | null;
  prepayment: boolean;
  dismissed: boolean;
}

/** The invoice's period, read once per version of the invoice and saved. */
export async function periodInsight(db: Db, qbConnectionId: string, invoice: BackendInvoice): Promise<PeriodInsight> {
  const version = invoice.updatedAt ?? "unknown";
  const _id = `${qbConnectionId}:${invoice._id}`;
  const saved = await db.insights.findOne({ _id });
  let period: InvoicePeriod | null;
  if (saved && saved.readFrom === version) {
    period =
      saved.periodStart && saved.periodEnd
        ? {
            start: saved.periodStart,
            end: saved.periodEnd,
            months: Number(saved.periodMonths),
            source: (saved.periodSource as InvoicePeriod["source"]) ?? "range",
            evidence: saved.periodEvidence ?? "",
          }
        : null;
  } else {
    const d = invoice.extractedData ?? {};
    period = findPeriod([...(d.lineItems ?? []).map((l) => l.description), d.description, invoice.pipelineLog?.ocrText], {
      // US invoices write 10/01/2026 month-first; most others day-first.
      preferMonthFirst: (d.currency ?? "").toUpperCase() === "USD",
      invoiceDate: toIsoDate(d.invoiceDate),
    });
    await db.insights.updateOne(
      { _id },
      {
        $set: {
          qbConnectionId,
          invoiceId: invoice._id,
          periodStart: period?.start ?? null,
          periodEnd: period?.end ?? null,
          periodMonths: period?.months ?? null,
          periodSource: period?.source ?? null,
          periodEvidence: period?.evidence ?? null,
          readFrom: version,
          updatedAt: new Date(),
        },
        $setOnInsert: { prepaymentDismissedAt: null, prepaymentDismissedBy: null },
      },
      { upsert: true },
    );
  }
  return { period, prepayment: isPrepaymentPeriod(period), dismissed: Boolean(saved?.prepaymentDismissedAt) };
}

export async function setPrepaymentDismissed(db: Db, qbConnectionId: string, invoiceId: string, userId: string, dismissed: boolean): Promise<void> {
  await db.insights.updateOne(
    { _id: `${qbConnectionId}:${invoiceId}` },
    {
      $set: { qbConnectionId, invoiceId, prepaymentDismissedAt: dismissed ? new Date() : null, prepaymentDismissedBy: dismissed ? userId : null, updatedAt: new Date() },
      $setOnInsert: { periodStart: null, periodEnd: null, periodMonths: null, periodSource: null, periodEvidence: null, readFrom: null },
    },
    { upsert: true },
  );
}

export interface BankInsight {
  /** Bank lines already matched to this bill. */
  matched: BankTransactionView[];
  /** Lines still to review that look like this bill's payment. */
  candidates: BankTransactionView[];
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Candidate = money out for exactly the bill's total, dated from 3 days before
 * the invoice date to 14 days after its due date (or 45 days after the invoice
 * date when there is no due date). Closest date first.
 */
export async function bankInsight(db: Db, qbConnectionId: string, invoice: BackendInvoice): Promise<BankInsight> {
  const matched = await db.txns.find({ qbConnectionId, matchedInvoiceId: invoice._id, removedAt: null }).sort({ date: -1 }).toArray();
  const d = invoice.extractedData ?? {};
  const total = typeof d.totalAmount === "number" ? d.totalAmount : null;
  const invoiceDate = toIsoDate(d.invoiceDate);
  if (matched.length > 0 || total === null || total <= 0 || !invoiceDate) {
    return { matched: matched.map(toView), candidates: [] };
  }
  const dueDate = toIsoDate(d.dueDate);
  const from = addDays(invoiceDate, -3);
  const to = dueDate ? addDays(dueDate, 14) : addDays(invoiceDate, 45);
  const rows = await db.txns
    .find({ qbConnectionId, removedAt: null, status: "review", matchedInvoiceId: null, amountCents: -Math.round(total * 100), date: { $gte: from, $lte: to } })
    .limit(50)
    .toArray();
  const target = dayNumber(invoiceDate);
  rows.sort((a, b) => Math.abs(dayNumber(a.date) - target) - Math.abs(dayNumber(b.date) - target) || a.date.localeCompare(b.date));
  return { matched: [], candidates: rows.slice(0, 5).map(toView) };
}
