// SERVER-ONLY. Listing bank lines and recording what the user decided about
// each one, so every choice survives a refresh and is shared by the team.
//
// Decisions are optimistic-concurrency checked: the browser sends the row's
// `version`, and a stale write (another tab or teammate changed the line in the
// meantime) gets 409 with the current row instead of silently overwriting it.
import type { Db } from "./db";
import { logEvent } from "./store";

export type TxnStatus = "review" | "matched" | "excluded" | "transfer";
const STATUSES: TxnStatus[] = ["review", "matched", "excluded", "transfer"];

export interface TxnRow {
  id: string;
  qb_connection_id: string;
  account_id: string | null;
  account_label: string;
  source: "plaid" | "csv";
  date: string;
  description: string;
  merchant_name: string | null;
  counterparty_name: string | null;
  amount_cents: string;
  currency: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  category_confidence: string | null;
  payment_channel: string | null;
  status: TxnStatus;
  matched_invoice_id: string | null;
  transfer_account_id: string | null;
  transfer_label: string | null;
  gl_account_id: string | null;
  tax_code_id: string | null;
  vendor_id: string | null;
  payee: string | null;
  decided_by: string | null;
  decided_at: string | null;
  suggestion: unknown;
  posting_status: string | null;
  posting: unknown;
  version: number;
}

/** The browser's shape: components/v2/bankTransactions/types.ts BankTransaction, plus server fields. */
export interface BankTransactionView {
  id: string;
  date: string;
  description: string;
  accountName: string;
  accountId: string | null;
  amount: number;
  currency: string | null;
  status: TxnStatus;
  source: "csv" | "plaid";
  matchedInvoiceId?: string;
  transferAccount?: string;
  transferAccountId?: string;
  categoryId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  merchantName?: string;
  bankCategory?: string;
  suggestion?: unknown;
  postingStatus?: string;
  posting?: unknown;
  decidedAt?: string;
  version: number;
}

const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export function toView(r: TxnRow): BankTransactionView {
  return {
    id: r.id,
    date: dateOnly(r.date),
    description: r.description,
    accountName: r.account_label,
    accountId: r.account_id,
    amount: Number(r.amount_cents) / 100,
    currency: r.currency,
    status: r.status,
    source: r.source,
    matchedInvoiceId: r.matched_invoice_id ?? undefined,
    transferAccount: r.transfer_label ?? undefined,
    transferAccountId: r.transfer_account_id ?? undefined,
    categoryId: r.gl_account_id ?? undefined,
    taxCodeId: r.tax_code_id ?? undefined,
    vendorId: r.vendor_id ?? undefined,
    payee: r.payee ?? undefined,
    merchantName: r.merchant_name ?? r.counterparty_name ?? undefined,
    bankCategory: r.category_detailed ?? r.category_primary ?? undefined,
    suggestion: r.suggestion ?? undefined,
    postingStatus: r.posting_status ?? undefined,
    posting: r.posting ?? undefined,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : undefined,
    version: r.version,
  };
}

export interface ListFilter {
  status?: TxnStatus;
  accountId?: string;
  from?: string;
  to?: string;
  invoiceId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Plenty for a screen; the list filters and searches on the client. */
const LIST_LIMIT = 5000;

export async function listTransactions(db: Db, qbConnectionId: string, f: ListFilter = {}): Promise<BankTransactionView[]> {
  const where = ["qb_connection_id = $1", "removed_at IS NULL"];
  const params: unknown[] = [qbConnectionId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status && STATUSES.includes(f.status)) add("status = ?", f.status);
  if (f.accountId) add("account_id = ?::uuid", f.accountId);
  if (f.from && ISO_DATE.test(f.from)) add("date >= ?::date", f.from);
  if (f.to && ISO_DATE.test(f.to)) add("date <= ?::date", f.to);
  if (f.invoiceId) add("matched_invoice_id = ?", f.invoiceId);
  const rows = await db.query<TxnRow>(
    `SELECT * FROM bank_transactions WHERE ${where.join(" AND ")} ORDER BY date DESC, created_at DESC LIMIT ${LIST_LIMIT}`,
    params,
  );
  return rows.map(toView);
}

export async function getTransaction(db: Db, qbConnectionId: string, id: string): Promise<TxnRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.query<TxnRow>("SELECT * FROM bank_transactions WHERE id = $1 AND qb_connection_id = $2 AND removed_at IS NULL", [id, qbConnectionId]);
  return rows[0] ?? null;
}

