// SERVER-ONLY. One HTTP call to QuickBooks or Xero, with the same 429 back-off
// the backend uses (Scantrix_API src/integrations/accounting/http.js).
import { LedgerError } from "./types";

const MAX_RETRIES = 3;
/** Xero's daily limit says "come back in hours": give up rather than wait. */
const MAX_RETRY_AFTER_MS = 60_000;
const TIMEOUT_MS = 30_000;

export interface LedgerResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

export async function ledgerFetch(url: string, init: RequestInit, attempt = 0): Promise<LedgerResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    // No answer: the entry may or may not exist. The caller keeps the same key.
    throw new LedgerError(`The accounting software didn't answer (${(error as Error).name}). Try again.`, "unknown", "unavailable");
  }
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const seconds = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2 ** attempt * 1000;
    if (delay <= MAX_RETRY_AFTER_MS) {
      await new Promise((r) => setTimeout(r, delay));
      return ledgerFetch(url, init, attempt + 1);
    }
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, data };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
