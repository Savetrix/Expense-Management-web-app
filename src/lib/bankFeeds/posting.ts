// SERVER-ONLY. "Send to QuickBooks/Xero": turns decided bank lines into
// entries in the accounting software, each exactly once.
//
//   ready    → expense (money out) or deposit (money in), with its vendor, GL and tax
//   matched  → payment of the bill, which must already be in QuickBooks/Xero
//   transfer → transfer between the two mapped accounts; the other side's
//              bank line is marked as posted by the same entry
//
// Exactly once: a line is claimed (postingStatus "processing") before the
// call, so two clicks or two tabs can't send it twice. Each call carries an
// idempotency key stored on the line. After a definite refusal (nothing was
// created) the next attempt gets a new key; after an unclear failure
// (timeout, 5xx) the key is kept, so QuickBooks/Xero answer a retry with the
// entry they already made instead of making a second one.
import type { Db } from "./db";
import { ledgerAccountFor } from "./ledgerMappings";
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type Posting } from "./ledger/types";
import type { PostingRecord, TxnDoc } from "./schema";
import { logEvent } from "./store";
import { toView, type BankTransactionView } from "./transactions";

export interface PostingServices {
  ledger: LedgerContext;
  adapter: LedgerAdapter;
  /** Scantrix vendor id → QuickBooks/Xero vendor id. */
  vendorIds(): Promise<Map<string, string>>;
  /** Tax code id → rate in percent. */
  taxRates(): Promise<Map<string, number>>;
  /** The matched bill as it is in QuickBooks/Xero, or null when it isn't posted there yet. */
  bill(invoiceId: string): Promise<{ billId: string; vendorId: string } | null>;
  /** A fresh access token after QuickBooks/Xero refused the current one. */
  renewLedger?(): Promise<LedgerContext>;
}

export interface PostOutcome {
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
  transaction?: BankTransactionView;
}

export const MAX_POST_BATCH = 100;
/** A "processing" claim older than this is from a crashed run and may be taken over (same key). */
const STALE_CLAIM_MS = 10 * 60_000;
const POSTABLE: TxnDoc["status"][] = ["ready", "matched", "transfer"];
/** These stop the whole batch: every other line would fail the same way. */
const BATCH_STOPPERS = new Set(["reconnect", "scope", "permission", "not_configured", "rate_limit"]);
const DAY_MS = 86_400_000;

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

class LineRefused extends Error {}

async function buildPosting(db: Db, svc: PostingServices, chart: Map<string, LedgerAccount>, txn: TxnDoc): Promise<Posting> {
  const name = svc.ledger.provider === "xero" ? "Xero" : "QuickBooks";
  const amount = Math.abs(txn.amountCents) / 100;
  if (amount === 0) throw new LineRefused("A line of 0.00 can't be sent.");
  const memo = txn.description || txn.merchantName || "Bank line";

  const bank = await ledgerAccountFor(db, txn.qbConnectionId, { accountId: txn.accountId, label: txn.accountLabel });
  if (!bank) throw new LineRefused(`Choose which bank account in ${name} "${txn.accountLabel}" posts to (Connected accounts).`);
  const bankAcct = chart.get(bank.id);
  if (!bankAcct || (bankAcct.kind !== "bank" && bankAcct.kind !== "card")) {
    throw new LineRefused(`"${bank.name}" isn't a bank or card account in ${name} any more. Map "${txn.accountLabel}" again.`);
  }
  const bankAccount = { id: bank.id, isCard: bankAcct.kind === "card" };

  if (txn.status === "transfer") {
    const other = await ledgerAccountFor(db, txn.qbConnectionId, { accountId: txn.transferAccountId, label: txn.transferLabel });
    if (!other) throw new LineRefused(`Choose which account in ${name} "${txn.transferLabel ?? "the other account"}" is (Connected accounts).`);
    if (other.id === bank.id) throw new LineRefused("Both sides of this transfer map to the same account.");
    return txn.amountCents < 0
      ? { kind: "transfer", date: txn.date, amount, memo, fromAccountId: bank.id, toAccountId: other.id }
      : { kind: "transfer", date: txn.date, amount, memo, fromAccountId: other.id, toAccountId: bank.id };
  }

  if (txn.status === "matched") {
    if (txn.amountCents > 0) throw new LineRefused("Money coming in can't pay a bill. Undo the match.");
    if (!txn.matchedInvoiceId) throw new LineRefused("Pick the bill this line paid.");
    const bill = await svc.bill(txn.matchedInvoiceId);
    if (!bill) throw new LineRefused(`The matched bill isn't in ${name} yet. Post the bill first, then send this payment.`);
    return { kind: "billPayment", date: txn.date, amount, memo, bankAccount, vendorId: bill.vendorId, billId: bill.billId };
  }

  // ready
  if (!txn.glAccountId) throw new LineRefused("Pick a GL account first.");
  let vendorId: string | null = null;
  if (txn.vendorId) {
    vendorId = (await svc.vendorIds()).get(txn.vendorId) ?? null;
    if (!vendorId) throw new LineRefused(`This line's vendor isn't in ${name} any more. Pick the vendor again.`);
  }
  const taxRate = txn.taxCodeId ? ((await svc.taxRates()).get(txn.taxCodeId) ?? null) : null;
  const base = { date: txn.date, amount, memo, bankAccount, vendorId, glAccountId: txn.glAccountId, taxCodeId: txn.taxCodeId, taxRate };
  return txn.amountCents < 0 ? { kind: "expense", ...base } : { kind: "deposit", ...base };
}