/** What a user may change on a line. `undefined` = leave as is, `null` = clear. */
export interface DecisionPatch {
  status?: TxnStatus;
  matchedInvoiceId?: string | null;
  transferLabel?: string | null;
  transferAccountId?: string | null;
  glAccountId?: string | null;
  taxCodeId?: string | null;
  vendorId?: string | null;
  payee?: string | null;
}

const str = (v: unknown, max = 200): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
};

/** Reads a patch from a request body; unknown keys are ignored. Returns an error string when invalid. */
export function readPatch(body: Record<string, unknown>): DecisionPatch | string {
  const patch: DecisionPatch = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as TxnStatus)) return "Unknown status.";
    patch.status = body.status as TxnStatus;
  }
  patch.matchedInvoiceId = str(body.matchedInvoiceId, 64);
  patch.transferLabel = str(body.transferAccount);
  patch.transferAccountId = str(body.transferAccountId, 64);
  if (patch.transferAccountId && !/^[0-9a-f-]{36}$/i.test(patch.transferAccountId)) return "Unknown account.";
  patch.glAccountId = str(body.categoryId, 64);
  patch.taxCodeId = str(body.taxCodeId, 64);
  patch.vendorId = str(body.vendorId, 64);
  patch.payee = str(body.payee);
  return patch;
}

/**
 * The status rules, so a line can never end up half-decided:
 *   matched  → needs a bill; clears any transfer.
 *   transfer → needs the other account; clears any bill.
 *   excluded → clears bill and transfer (coding is kept, for Restore).
 *   review   → clears bill and transfer.
 */
export function normalise(current: TxnRow, patch: DecisionPatch): { next: DecisionPatch; error?: string } {
  const status = patch.status ?? current.status;
  const next: DecisionPatch = { ...patch };
  if (status === "matched") {
    const invoice = patch.matchedInvoiceId !== undefined ? patch.matchedInvoiceId : current.matched_invoice_id;
    if (!invoice) return { next, error: "Pick the bill this line paid." };
    next.transferLabel = null;
    next.transferAccountId = null;
  } else if (status === "transfer") {
    const label = patch.transferLabel !== undefined ? patch.transferLabel : current.transfer_label;
    if (!label) return { next, error: "Pick the other account." };
    next.matchedInvoiceId = null;
  } else if (patch.status) {
    next.matchedInvoiceId = null;
    next.transferLabel = null;
    next.transferAccountId = null;
  }
  return { next };
}

export type DecideResult = { ok: true; txn: BankTransactionView } | { ok: false; status: 404 | 409 | 400; error: string; current?: BankTransactionView };

const COLUMN: Record<keyof DecisionPatch, string> = {
  status: "status",
  matchedInvoiceId: "matched_invoice_id",
  transferLabel: "transfer_label",
  transferAccountId: "transfer_account_id",
  glAccountId: "gl_account_id",
  taxCodeId: "tax_code_id",
  vendorId: "vendor_id",
  payee: "payee",
};

