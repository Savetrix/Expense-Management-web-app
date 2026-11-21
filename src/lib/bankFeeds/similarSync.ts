// SERVER-ONLY. Keeps a company's meaning vectors (step 3, similar past items)
// in step with its memory: bank lines a person coded, lines from its books
// (history), bills a person posted, and the bank lines still to review.
//
// Where they live: in this database (suggestion_vectors), and they are
// compared in the app (lib/suggestions/similar.ts), not with Atlas Vector
// Search. A company has a few thousand items at most, so one read and a loop
// is fast; it needs no index on Nikhil's live cluster; it runs the same in
// tests and on a laptop; and every read is scoped to one company.
//
// Only text that is new or changed is sent to the embedder, so a company is
// embedded once and then a few lines a day. With Auto-classification Off,
// nothing is sent.
import { createHash } from "node:crypto";

import { bankText, historyText, invoiceText } from "@/lib/suggestions/similar";

import type { Db } from "./db";
import { openAiEmbedder, type Embedder } from "./embeddings";
import { readLearnFromHistory } from "./history";
import type { VectorDoc } from "./schema";
import { openAiLabeller, type Labeller } from "./shopKind";
import { readAutoClassification, refreshSuggestions } from "./suggest";

/** A bill a person posted, as the backend lists it (ledger/backend.ts scantrixInvoices). */
export interface InvoiceMemory {
  id: string;
  vendorName: string;
  lines: string[];
  glAccountId: string | null;
  taxCodeId: string | null;
  date: string;
  amountCents: number | null;
  decidedAt: string;
}

type Item = Omit<VectorDoc, "vector" | "model" | "embeddedAt" | "textHash">;

const hash = (model: string, text: string) => createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 32);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : new Date(0).toISOString());

/** Everything that should have a vector for this company now. `invoices` undefined = keep the invoice vectors as they are. */
async function itemsFor(db: Db, qbConnectionId: string, invoices: InvoiceMemory[] | undefined, labeller: Labeller | null): Promise<Item[]> {
  const items: Item[] = [];
  const all = await db.txns
    .find({ qbConnectionId, removedAt: null }, { projection: { status: 1, decidedBy: 1, decidedAt: 1, glAccountId: 1, taxCodeId: 1, payee: 1, merchantName: 1, counterpartyName: 1, description: 1, categoryDetailed: 1, categoryPrimary: 1, shopKind: 1, amountCents: 1, date: 1, postingStatus: 1, posting: 1 } })
    .toArray();
  const lines = all.flatMap((t) => {
    const byPerson = Boolean(t.decidedBy && t.decidedBy !== "autopilot" && t.decidedBy !== "system");
    // Memory: lines POSTED to QuickBooks/Xero with an account (Saurabh, 18 Nov:
    // a choice nobody posted teaches nothing), not ones found already entered there.
    const memory = Boolean(t.postingStatus === "posted" && t.glAccountId && !t.posting?.found && t.status === "ready");
    const query = t.status === "review" && !t.postingStatus && !byPerson;
    return memory || query ? [{ t, memory }] : [];
  });
  await labelShops(db, qbConnectionId, lines.map((l) => l.t), labeller);
  for (const { t, memory } of lines) {
    items.push({
      _id: `${qbConnectionId}:bank:${t._id}`,
      qbConnectionId,
      kind: "bank",
      role: memory ? "memory" : "query",
      ref: t._id,
      text: bankText({ payee: t.payee ?? t.merchantName ?? t.counterpartyName, description: t.description, category: t.categoryDetailed ?? t.categoryPrimary ?? t.shopKind }),
      out: t.amountCents < 0,
      glAccountId: memory ? t.glAccountId : null,
      taxCodeId: memory ? t.taxCodeId : null,
      label: (t.payee ?? t.merchantName ?? t.counterpartyName ?? t.description).trim(),
      date: t.date,
      amountCents: Math.abs(t.amountCents),
      decidedAt: iso(t.posting?.postedAt ?? t.decidedAt ?? t.date),
      source: "bank",
    });
  }

  // The company's books: only the readable kinds with a GL account, one row per entry.
  // Xero history is never read (its terms), so only QuickBooks rows exist here.
  if (await readLearnFromHistory(db, qbConnectionId)) {
    const rows = await db.history.find({ qbConnectionId, dominant: true, source: "quickbooks", entity: { $in: ["Bill", "Purchase", "Deposit"] }, glAccountId: { $ne: null } }).toArray();
    for (const h of rows) {
      items.push({
        _id: `${qbConnectionId}:history:${h._id}`,
        qbConnectionId,
        kind: "history",
        role: "memory",
        ref: h._id,
        text: historyText(h),
        out: h.entity === "Deposit" ? false : !h.credit,
        glAccountId: h.glAccountId,
        taxCodeId: h.taxCodeId,
        label: h.vendorName ?? "Earlier entry",
        date: h.date,
        amountCents: h.amountCents,
        decidedAt: `${h.date}T12:00:00.000Z`,
        source: "quickbooks",
      });
    }
  }

  for (const inv of invoices ?? []) {
    if (!inv.glAccountId) continue;
    items.push({
      _id: `${qbConnectionId}:invoice:${inv.id}`,
      qbConnectionId,
      kind: "invoice",
      role: "memory",
      ref: inv.id,
      text: invoiceText({ vendorName: inv.vendorName, lines: inv.lines }),
      out: true,
      glAccountId: inv.glAccountId,
      taxCodeId: inv.taxCodeId,
      label: inv.vendorName || "Bill",
      date: inv.date,
      amountCents: inv.amountCents,
      decidedAt: inv.decidedAt,
      source: "invoice",
    });
  }
  return items.filter((i) => i.text);
}

