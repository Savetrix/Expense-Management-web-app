// SERVER-ONLY. Is a GL account still active in QuickBooks/Xero? A company rule
// whose account is gone is marked broken and skipped (rules.ts markBrokenRules).
//
// 1. The live chart, straight from QuickBooks/Xero (ledger/): it lists active
//    accounts only, so an id that isn't in it is gone. Needs the web app's
//    service key (WEB_APP_SERVICE_KEY).
// 2. Without it, the backend's GL list. That list has no income accounts, so an
//    id missing from it proves nothing: only an account it marks deleted counts
//    as gone.
// When neither answers, there is no verdict and nothing is marked.
import { SAVETRIX_API_BASE_URL } from "./config";
import { adapterFor } from "./ledger";
import { getLedgerContext } from "./ledger/backend";

export type IsGone = (glAccountId: string) => boolean;

/** From the live chart's active account ids. */
export function goneFromChart(activeIds: string[]): IsGone {
  const active = new Set(activeIds);
  return (id) => !active.has(id);
}

export async function goneAccountCheck(userToken: string, qbConnectionId: string): Promise<IsGone | null> {
  try {
    const ledger = await getLedgerContext(userToken, qbConnectionId);
    const accounts = await adapterFor(ledger.provider).listAccounts(ledger);
    return goneFromChart(accounts.map((a) => a.id));
  } catch {
    // Not configured here, or QuickBooks/Xero didn't answer: try the backend's list.
  }
  try {
    const res = await fetch(`${SAVETRIX_API_BASE_URL}/quickbooks/accounts`, {
      headers: { Authorization: `Bearer ${userToken}`, "X-QB-Id": qbConnectionId },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const list = ((await res.json()) as { data?: { accounts?: unknown } } | null)?.data?.accounts;
    if (!Array.isArray(list)) return null;
    const rows = list as { qbAccountId?: unknown; isDeleted?: unknown }[];
    const live = new Set(rows.filter((a) => !a.isDeleted).map((a) => String(a.qbAccountId)));
    const deleted = new Set(rows.filter((a) => a.isDeleted).map((a) => String(a.qbAccountId)));
    return (id) => deleted.has(id) && !live.has(id);
  } catch {
    return null;
  }
}
