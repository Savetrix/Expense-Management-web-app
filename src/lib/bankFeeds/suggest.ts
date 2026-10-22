// SERVER-ONLY. Suggesting the vendor, GL account and tax code for each bank
// line from the company's own past decisions, and coding a line by itself when
// the Autopilot checks pass.
//
// The Autopilot screen (components/v2/autopilot/OverviewPanel.tsx) states the
// rules for documents; these are the same rules applied to bank lines:
//   1. Legibility — the line is clean data: posted, a real date not in the
//      future, a non-zero amount, a description.
//   2. Completeness — one full destination: a payee and a GL account (and the
//      tax code, whenever past lines for this payee had one).
//   3. Historical consistency — "at least 3 similar past postings agree …
//      recent postings count for more than old ones": weighted votes from the
//      user's own decisions on lines with the same payee. Weight 1.0 if decided
//      within 90 days, 0.5 within a year, 0 older. Pass when the agreeing weight
//      is ≥ 3.0 AND ≥ 90% of all weight for that payee.
// When all three pass, Scantrix fills in the coding itself (decided_by =
// "autopilot") and says so on the line; the user can change it. It never
// changes a line's status (exclude, transfer, match) by itself, and never posts.
import type { Db } from "./db";

// ---------------------------------------------------------------- payee key

const NOISE = new Set([
  "pos", "debit", "credit", "card", "purchase", "ach", "web", "online", "payment", "pmt", "recurring", "checkcard",
  "visa", "mastercard", "mc", "inc", "llc", "ltd", "co", "the", "www", "com", "help", "trip", "sq", "tst", "paypal",
  "ppd", "id", "ref", "des", "indn", "ccd", "txn", "transaction", "withdrawal", "deposit", "transfer", "xfer", "to", "from",
]);

/**
 * Who a line was paid to, reduced to a stable key: "UBER *TRIP HELP.UBER.COM"
 * and "Uber 063015 SF**POOL**" both become "uber". Plaid's cleaned-up merchant
 * name wins when there is one; otherwise digits, card masks, punctuation and
 * banking filler words are removed from the description.
 */
export function payeeKey(merchantName: string | null | undefined, description: string): string {
  const source = merchantName?.trim() ? merchantName : description;
  const words = source
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
  // "UBER … HELP.UBER.COM" names the payee twice.
  return [...new Set(words)].slice(0, 3).join(" ");
}

// ---------------------------------------------------------------- scoring

export type SuggestionKind = "expense" | "transfer" | "exclude" | "bill";