type LabelRow = { _id: string; payee?: string | null; merchantName?: string | null; counterpartyName?: string | null; description: string; categoryDetailed?: string | null; categoryPrimary?: string | null; shopKind?: string | null };

/**
 * Lines without a bank category (imported files) get the kind of business
 * once (shopKind.ts), saved on the line. A failed call labels nothing and is
 * tried again on the next sync; it never stops the sync.
 */
async function labelShops(db: Db, qbConnectionId: string, rows: LabelRow[], labeller: Labeller | null): Promise<void> {
  if (!labeller) return;
  const todo = rows.filter((t) => !t.categoryDetailed && !t.categoryPrimary && t.shopKind === undefined);
  if (todo.length === 0) return;
  let kinds: (string | null | undefined)[];
  try {
    kinds = await labeller.label(todo.map((t) => bankText({ payee: t.payee ?? t.merchantName ?? t.counterpartyName, description: t.description })));
  } catch (error) {
    console.error("[bank] shop kind", (error as Error)?.message);
    return;
  }
  const ops = todo.flatMap((t, n) => {
    const kind = kinds[n];
    if (kind === undefined) return [];
    t.shopKind = kind;
    return [{ updateOne: { filter: { _id: t._id, qbConnectionId }, update: { $set: { shopKind: kind } } } }];
  });
  if (ops.length) await db.txns.bulkWrite(ops as never, { ordered: false });
}

export interface SyncOutcome {
  skipped?: "off" | "no_embedder";
  items: number;
  embedded: number;
  /** Items whose text stayed the same but whose coding or role changed (a line a person just coded becomes memory). */
  recoded: number;
  removed: number;
}

/** True when the lines to review should be scored again: memory or lines changed. */
export const syncChanged = (o: SyncOutcome) => !o.skipped && o.embedded + o.recoded + o.removed > 0;