/** The other side of a transfer: same amount the other way, a few days apart, pointing back at this account. */
function counterpartFilter(txn: TxnDoc) {
  return {
    qbConnectionId: txn.qbConnectionId,
    removedAt: null,
    status: "transfer" as const,
    _id: { $ne: txn._id },
    amountCents: -txn.amountCents,
    $or: [{ transferLabel: txn.accountLabel }, ...(txn.transferLabel ? [{ accountLabel: txn.transferLabel }] : []), ...(txn.accountId ? [{ transferAccountId: txn.accountId }] : [])],
  };
}

async function findCounterpart(db: Db, txn: TxnDoc, posted: boolean): Promise<TxnDoc | null> {
  const rows = await db.txns
    .find({ ...counterpartFilter(txn), ...(posted ? { postingStatus: "posted" as const } : { postingStatus: { $in: [null, "failed" as const] } }) })
    .limit(20)
    .toArray();
  return rows.filter((r) => days(r.date, txn.date) <= 5).sort((a, b) => days(a.date, txn.date) - days(b.date, txn.date))[0] ?? null;
}

/** Takes the line for this run, or returns null when someone else holds it. */
async function claim(db: Db, txn: TxnDoc, userId: string, provider: string, kind: Posting["kind"]): Promise<TxnDoc | null> {
  const prev = txn.posting;
  // A new key only after a definite refusal; an unclear failure keeps it.
  const attempt = !prev ? 1 : prev.error && !prev.uncertain ? prev.attempt + 1 : prev.attempt;
  const now = new Date();
  const record: PostingRecord = {
    provider,
    kind,
    idempotencyKey: `sx-${txn._id}-${attempt}`,
    attempt,
    externalId: null,
    url: null,
    viaTransactionId: null,
    error: null,
    uncertain: false,
    startedAt: now,
    postedAt: null,
    postedBy: userId,
  };
  return db.txns.findOneAndUpdate(
    {
      _id: txn._id,
      qbConnectionId: txn.qbConnectionId,
      version: txn.version,
      $or: [{ postingStatus: null }, { postingStatus: "failed" }, { postingStatus: "processing", "posting.startedAt": { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    { $set: { postingStatus: "processing", posting: record, updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
}

async function finish(db: Db, id: string, set: Partial<TxnDoc> & Record<string, unknown>): Promise<TxnDoc | null> {
  return db.txns.findOneAndUpdate({ _id: id }, { $set: { ...set, updatedAt: new Date() }, $inc: { version: 1 } }, { returnDocument: "after" });
}

export async function postLines(db: Db, svc: PostingServices, args: { qbConnectionId: string; ids: string[]; userId: string }): Promise<PostOutcome[]> {
  const ids = [...new Set(args.ids)].slice(0, MAX_POST_BATCH);
  const out: PostOutcome[] = [];
  let chart: Map<string, LedgerAccount> | null = null;
  let stopped: { error: string; code: string } | null = null;

  for (const id of ids) {
    if (stopped) {
      out.push({ id, ok: false, ...stopped });
      continue;
    }
    const txn = await db.txns.findOne({ _id: id, qbConnectionId: args.qbConnectionId, removedAt: null });
    if (!txn) {
      out.push({ id, ok: false, error: "That transaction isn't here any more." });
      continue;
    }
    if (txn.postingStatus === "posted") {
      out.push({ id, ok: true, transaction: toView(txn) });
      continue;
    }
    if (!POSTABLE.includes(txn.status)) {
      out.push({ id, ok: false, error: "Only lines that are ready to post, matched or marked as a transfer can be sent." });
      continue;
    }

    try {
      chart ??= new Map((await svc.adapter.listAccounts(svc.ledger)).map((a) => [a.id, a]));

      // The other side of this transfer already made the entry: link to it.
      if (txn.status === "transfer") {
        const done = await findCounterpart(db, txn, true);
        if (done?.posting && !done.posting.viaTransactionId) {
          const claimed = await claim(db, txn, args.userId, svc.ledger.provider, "transfer");
          if (!claimed) {
            out.push({ id, ok: false, error: "This line is being sent from another tab." });
            continue;
          }
          const linked = await finish(db, id, {
            postingStatus: "posted",
            posting: { ...(claimed.posting as PostingRecord), externalId: done.posting.externalId, url: done.posting.url, viaTransactionId: done._id, postedAt: new Date() },
          });
          await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "bank.posted", transactionId: id, detail: { kind: "transfer", via: done._id, externalId: done.posting.externalId } });
          out.push({ id, ok: true, transaction: linked ? toView(linked) : undefined });
          continue;
        }
      }

      const posting = await buildPosting(db, svc, chart, txn);
      const claimed = await claim(db, txn, args.userId, svc.ledger.provider, posting.kind);
      if (!claimed) {
        out.push({ id, ok: false, error: "This line changed or is being sent from another tab. Refresh and try again." });
        continue;
      }
      const key = (claimed.posting as PostingRecord).idempotencyKey;

      let entry;
      try {
        entry = await svc.adapter.post(svc.ledger, posting, key);
      } catch (error) {
        // QuickBooks/Xero refused the token itself (nothing was created): renew once, same key.
        if (error instanceof LedgerError && error.code === "reconnect" && svc.renewLedger) {
          svc.ledger = await svc.renewLedger();
          svc.renewLedger = undefined;
          entry = await svc.adapter.post(svc.ledger, posting, key);
        } else throw error;
      }

      const saved = await finish(db, id, {
        postingStatus: "posted",
        posting: { ...(claimed.posting as PostingRecord), externalId: entry.externalId, url: entry.url, postedAt: new Date() },
      });
      await logEvent(db, {
        qbConnectionId: args.qbConnectionId,
        actor: args.userId,
        action: "bank.posted",
        transactionId: id,
        detail: { kind: posting.kind, provider: svc.ledger.provider, externalId: entry.externalId, amount: posting.amount },
      });
      out.push({ id, ok: true, transaction: saved ? toView(saved) : undefined });

      // One transfer entry covers both bank lines: mark the other side too.
      if (posting.kind === "transfer") {
        const other = await findCounterpart(db, txn, false);
        if (other) {
          const otherClaim = await claim(db, other, args.userId, svc.ledger.provider, "transfer");
          if (otherClaim) {
            await finish(db, other._id, {
              postingStatus: "posted",
              posting: { ...(otherClaim.posting as PostingRecord), externalId: entry.externalId, url: entry.url, viaTransactionId: id, postedAt: new Date() },
            });
            await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "bank.posted", transactionId: other._id, detail: { kind: "transfer", via: id, externalId: entry.externalId } });
          }
        }
      }
    } catch (error) {
      const refused = error instanceof LineRefused;
      const ledger = error instanceof LedgerError ? error : null;
      const message = refused || ledger ? (error as Error).message : "Something went wrong while sending. Try again.";
      if (!refused) console.error("[bank] post", ledger ? `${ledger.code} ${ledger.outcome}` : (error as Error)?.message);
      // A claimed line records the failure; "uncertain" keeps its key for the retry.
      const current = await db.txns.findOne({ _id: id });
      if (current?.postingStatus === "processing") {
        await finish(db, id, {
          postingStatus: "failed",
          posting: { ...(current.posting as PostingRecord), error: message, uncertain: !ledger || ledger.outcome === "unknown" },
        });
        await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "bank.post_failed", transactionId: id, detail: { error: message, code: ledger?.code ?? null } });
      } else if (refused && current && current.postingStatus !== "posted") {
        // Refused before anything was sent: keep the reason on the line so the
        // row can say why. An earlier unclear attempt keeps its key and flag.
        const prev = current.posting;
        await finish(db, id, {
          postingStatus: "failed",
          posting: {
            provider: svc.ledger.provider,
            kind: prev?.kind ?? (current.status === "matched" ? "billPayment" : current.status === "transfer" ? "transfer" : current.amountCents < 0 ? "expense" : "deposit"),
            idempotencyKey: prev?.idempotencyKey ?? "",
            attempt: prev?.attempt ?? 0,
            externalId: null,
            url: null,
            viaTransactionId: null,
            error: message,
            uncertain: prev?.uncertain ?? false,
            startedAt: prev?.startedAt ?? new Date(),
            postedAt: null,
            postedBy: args.userId,
          },
        });
      }
      const after = await db.txns.findOne({ _id: id });
      out.push({ id, ok: false, error: message, code: ledger?.code, transaction: after ? toView(after) : undefined });
      if (ledger && BATCH_STOPPERS.has(ledger.code)) stopped = { error: message, code: ledger.code };
    }
  }
  return out;
}
