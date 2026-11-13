"use client";

import { authFetch } from "@/lib/authFetch";

// The browser side of /api/suggestions/history (lib/bankFeeds/history.ts):
// Smart Suggestions learning from the company's own QuickBooks/Xero books.

export interface HistoryStatusDto {
  at: string;
  provider: string;
  outcome: "done" | "real_company" | "provider_terms" | "error";
  from: string | null;
  to: string | null;
  lines: number;
  entries: number;
  skippedScantrix: number;
  error?: string | null;
}

export interface HistoryStateDto {
  learnFromHistory: boolean;
  canChange: boolean;
  status: HistoryStatusDto | null;
  running: boolean;
  payees: { total: number; matched: number; unmatched: string[] };
}

const headers = (qbConnectionId: string) => ({ "Content-Type": "application/json", "X-QB-Id": qbConnectionId });

export async function fetchHistoryState(qbConnectionId: string): Promise<HistoryStateDto | null> {
  try {
    const res = await authFetch("/api/suggestions/history", { headers: headers(qbConnectionId) });
    return res.ok ? ((await res.json()) as HistoryStateDto) : null;
  } catch {
    return null;
  }
}

/** Reads the books when the last read is over a day old (or `force`). True when new history was read. */
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

export async function saveLearnFromHistory(qbConnectionId: string, learnFromHistory: boolean): Promise<string | null> {
  try {
    const res = await authFetch("/api/suggestions/history", { method: "PUT", headers: headers(qbConnectionId), body: JSON.stringify({ learnFromHistory }) });
    if (res.ok) return null;
    const body = await res.json().catch(() => null);
    return body?.error ?? "Couldn't change the setting.";
  } catch {
    return "Couldn't change the setting. Check your connection.";
  }
}