/** Brings the company's vectors in step with its memory. Sends only new or changed text to the embedder. */
export async function syncVectors(db: Db, qbConnectionId: string, embedder: Embedder | null, opts: { invoices?: InvoiceMemory[]; labeller?: Labeller | null } = {}): Promise<SyncOutcome> {
  if ((await readAutoClassification(db, qbConnectionId)) === "off") return { skipped: "off", items: 0, embedded: 0, recoded: 0, removed: 0 };
  if (!embedder) return { skipped: "no_embedder", items: 0, embedded: 0, recoded: 0, removed: 0 };

  const items = await itemsFor(db, qbConnectionId, opts.invoices, opts.labeller ?? null);
  const existing = new Map((await db.vectors.find({ qbConnectionId }, { projection: { textHash: 1, model: 1, kind: 1, role: 1, glAccountId: 1, taxCodeId: 1, out: 1 } }).toArray()).map((d) => [d._id, d]));

  const toEmbed = items.filter((i) => {
    const d = existing.get(i._id);
    return !d || d.model !== embedder.model || d.textHash !== hash(embedder.model, i.text);
  });
  const vectors = toEmbed.length ? await embedder.embed(toEmbed.map((i) => i.text)) : [];
  const now = new Date();
  const fresh = new Set(toEmbed.map((i) => i._id));
  const recoded = items.filter((i) => {
    const d = existing.get(i._id);
    return d && !fresh.has(i._id) && (d.role !== i.role || (d.glAccountId ?? null) !== (i.glAccountId ?? null) || (d.taxCodeId ?? null) !== (i.taxCodeId ?? null) || d.out !== i.out);
  }).length;
  const ops = [
    ...toEmbed.map((i, n) => ({
      replaceOne: { filter: { _id: i._id, qbConnectionId }, replacement: { ...i, textHash: hash(embedder.model, i.text), model: embedder.model, vector: vectors[n], embeddedAt: now }, upsert: true },
    })),
    // Unchanged text: only the coding may have changed.
    ...items
      .filter((i) => !fresh.has(i._id))
      .map((i) => ({ updateOne: { filter: { _id: i._id, qbConnectionId }, update: { $set: { role: i.role, glAccountId: i.glAccountId, taxCodeId: i.taxCodeId, label: i.label, decidedAt: i.decidedAt, out: i.out } } } })),
  ];
  for (let k = 0; k < ops.length; k += 500) await db.vectors.bulkWrite(ops.slice(k, k + 500) as never, { ordered: false });

  const wanted = new Set(items.map((i) => i._id));
  const gone = [...existing.values()].filter((d) => !wanted.has(d._id) && (opts.invoices !== undefined || d.kind !== "invoice")).map((d) => d._id);
  if (gone.length) await db.vectors.deleteMany({ qbConnectionId, _id: { $in: gone } });
  return { items: items.length, embedded: toEmbed.length, recoded, removed: gone.length };
}

/** The company's memory vectors, ready to vote (lib/suggestions/similar.ts). */
export async function loadMemory(db: Db, qbConnectionId: string) {
  const docs = await db.vectors.find({ qbConnectionId, role: "memory", glAccountId: { $ne: null } }).toArray();
  return docs.map((d) => ({
    vector: d.vector,
    out: d.out,
    glAccountId: d.glAccountId as string,
    taxCodeId: d.taxCodeId,
    decidedAt: d.decidedAt,
    evidence: { label: d.label, date: d.date, amountCents: d.amountCents, source: d.source },
  }));
}

/**
 * After a decision or a history read: embeds what is new (bill vectors kept as
 * they are) and re-scores the lines to review when anything changed, so a new
 * payee's similar items include it at once.
 */
export async function embedNewDecision(db: Db, qbConnectionId: string, embedder: Embedder | null = openAiEmbedder(), labeller: Labeller | null = openAiLabeller()): Promise<SyncOutcome> {
  const outcome = await syncVectors(db, qbConnectionId, embedder, { labeller });
  if (syncChanged(outcome)) await refreshSuggestions(db, qbConnectionId);
  return outcome;
}
