// SERVER-ONLY. Smart Suggestions, step 4: the AI pick (lib/suggestions/aiPick.ts
// says what is sent and how the answer is checked).
//
// When: a line to review that steps 2 and 3 have nothing for (or step 3 is
// below Medium) is asked once, when it arrives (the bank page's sync after an
// import or on open) or when it is opened without a suggestion, and the answer
// is saved on the line (TxnDoc.aiPick). It is asked again only when the
// accounts it may pick from change, or its closest past items change (a person
// posted a similar line). Lines with the same payee and direction share one
// answer for a day. Never on every page load. With Auto-classification Off
// nothing is sent.
//
// A timeout (8 s) or an error shows nothing and blocks nothing: the line is
// coded and posted by hand as always, and it is asked again an hour later.
//
// The provider sits behind AiPicker so it can change later; the model id is
// saved on every answer and every suggestion made from it.
import OpenAI from "openai";

import {
  AI_MAX_PAST,
  AI_REUSE_MS,
  AI_SYSTEM_PROMPT,
  AI_TIMEOUT_MS,
  aiAllowedAccounts,
  aiSchema,
  aiUserMessage,
  basisKey,
  chartHash,
  validPicks,
  type AiAccount,
  type AiInput,
} from "@/lib/suggestions/aiPick";
import { payeeKey } from "@/lib/suggestions/match";
import type { SuggestionPick } from "@/lib/suggestions/picks";
import { cosine, suggestedVendorName } from "@/lib/suggestions/similar";

import { bankSideIds, readLists } from "./companyLists";
import type { Db } from "./db";
import { nameKey } from "./history";
import type { AiPickDoc, AiPickRecord, TxnDoc, VectorDoc } from "./schema";

export interface AiAnswer {
  /** The answer as the provider gave it ({ picks: [{ account_id, reason }] }); checked by askAi, never trusted. */
  raw: unknown;
  usage?: { input: number; output: number } | null;
}

export interface AiPicker {
  /** Saved on every answer: "openai:gpt-5.4-mini". */
  model: string;
  /** May throw. askAi gives it AI_TIMEOUT_MS and checks every id it returns. */
  pick(input: AiInput): Promise<AiAnswer>;
}

/**
 * The OpenAI picker on the same key and the same small model as the shop-kind
 * labeller (shopKind.ts), or null when this server has no key. Structured
 * output, the allowed ids in the schema, low reasoning effort (measured 21 Nov:
 * about 1–3 s an answer), no retries, 8 s at most.
 */
export function openAiPicker(apiKey = process.env.OPENAI_API_KEY?.trim(), timeoutMs = AI_TIMEOUT_MS): AiPicker | null {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  // SUGGESTIONS_AI_MODEL changes step 4 alone; else the app's model (OPENAI_MODEL), as the shop-kind labeller.
  const model = process.env.SUGGESTIONS_AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  // Only reasoning models take reasoning_effort; another model would refuse every call.
  const reasoning = /^(gpt-5|o\d)/i.test(model) ? { reasoning_effort: "low" as const } : {};
  return {
    model: `openai:${model}`,
    async pick(input) {
      const ids = input.accounts.map((a) => a.id);
      const call = client.chat.completions.create(
        {
          model,
          ...reasoning,
          response_format: { type: "json_schema", json_schema: aiSchema(ids) as never },
          messages: [
            { role: "system", content: AI_SYSTEM_PROMPT },
            { role: "user", content: aiUserMessage(input) },
          ],
        },
        { timeout: timeoutMs, maxRetries: 0 },
      );
      const res = await call;
      let raw: unknown = null;
      try {
        raw = JSON.parse(res.choices[0]?.message.content ?? "null");
      } catch {
        // An answer we can't read picks nothing.
      }
      return { raw, usage: res.usage ? { input: res.usage.prompt_tokens, output: res.usage.completion_tokens } : null };
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error("step 4 timed out")), ms)))]).finally(() => clearTimeout(timer));
}

/** Step 4 is for an item steps 2 and 3 have nothing for, or where step 3 is below Medium. */
export function needsAi(suggestion: unknown): boolean {
  const s = suggestion as { kind?: string | null; step?: string; confidence?: string } | null | undefined;
  if (!s || !s.kind) return true;
  if (s.step === "ai") return true;
  return s.step === "similar" && s.confidence === "low";
}

type Memory = Pick<VectorDoc, "_id" | "vector" | "out" | "glAccountId" | "label" | "date" | "source">;

