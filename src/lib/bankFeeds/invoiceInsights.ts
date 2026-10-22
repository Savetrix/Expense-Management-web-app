// SERVER-ONLY. What the invoice page shows beside a bill: the bank line that
// paid it ("Matching bank transaction found") and the period it covers
// ("Prepayment detected").
//
// The invoice itself is read from the backend with the caller's own token, so
// a user sees insights only for invoices the backend lets them see.
import { SAVETRIX_API_BASE_URL } from "./config";
import type { Db } from "./db";
import { findPeriod, isPrepaymentPeriod, type InvoicePeriod } from "./period";
import { toView, type BankTransactionView, type TxnRow } from "./transactions";

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

interface InsightRow {
  period_start: string | null;
  period_end: string | null;
  period_months: string | null;
  period_source: string | null;
  period_evidence: string | null;
  read_from: string | null;
  prepayment_dismissed_at: string | null;
}

/** The invoice's period, read once per version of the invoice and saved. */
export async function periodInsight(db: Db, qbConnectionId: string, invoice: BackendInvoice): Promise<PeriodInsight> {
  const version = invoice.updatedAt ?? "unknown";
  const [saved] = await db.query<InsightRow>("SELECT * FROM invoice_insights WHERE qb_connection_id = $1 AND invoice_id = $2", [qbConnectionId, invoice._id]);
  let period: InvoicePeriod | null;
  if (saved && saved.read_from === version) {
    period =
      saved.period_start && saved.period_end
        ? {
            start: saved.period_start,
            end: saved.period_end,
            months: Number(saved.period_months),
            source: (saved.period_source as InvoicePeriod["source"]) ?? "range",
            evidence: saved.period_evidence ?? "",
          }
        : null;
  } else {
    const d = invoice.extractedData ?? {};
    period = findPeriod([...(d.lineItems ?? []).map((l) => l.description), d.description, invoice.pipelineLog?.ocrText], {
      // US invoices write 10/01/2026 month-first; most others day-first.
      preferMonthFirst: (d.currency ?? "").toUpperCase() === "USD",
      invoiceDate: toIsoDate(d.invoiceDate),
    });
    await db.query(
      `INSERT INTO invoice_insights (qb_connection_id, invoice_id, period_start, period_end, period_months, period_source, period_evidence, read_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (qb_connection_id, invoice_id) DO UPDATE SET
         period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, period_months = EXCLUDED.period_months,
         period_source = EXCLUDED.period_source, period_evidence = EXCLUDED.period_evidence, read_from = EXCLUDED.read_from, updated_at = now()`,
      [qbConnectionId, invoice._id, period?.start ?? null, period?.end ?? null, period?.months ?? null, period?.source ?? null, period?.evidence ?? null, version],
    );
  }
  return { period, prepayment: isPrepaymentPeriod(period), dismissed: Boolean(saved?.prepayment_dismissed_at) };
}

export async function setPrepaymentDismissed(db: Db, qbConnectionId: string, invoiceId: string, userId: string, dismissed: boolean): Promise<void> {
  await db.query(
    `INSERT INTO invoice_insights (qb_connection_id, invoice_id, prepayment_dismissed_at, prepayment_dismissed_by)
     VALUES ($1, $2, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4 END)
     ON CONFLICT (qb_connection_id, invoice_id) DO UPDATE SET
       prepayment_dismissed_at = CASE WHEN $3 THEN now() END, prepayment_dismissed_by = CASE WHEN $3 THEN $4 END, updated_at = now()`,
    [qbConnectionId, invoiceId, dismissed, userId],
  );
}

export interface BankInsight {
  /** Bank lines already matched to this bill. */
  matched: BankTransactionView[];
  /** Lines still to review that look like this bill's payment. */
  candidates: BankTransactionView[];
}

/**
 * Candidate = money out for exactly the bill's total, dated from 3 days before
 * the invoice date to 14 days after its due date (or 45 days after the invoice
 * date when there is no due date). Closest date first.
 */
export async function bankInsight(db: Db, qbConnectionId: string, invoice: BackendInvoice): Promise<BankInsight> {
  const matchedRows = await db.query<TxnRow>(
    "SELECT * FROM bank_transactions WHERE qb_connection_id = $1 AND matched_invoice_id = $2 AND removed_at IS NULL ORDER BY date DESC",
    [qbConnectionId, invoice._id],
  );
  const d = invoice.extractedData ?? {};
  const total = typeof d.totalAmount === "number" ? d.totalAmount : null;
  const invoiceDate = toIsoDate(d.invoiceDate);
  if (matchedRows.length > 0 || total === null || total <= 0 || !invoiceDate) {
    return { matched: matchedRows.map(toView), candidates: [] };
  }
  const dueDate = toIsoDate(d.dueDate);
  const from = addDays(invoiceDate, -3);
  const to = dueDate ? addDays(dueDate, 14) : addDays(invoiceDate, 45);
  const rows = await db.query<TxnRow>(
    `SELECT * FROM bank_transactions
      WHERE qb_connection_id = $1 AND removed_at IS NULL AND status = 'review' AND matched_invoice_id IS NULL
        AND amount_cents = $2 AND date BETWEEN $3::date AND $4::date
      ORDER BY abs(date - $5::date), date
      LIMIT 5`,
    [qbConnectionId, -Math.round(total * 100), from, to, invoiceDate],
  );
  return { matched: [], candidates: rows.map(toView) };
}