export interface Vote {
  kind: SuggestionKind;
  glAccountId: string | null;
  taxCodeId: string | null;
  vendorId: string | null;
  payee: string | null;
  transferLabel: string | null;
  decidedAt: string;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface Suggestion {
  kind: SuggestionKind | null;
  glAccountId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  transferLabel?: string;
  confidence: "high" | "medium" | "low";
  /** One plain sentence for the line. */
  reason: string;
  checks: { legibility: CheckResult; completeness: CheckResult; history: CheckResult };
  /** Scantrix filled the coding in itself (all three checks passed). */
  autoCoded: boolean;
  /** Weighted votes behind the suggestion, and how many past lines. */
  basis: { agreeing: number; total: number; lines: number };
  scoredAt: string;
}

const DAY = 86_400_000;
export const MIN_AGREEING_WEIGHT = 3.0;
export const MIN_AGREEMENT = 0.9;

export function voteWeight(decidedAt: string, now = Date.now()): number {
  const age = (now - new Date(decidedAt).getTime()) / DAY;
  if (age <= 90) return 1;
  if (age <= 365) return 0.5;
  return 0;
}

const groupKey = (v: Vote) =>
  v.kind === "expense" ? `expense|${v.glAccountId}|${v.taxCodeId ?? ""}|${v.vendorId ?? ""}` : v.kind === "transfer" ? `transfer|${v.transferLabel ?? ""}` : v.kind;

export interface LineFacts {
  date: string;
  amountCents: number;
  description: string;
  pending?: boolean;
  payeeLabel: string;
}

export function legibility(line: LineFacts, today = new Date().toISOString().slice(0, 10)): CheckResult {
  if (line.pending) return { ok: false, detail: "This line is still pending at the bank." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date) || line.date > today) return { ok: false, detail: "The date isn't a real past date." };
  if (!Number.isFinite(line.amountCents) || line.amountCents === 0) return { ok: false, detail: "The amount is zero." };
  if (!line.description.trim()) return { ok: false, detail: "The bank gave no description." };
  return { ok: true, detail: "Posted at the bank with a date, an amount and a description." };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Scores one line against the votes of past lines with the same payee. */
export function score(line: LineFacts, votes: Vote[], now = Date.now()): Suggestion {
  const scoredAt = new Date(now).toISOString();
  const leg = legibility(line, new Date(now).toISOString().slice(0, 10));
  const weighted = votes.map((v) => ({ v, w: voteWeight(v.decidedAt, now) })).filter((x) => x.w > 0);
  const total = weighted.reduce((s, x) => s + x.w, 0);

  const groups = new Map<string, { vote: Vote; weight: number; lines: number }>();
  for (const { v, w } of weighted) {
    const k = groupKey(v);
    const g = groups.get(k) ?? { vote: v, weight: 0, lines: 0 };
    g.weight += w;
    g.lines += 1;
    // Keep the most recent vote as the representative (latest payee spelling).
    if (v.decidedAt > g.vote.decidedAt) g.vote = v;
    groups.set(k, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const empty: Suggestion = {
    kind: null,
    confidence: "low",
    reason: `New payee — no earlier decisions for ${line.payeeLabel} to learn from.`,
    checks: {
      legibility: leg,
      completeness: { ok: false, detail: "No vendor or GL account yet." },
      history: { ok: false, detail: "No earlier lines for this payee." },
    },
    autoCoded: false,
    basis: { agreeing: 0, total: 0, lines: 0 },
    scoredAt,
  };
  if (!top) return empty;

  const agreement = total > 0 ? top.weight / total : 0;
  const historyOk = top.weight >= MIN_AGREEING_WEIGHT && agreement >= MIN_AGREEMENT;
  const others = ranked.slice(1, 3).map((g) => `${describe(g.vote)} ${g.lines}×`);
  const historyDetail = historyOk
    ? `${plural(top.lines, "earlier line")} for this payee were coded the same way.`
    : top.weight < MIN_AGREEING_WEIGHT
      ? `Only ${fmt(top.weight)} recent agreeing ${top.weight === 1 ? "decision" : "decisions"} — at least 3 are needed.`
      : `Earlier lines for this payee were coded differently (${[`${describe(top.vote)} ${top.lines}×`, ...others].join(", ")}).`;

  const v = top.vote;
  const anyTax = weighted.some((x) => x.v.taxCodeId);
  const completeness: CheckResult =
    v.kind !== "expense"
      ? { ok: true, detail: v.kind === "transfer" ? "A transfer between your own accounts." : v.kind === "exclude" ? "Earlier lines like this were excluded." : "Earlier lines like this paid a bill." }
      : !v.glAccountId
        ? { ok: false, detail: "No GL account to suggest." }
        : !v.vendorId && !v.payee
          ? { ok: false, detail: "No vendor to suggest." }
          : anyTax && !v.taxCodeId
            ? { ok: false, detail: "Earlier lines for this payee had a tax code, the latest did not." }
            : { ok: true, detail: "Vendor and GL account are known" + (v.taxCodeId ? ", and the tax code." : ".") };

  const confidence = historyOk && leg.ok && completeness.ok ? "high" : agreement >= 0.6 ? "medium" : "low";
  const autoCoded = confidence === "high" && v.kind === "expense";
  const reason = autoCoded
    ? `Coded by Scantrix — ${historyDetail.charAt(0).toLowerCase()}${historyDetail.slice(1)}`
    : !leg.ok
      ? leg.detail
      : !historyOk
        ? historyDetail
        : completeness.detail;

  return {
    kind: v.kind,
    glAccountId: v.glAccountId ?? undefined,
    taxCodeId: v.taxCodeId ?? undefined,
    vendorId: v.vendorId ?? undefined,
    payee: v.payee ?? undefined,
    transferLabel: v.transferLabel ?? undefined,
    confidence,
    reason,
    checks: { legibility: leg, completeness, history: { ok: historyOk, detail: historyDetail } },
    autoCoded,
    basis: { agreeing: top.weight, total, lines: weighted.length },
    scoredAt,
  };
}

function describe(v: Vote): string {
  if (v.kind === "transfer") return "transfer";
  if (v.kind === "exclude") return "excluded";
  if (v.kind === "bill") return "bill payment";
  return v.payee ? `${v.payee}` : "expense";
}

// ---------------------------------------------------------------- persistence

interface CandidateRow {
  id: string;
  date: string;
  amount_cents: string;
  description: string;
  merchant_name: string | null;
  counterparty_name: string | null;
  payee_key: string | null;
  decided_by: string | null;
  status: string;
  gl_account_id: string | null;
}

interface VoteRow {
  payee_key: string;
  status: string;
  gl_account_id: string | null;
  tax_code_id: string | null;
  vendor_id: string | null;
  payee: string | null;
  transfer_label: string | null;
  decided_at: string;
}

function toVote(r: VoteRow): Vote | null {
  const kind: SuggestionKind | null =
    r.status === "transfer" ? "transfer" : r.status === "excluded" ? "exclude" : r.status === "matched" ? "bill" : r.gl_account_id ? "expense" : null;
  if (!kind) return null;
  return { kind, glAccountId: r.gl_account_id, taxCodeId: r.tax_code_id, vendorId: r.vendor_id, payee: r.payee, transferLabel: r.transfer_label, decidedAt: new Date(r.decided_at).toISOString() };
}

/**
 * Re-scores every undecided line of a company (or only those with the given
 * payee keys) and codes the ones that pass all three checks. Called after a
 * sync, a CSV import, and any decision the user makes. Returns how many lines
 * Scantrix coded by itself in this pass.
 */
export async function refreshSuggestions(db: Db, qbConnectionId: string, onlyKeys?: string[]): Promise<{ scored: number; autoCoded: number }> {
  // 1. Give every line its payee key (new lines from sync/import have none yet).
  const unkeyed = await db.query<CandidateRow>(
    "SELECT id, description, merchant_name, counterparty_name FROM bank_transactions WHERE qb_connection_id = $1 AND payee_key IS NULL AND removed_at IS NULL",
    [qbConnectionId],
  );
  if (unkeyed.length > 0) {
    await db.query(
      `UPDATE bank_transactions t SET payee_key = v.k FROM unnest($2::uuid[], $3::text[]) AS v(id, k) WHERE t.id = v.id AND t.qb_connection_id = $1`,
      [qbConnectionId, unkeyed.map((r) => r.id), unkeyed.map((r) => payeeKey(r.merchant_name ?? r.counterparty_name, r.description))],
    );
  }

  // 2. Votes: the USER's own decisions. Lines Scantrix coded by itself do not
  //    vote, or one early guess would keep confirming itself.
  const voteRows = await db.query<VoteRow>(
    `SELECT payee_key, status, gl_account_id, tax_code_id, vendor_id, payee, transfer_label, decided_at
       FROM bank_transactions
      WHERE qb_connection_id = $1 AND removed_at IS NULL AND decided_at IS NOT NULL
        AND decided_by IS NOT NULL AND decided_by <> 'autopilot' AND payee_key IS NOT NULL AND payee_key <> ''
        AND decided_at > now() - interval '365 days'
        ${onlyKeys ? "AND payee_key = ANY($2::text[])" : ""}`,
    onlyKeys ? [qbConnectionId, onlyKeys] : [qbConnectionId],
  );
  const votesByKey = new Map<string, Vote[]>();
  for (const r of voteRows) {
    const v = toVote(r);
    if (!v) continue;
    const list = votesByKey.get(r.payee_key) ?? [];
    list.push(v);
    votesByKey.set(r.payee_key, list);
  }

  // 3. Candidates: lines still to review that the user has not coded.
  const candidates = await db.query<CandidateRow>(
    `SELECT id, date, amount_cents, description, merchant_name, counterparty_name, payee_key, decided_by, status, gl_account_id
       FROM bank_transactions
      WHERE qb_connection_id = $1 AND removed_at IS NULL AND status = 'review'
        AND (decided_by IS NULL OR decided_by = 'autopilot') AND posting_status IS NULL
        ${onlyKeys ? "AND payee_key = ANY($2::text[])" : ""}`,
    onlyKeys ? [qbConnectionId, onlyKeys] : [qbConnectionId],
  );

  let autoCoded = 0;
  const now = Date.now();
  for (const c of candidates) {
    const key = c.payee_key ?? "";
    const label = (c.merchant_name ?? c.counterparty_name ?? c.description).trim() || "this payee";
    const s = score({ date: String(c.date).slice(0, 10), amountCents: Number(c.amount_cents), description: c.description, payeeLabel: label }, key ? (votesByKey.get(key) ?? []) : [], now);
    if (s.autoCoded) {
      autoCoded += 1;
      await db.query(
        `UPDATE bank_transactions SET suggestion = $2, gl_account_id = $3, tax_code_id = $4, vendor_id = $5, payee = $6,
                decided_by = 'autopilot', decided_at = now(), version = version + 1, updated_at = now()
          WHERE id = $1 AND (decided_by IS NULL OR decided_by = 'autopilot') AND status = 'review'`,
        [c.id, JSON.stringify(s), s.glAccountId ?? null, s.taxCodeId ?? null, s.vendorId ?? null, s.payee ?? null],
      );
    } else if (c.decided_by === "autopilot") {
      // History no longer supports the coding Scantrix chose: undo it, keep the explanation.
      await db.query(
        `UPDATE bank_transactions SET suggestion = $2, gl_account_id = NULL, tax_code_id = NULL, vendor_id = NULL, payee = NULL,
                decided_by = NULL, decided_at = NULL, version = version + 1, updated_at = now()
          WHERE id = $1 AND decided_by = 'autopilot' AND status = 'review'`,
        [c.id, JSON.stringify(s)],
      );
    } else {
      await db.query("UPDATE bank_transactions SET suggestion = $2, updated_at = now() WHERE id = $1 AND decided_by IS NULL", [c.id, JSON.stringify(s)]);
    }
  }
  return { scored: candidates.length, autoCoded };
}

export async function payeeKeyOf(db: Db, qbConnectionId: string, id: string): Promise<string | null> {
  const [row] = await db.query<{ payee_key: string | null; description: string; merchant_name: string | null; counterparty_name: string | null }>(
    "SELECT payee_key, description, merchant_name, counterparty_name FROM bank_transactions WHERE id = $1 AND qb_connection_id = $2",
    [id, qbConnectionId],
  );
  if (!row) return null;
  return row.payee_key ?? payeeKey(row.merchant_name ?? row.counterparty_name, row.description);
}