/** The company's past items an AI may be shown: memory vectors with an allowed account. */
export async function aiMemory(db: Db, qbConnectionId: string, allowed: ReadonlySet<string>): Promise<Memory[]> {
  const docs = await db.vectors
    .find({ qbConnectionId, role: "memory", glAccountId: { $ne: null } }, { projection: { vector: 1, out: 1, glAccountId: 1, label: 1, date: 1, source: 1 } })
    .toArray();
  return docs.filter((d) => d.glAccountId && allowed.has(d.glAccountId));
}

/** Up to 10 of the closest past items in the same direction, however weak (step 3 had too few close ones). */
export function nearestPast(vector: number[] | undefined, out: boolean, memory: readonly Memory[]): Memory[] {
  if (!vector) return [];
  return memory
    .filter((m) => m.out === out)
    .map((m) => ({ m, sim: cosine(vector, m.vector) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, AI_MAX_PAST)
    .map((x) => x.m);
}

/** The allowed accounts for this company now, and their hash. */
export async function aiAccountsFor(db: Db, qbConnectionId: string): Promise<{ accounts: AiAccount[]; hash: string; ids: Set<string> }> {
  const [lists, bankSide] = await Promise.all([readLists(db, qbConnectionId), bankSideIds(db, qbConnectionId)]);
  const accounts = aiAllowedAccounts(lists?.chart ?? [], bankSide);
  return { accounts, hash: chartHash(accounts), ids: new Set(accounts.map((a) => a.id)) };
}

/** True when a saved answer still holds: same allowed accounts, same closest past items, and a failed one waits its hour. */
export function answerHolds(rec: AiPickRecord | null | undefined, hash: string, basis: string, now: number): boolean {
  if (!rec) return false;
  // After a timeout or an error, nothing is asked again before retryAfter.
  if (rec.retryAfter && new Date(rec.retryAfter).getTime() > now) return true;
  return rec.status !== "failed" && rec.chartHash === hash && basisKey(rec.basis) === basis;
}

const RETRY_AFTER_MS = 3_600_000;

/**
 * Asks the AI once and turns the answer (or the failure) into a record. Never
 * throws. Every id is checked against the allowed list here, whatever the
 * provider; past `timeoutMs` the answer is ignored and the line shows nothing.
 */
export async function askAi(picker: AiPicker, input: AiInput, args: { hash: string; basis: Memory[]; out: boolean; now: number; timeoutMs?: number }): Promise<AiPickRecord> {
  const base = {
    model: picker.model,
    at: new Date(args.now),
    out: args.out,
    chartHash: args.hash,
    basis: args.basis.map((m) => m._id),
    past: args.basis.map((m) => ({ label: m.label, glAccountId: m.glAccountId as string, date: m.date, source: m.source })),
  };
  try {
    const answer = await withTimeout(picker.pick(input), args.timeoutMs ?? AI_TIMEOUT_MS);
    const picks = validPicks(answer.raw, new Set(input.accounts.map((a) => a.id)));
    return { ...base, status: picks.length ? "ok" : "none", picks: picks.map((p) => ({ glAccountId: p.accountId, reason: p.reason })), retryAfter: null, usage: answer.usage ?? null };
  } catch (error) {
    console.error("[bank] step 4", (error as Error)?.message);
    return { ...base, status: "failed", picks: [], retryAfter: new Date(args.now + RETRY_AFTER_MS), usage: null };
  }
}

/** A bank line as the AI sees it. */
export function lineInput(t: Pick<TxnDoc, "payee" | "merchantName" | "counterpartyName" | "description" | "categoryDetailed" | "categoryPrimary" | "shopKind" | "amountCents" | "currency">): AiInput["line"] {
  return {
    payee: t.payee ?? t.merchantName ?? t.counterpartyName ?? suggestedVendorName(null, t.description),
    description: t.description,
    category: t.categoryDetailed ?? t.categoryPrimary ?? t.shopKind ?? null,
    out: t.amountCents < 0,
    amount: Math.abs(t.amountCents) / 100,
    currency: t.currency ?? null,
  };
}

/**
 * A saved answer → step 4 picks: Low, "AI suggestion, please review", each with
 * the AI's reason and the past items it was shown that went to that account.
 * An account no longer allowed drops out.
 */
export function aiPicksFrom(rec: AiPickRecord | null | undefined, allowed: ReadonlySet<string>, subject: string): SuggestionPick[] {
  if (!rec || rec.status !== "ok") return [];
  return rec.picks
    .filter((p) => allowed.has(p.glAccountId))
    .map((p) => ({
      glAccountId: p.glAccountId,
      confidence: "low" as const,
      step: "ai" as const,
      subject,
      lines: 0,
      weight: 0,
      evidence: (rec.past ?? []).filter((x) => x.glAccountId === p.glAccountId).slice(0, 3).map((x) => ({ label: x.label, date: x.date, amountCents: null, source: x.source })),
      aiReason: p.reason,
    }));
}

/**
 * Step 4 for a bill from a new vendor on the invoice screen (steps 2 and 3
 * have nothing, or step 3 is below Medium). The answer is kept per invoice
 * (suggestion_ai_picks) and reused for the same vendor within the day.
 */
export async function aiPicksForInvoice(
  db: Db,
  qbConnectionId: string,
  picker: AiPicker | null,
  args: { invoiceId: string | null; vendorName: string; lines: string[]; amount: number | null; currency: string | null; vector: number[] | undefined; now?: number; timeoutMs?: number },
): Promise<SuggestionPick[]> {
  if (!picker) return [];
  const { accounts, hash, ids } = await aiAccountsFor(db, qbConnectionId);
  if (accounts.length === 0) return [];
  const now = args.now ?? Date.now();
  const basis = nearestPast(args.vector, true, await aiMemory(db, qbConnectionId, ids));
  const vendorKey = nameKey(args.vendorName);
  const _id = args.invoiceId ? `${qbConnectionId}:invoice:${args.invoiceId}` : null;
  const saved = _id ? await db.aiPicks.findOne({ _id, qbConnectionId }) : null;
  let rec: AiPickRecord | null = answerHolds(saved, hash, basisKey(basis.map((m) => m._id)), now) ? saved : null;
  if (!rec && vendorKey) {
    const recent = await db.aiPicks.findOne(
      { qbConnectionId, vendorKey, chartHash: hash, status: { $in: ["ok", "none"] }, at: { $gt: new Date(now - AI_REUSE_MS) }, ...(_id ? { _id: { $ne: _id } } : {}) },
      { sort: { at: -1 } },
    );
    if (recent) rec = { ...recent, basis: basis.map((m) => m._id), sharedFrom: recent._id };
  }
  if (!rec) {
    const line = { payee: args.vendorName, description: args.lines.filter(Boolean).slice(0, 5).join("; ") || args.vendorName, category: null, out: true, amount: Math.abs(args.amount ?? 0), currency: args.currency };
    rec = await askAi(picker, { line, accounts, past: basis.map((m) => ({ label: m.label, accountId: m.glAccountId as string })) }, { hash, basis, out: true, now, timeoutMs: args.timeoutMs });
  }
  if (_id && rec !== saved) {
    const r = rec as AiPickRecord;
    const doc: Omit<AiPickDoc, "_id"> = {
      status: r.status, model: r.model, at: r.at, out: r.out, chartHash: r.chartHash, basis: r.basis, past: r.past, picks: r.picks, retryAfter: r.retryAfter, sharedFrom: r.sharedFrom ?? null, usage: r.usage ?? null,
      qbConnectionId, kind: "invoice", ref: args.invoiceId as string, vendorKey,
    };
    await db.aiPicks.replaceOne({ _id, qbConnectionId }, doc, { upsert: true });
  }
  return aiPicksFrom(rec, ids, args.vendorName.trim() || "this vendor");
}

export interface AiRunOutcome {
  skipped?: "off" | "no_picker" | "no_accounts";
  /** Lines that needed step 4. */
  lines: number;
  /** AI calls made. */
  asked: number;
  /** Lines that got an answer another line with the same payee and direction got within the day. */
  reused: number;
  /** Lines whose saved answer still holds. */
  kept: number;
  failed: number;
  /** Payee keys whose lines got a new answer (re-scored). */
  keys: string[];
}

const CONCURRENCY = 4;

const isOff = async (db: Db, qbConnectionId: string) =>
  ((await db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { autoClassification: 1 } }))?.autoClassification ?? "fill") === "off";

