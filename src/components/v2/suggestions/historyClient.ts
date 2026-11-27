"use client";

import { authFetch } from "@/lib/authFetch";

// The browser side of /api/suggestions/history (lib/bankFeeds/history.ts):
// Smart Suggestions learning from the company's own QuickBooks/Xero books.
// There is no switch on screen (Saurabh, 20 Nov); the bank page asks for the
// one-time read when it opens.

const headers = (qbConnectionId: string) => ({ "Content-Type": "application/json", "X-QB-Id": qbConnectionId });

/** Reads the books the first time only (read once). True when new history was read. */
export async function requestHistoryRead(qbConnectionId: string, force = false): Promise<{ imported: boolean; error?: string }> {
  try {
    const res = await authFetch("/api/suggestions/history", { method: "POST", headers: headers(qbConnectionId), body: JSON.stringify({ force }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { imported: false, error: body?.error ?? "Couldn't read the books just now." };
    return { imported: body?.imported === true };
  } catch {
    return { imported: false, error: "Couldn't read the books just now. Check your connection." };
  }
}

/** Step 3: keeps the company's meaning vectors current. Returns how many items changed (newly embedded, recoded or removed); above 0 the lines were scored again. */
export async function requestSimilarSync(qbConnectionId: string, opts: { afterImport?: boolean } = {}): Promise<number> {
  try {
    const res = await authFetch(`/api/suggestions/similar/sync${opts.afterImport ? "?after=import" : ""}`, { method: "POST", headers: headers(qbConnectionId) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const count = (n: unknown) => (typeof n === "number" ? n : 0);
    return count(body?.embedded) + count(body?.recoded) + count(body?.removed);
  } catch {
    return 0;
  }
}

/** Step 4 for one bank line opened without a suggestion: true when it got AI picks (reload the lines). */
export async function requestAiPick(qbConnectionId: string, lineId: string): Promise<boolean> {
  try {
    const res = await authFetch("/api/suggestions/ai", { method: "POST", headers: headers(qbConnectionId), body: JSON.stringify({ lineId }) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return body?.changed === true;
  } catch {
    return false;
  }
}

/** Steps 3 and 4 for a bill from a new vendor: the accounts similar past items went to, then the AI's picks when those are weak. */
export async function fetchSimilarPicks(
  qbConnectionId: string,
  input: { vendorName: string; lines: string[]; invoiceId?: string; amount?: number | null; currency?: string | null },
): Promise<import("@/lib/suggestions/picks").SuggestionPick[]> {
  try {
    const res = await authFetch("/api/suggestions/similar", { method: "POST", headers: headers(qbConnectionId), body: JSON.stringify(input) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return Array.isArray(body?.picks) ? body.picks : [];
  } catch {
    return [];
  }
}