export async function decide(
  db: Db,
  args: { qbConnectionId: string; id: string; userId: string; patch: DecisionPatch; expectedVersion?: number; action?: string },
): Promise<DecideResult> {
  const current = await getTransaction(db, args.qbConnectionId, args.id);
  if (!current) return { ok: false, status: 404, error: "That transaction isn't here any more." };
  if (args.expectedVersion !== undefined && args.expectedVersion !== current.version) {
    return { ok: false, status: 409, error: "Someone changed this line a moment ago. It has been refreshed.", current: toView(current) };
  }
  if (current.posting_status === "posted" || current.posting_status === "processing") {
    return { ok: false, status: 409, error: "This line is already in the accounting software. Undo it there first.", current: toView(current) };
  }
  const { next, error } = normalise(current, args.patch);
  if (error) return { ok: false, status: 400, error };
  if (next.transferAccountId) {
    const rows = await db.query("SELECT 1 FROM bank_accounts WHERE id = $1 AND qb_connection_id = $2", [next.transferAccountId, args.qbConnectionId]);
    if (rows.length === 0) return { ok: false, status: 400, error: "Unknown account." };
  }
  if (next.status === "matched" && next.matchedInvoiceId) {
    // One bank line per bill: a bill already matched to another line is not offered twice.
    const taken = await db.query(
      "SELECT 1 FROM bank_transactions WHERE qb_connection_id = $1 AND matched_invoice_id = $2 AND id <> $3 AND status = 'matched' AND removed_at IS NULL",
      [args.qbConnectionId, next.matchedInvoiceId, args.id],
    );
    if (taken.length > 0) return { ok: false, status: 409, error: "That bill is already matched to another bank line." };
  }

  const sets: string[] = [];
  const params: unknown[] = [args.id, args.qbConnectionId, current.version];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN) as [keyof DecisionPatch, string][]) {
    const value = next[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}${column === "transfer_account_id" ? "::uuid" : ""}`);
    before[key] = (current as unknown as Record<string, unknown>)[column] ?? null;
    after[key] = value;
  }
  if (sets.length === 0) return { ok: true, txn: toView(current) };
  params.push(args.userId);
  const rows = await db.query<TxnRow>(
    `UPDATE bank_transactions SET ${sets.join(", ")}, decided_by = $${params.length}, decided_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1 AND qb_connection_id = $2 AND version = $3 RETURNING *`,
    params,
  );
  if (rows.length === 0) {
    const fresh = await getTransaction(db, args.qbConnectionId, args.id);
    return { ok: false, status: 409, error: "Someone changed this line a moment ago. It has been refreshed.", current: fresh ? toView(fresh) : undefined };
  }
  await logEvent(db, { qbConnectionId: args.qbConnectionId, transactionId: args.id, actor: args.userId, action: args.action ?? "bank.decision", detail: { before, after } });
  return { ok: true, txn: toView(rows[0]) };
}

// ---------------------------------------------------------------- CSV import

export interface CsvRowIn {
  date: string;
  description: string;
  amount: number;
}

/** Same key as the browser's csv.ts dedupeKey: date | amount | description, case-folded, spaces collapsed. */
export function csvKey(r: CsvRowIn): string {
  return `${r.date}|${r.amount.toFixed(2)}|${r.description.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * Saves CSV rows. Re-importing the same file adds nothing; two identical lines
 * in one file (two coffees, same day, same price) are both kept, because each
 * gets an occurrence number in its key.
 */
export async function importCsv(db: Db, args: { qbConnectionId: string; userId: string; accountLabel: string; rows: CsvRowIn[] }): Promise<{ added: number; duplicates: number }> {
  const seen = new Map<string, number>();
  const keyed = args.rows.map((r) => {
    const base = csvKey(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, key: `${base}#${n}` };
  });
  if (keyed.length === 0) return { added: 0, duplicates: 0 };
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO bank_transactions (qb_connection_id, account_label, source, csv_dedupe_key, date, description, amount_cents)
     SELECT $1, $2, 'csv', v.k, v.d::date, v.descr, v.c
       FROM unnest($3::text[], $4::text[], $5::text[], $6::bigint[]) AS v(k, d, descr, c)
     ON CONFLICT (qb_connection_id, csv_dedupe_key) WHERE csv_dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      args.qbConnectionId,
      args.accountLabel.trim().slice(0, 200) || "Imported file",
      keyed.map((r) => r.key),
      keyed.map((r) => r.date),
      keyed.map((r) => r.description.slice(0, 500)),
      keyed.map((r) => Math.round(r.amount * 100)),
    ],
  );
  await logEvent(db, {
    qbConnectionId: args.qbConnectionId,
    actor: args.userId,
    action: "bank.csv_imported",
    detail: { accountLabel: args.accountLabel, rows: keyed.length, added: inserted.length },
  });
  return { added: inserted.length, duplicates: keyed.length - inserted.length };
}