/**
 * Step 4 for a company's lines to review (or only `lineIds`): asks the AI for
 * lines that need it and have no answer that still holds, saves the answers
 * on the lines, then re-scores them so the picks show. Returns what happened.
 */
export async function runAiPicks(
  db: Db,
  qbConnectionId: string,
  picker: AiPicker | null,
  opts: { lineIds?: string[]; now?: number; maxCalls?: number; timeoutMs?: number; refresh?: (keys?: string[]) => Promise<unknown> } = {},
): Promise<AiRunOutcome> {
  const outcome: AiRunOutcome = { lines: 0, asked: 0, reused: 0, kept: 0, failed: 0, keys: [] };
  if (await isOff(db, qbConnectionId)) return { ...outcome, skipped: "off" };
  if (!picker) return { ...outcome, skipped: "no_picker" };
  const { accounts, hash, ids } = await aiAccountsFor(db, qbConnectionId);
  if (accounts.length === 0) return { ...outcome, skipped: "no_accounts" };
  const now = opts.now ?? Date.now();

  const candidates = (
    await db.txns
      .find({ qbConnectionId, removedAt: null, status: "review", decidedBy: { $in: [null, "autopilot"] }, postingStatus: null, ...(opts.lineIds ? { _id: { $in: opts.lineIds } } : {}) })
      .toArray()
  ).filter((c) => needsAi(c.suggestion));
  outcome.lines = candidates.length;
  if (candidates.length === 0) return outcome;

  const memory = await aiMemory(db, qbConnectionId, ids);
  const queryDocs = await db.vectors.find({ qbConnectionId, role: "query", kind: "bank", ref: { $in: candidates.map((c) => c._id) } }, { projection: { ref: 1, vector: 1 } }).toArray();
  const queries = new Map(queryDocs.map((d) => [d.ref, d.vector]));

  // One question per payee and direction; the others with it get the same answer.
  const groups = new Map<string, { key: string; out: boolean; lines: { t: TxnDoc; basis: Memory[] }[] }>();
  for (const t of candidates) {
    const out = t.amountCents < 0;
    const basis = nearestPast(queries.get(t._id), out, memory);
    if (answerHolds(t.aiPick, hash, basisKey(basis.map((m) => m._id)), now)) {
      outcome.kept += 1;
      continue;
    }
    const key = t.payeeKey ?? payeeKey(t.merchantName ?? t.counterpartyName, t.description);
    // A line with no payee name ("POS PURCHASE 4521") shares with nobody: it gets its own question.
    const group = key ? `${key}|${out}` : `line:${t._id}`;
    const g = groups.get(group) ?? { key, out, lines: [] };
    g.lines.push({ t, basis });
    groups.set(group, g);
  }

  const save = async (t: TxnDoc, rec: AiPickRecord) => {
    await db.txns.updateOne({ _id: t._id, qbConnectionId, status: "review", postingStatus: null }, { $set: { aiPick: rec } });
  };
  const queue = [...groups.values()];
  const maxCalls = opts.maxCalls ?? 40;
  const touched = new Set<string>();
  const work = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      const [first] = g.lines;
      // An answer another line with this payee and direction got within the day.
      const recent = g.key
        ? await db.txns.findOne(
            { qbConnectionId, payeeKey: g.key, "aiPick.out": g.out, "aiPick.chartHash": hash, "aiPick.status": { $in: ["ok", "none"] }, "aiPick.at": { $gt: new Date(now - AI_REUSE_MS) }, _id: { $nin: g.lines.map((l) => l.t._id) } },
            { sort: { "aiPick.at": -1 }, projection: { aiPick: 1 } },
          )
        : null;
      let rec: AiPickRecord;
      if (recent?.aiPick) {
        rec = { ...recent.aiPick, sharedFrom: recent._id };
        outcome.reused += g.lines.length;
      } else {
        if (outcome.asked >= maxCalls) continue;
        // Switched Off while this ran: nothing more goes to the AI.
        if (await isOff(db, qbConnectionId)) continue;
        outcome.asked += 1;
        rec = await askAi(picker, { line: lineInput(first.t), accounts, past: first.basis.map((m) => ({ label: m.label, accountId: m.glAccountId as string })) }, { hash, basis: first.basis, out: g.out, now, timeoutMs: opts.timeoutMs });
        if (rec.status === "failed") outcome.failed += 1;
        else outcome.reused += g.lines.length - 1;
      }
      // Each line keeps its own closest items, so a later similar post re-asks only the lines it is close to.
      for (const { t, basis } of g.lines) {
        // A failed re-ask keeps the line's earlier good answer, and waits an hour before asking again.
        if (rec.status === "failed" && t.aiPick?.status === "ok") {
          await save(t, { ...t.aiPick, retryAfter: rec.retryAfter });
          continue;
        }
        await save(t, { ...rec, basis: basis.map((m) => m._id), ...(t === first.t ? {} : { sharedFrom: rec.sharedFrom ?? first.t._id }) });
      }
      if (rec.status !== "failed") touched.add(g.key);
      if (rec.status !== "failed" && !g.key) noKey = true;
    }
  };
  let noKey = false;
  await Promise.all(Array.from({ length: CONCURRENCY }, work));
  outcome.keys = [...touched].filter(Boolean);
  // Lines with no payee key can't be scored by key: score everything once instead.
  if (opts.refresh && (outcome.keys.length > 0 || noKey)) await opts.refresh(noKey ? undefined : outcome.keys);
  if (noKey) outcome.keys.push("");
  return outcome;
}
