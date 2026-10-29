// Thunks for the bank-feed routes (/api/plaid/*, /api/bank-accounts/*).
//
// Like chat/chatApi.ts and inboundEmail/inboundEmailApi.ts these call this
// app's own route handlers, not the Savetrix backend, so they use authFetch
// (token attached and refreshed) rather than lib/api.ts. The company goes in
// X-QB-Id; the server checks it against the caller's own company list.
import { createAsyncThunk } from "@reduxjs/toolkit";

import { authFetch } from "../../lib/authFetch";
// Type-only: the slice imports this file and store/index imports the slice.
import type { RootState } from "..";

export interface BankAccountDto {
  id: string;
  itemId: string;
  institutionName: string;
  name: string;
  mask?: string;
  subtype?: string;
  currency: string | null;
  currentBalance: number | null;
  lastSyncedAt: string | null;
  status: "connected" | "needs_relogin" | "syncing";
  statusDetail: string | null;
  mappedGlAccountId?: string;
  mappedGlAccountName?: string;
  historyLoading: boolean;
}

export type SyncOutcomeDto =
  | { status: "synced"; added: number; modified: number; removed: number }
  | { status: "busy" }
  | { status: "login_required"; code: string }
  | { status: "gone" }
  | { status: "failed"; code: string };

export interface BankRequestError {
  message: string;
  status: number;
  /** Server's machine reason, e.g. "not_configured", "duplicate", "login_required". */
  reason?: string;
}

async function bankFetch<T>(state: RootState, path: string, init?: RequestInit): Promise<T> {
  const qbConnectionId = state.quickBooks.qbConnectionId;
  if (!qbConnectionId) throw { message: "Pick a company first.", status: 400 } satisfies BankRequestError;
  const response = await authFetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), "X-QB-Id": qbConnectionId, ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw {
      message: body?.error || "Couldn't reach bank feeds. Please try again.",
      status: response.status,
      reason: typeof body?.reason === "string" ? body.reason : undefined,
    } satisfies BankRequestError;
  }
  return body as T;
}

const reject = (e: unknown): BankRequestError =>
  e && typeof e === "object" && "message" in e ? (e as BankRequestError) : { message: "Couldn't reach bank feeds. Please try again.", status: 0 };

export const fetchBankAccounts = createAsyncThunk<{ accounts: BankAccountDto[]; environment: string; qbConnectionId: string }, void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchAccounts",
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const body = await bankFetch<{ accounts: BankAccountDto[]; environment: string }>(state, "/api/bank-accounts");
      return { ...body, qbConnectionId: state.quickBooks.qbConnectionId as string };
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

/** Link token for a new connection, or for update mode when `accountId` is given. */
export const createLinkToken = createAsyncThunk<{ linkToken: string; mode: "connect" | "update"; environment: string }, { accountId?: string } | void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/createLinkToken",
  async (args, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), "/api/plaid/link-token", { method: "POST", body: JSON.stringify(args ?? {}) });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const exchangePublicToken = createAsyncThunk<
  { accounts: BankAccountDto[] },
  { publicToken: string; institution: { id?: string; name?: string }; accounts: { mask?: string }[] },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/exchange", async (args, { getState, rejectWithValue }) => {
  try {
    return await bankFetch(getState(), "/api/plaid/exchange-public-token", { method: "POST", body: JSON.stringify(args) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

export const syncBankAccount = createAsyncThunk<{ outcome: SyncOutcomeDto; accounts: BankAccountDto[] }, string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/sync",
  async (accountId, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), `/api/bank-accounts/${encodeURIComponent(accountId)}/sync`, { method: "POST" });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const completeBankRelogin = createAsyncThunk<{ outcome: SyncOutcomeDto; accounts: BankAccountDto[] }, string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/relogin",
  async (accountId, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), `/api/bank-accounts/${encodeURIComponent(accountId)}/relogin`, { method: "POST" });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const disconnectBankAccount = createAsyncThunk<{ accounts: BankAccountDto[] }, string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/disconnect",
  async (accountId, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), `/api/bank-accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const saveBankMapping = createAsyncThunk<
  { accounts: BankAccountDto[] },
  { accountId: string; ledgerAccountId: string; ledgerAccountName: string },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/mapping", async ({ accountId, ...body }, { getState, rejectWithValue }) => {
  try {
    return await bankFetch(getState(), `/api/bank-accounts/${encodeURIComponent(accountId)}/mapping`, { method: "PUT", body: JSON.stringify(body) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

// ---------------------------------------------------------------- transactions

export interface BankTransactionDto {
  id: string;
  date: string;
  description: string;
  accountName: string;
  accountId: string | null;
  amount: number;
  currency: string | null;
  status: "review" | "ready" | "matched" | "excluded" | "transfer";
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

export type BankTxnPatch = Partial<Pick<BankTransactionDto, "status" | "matchedInvoiceId" | "transferAccount" | "transferAccountId" | "categoryId" | "taxCodeId" | "vendorId" | "payee">>;

/** A key present with `undefined` means "clear it": JSON would drop it, so send null. */
function patchBody(patch: BankTxnPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, patch[k as keyof BankTxnPatch] ?? null]));
}

export const fetchBankTransactions = createAsyncThunk<{ transactions: BankTransactionDto[]; qbConnectionId: string }, void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchTransactions",
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const body = await bankFetch<{ transactions: BankTransactionDto[] }>(state, "/api/bank-transactions");
      return { ...body, qbConnectionId: state.quickBooks.qbConnectionId as string };
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const updateBankTransaction = createAsyncThunk<
  { transaction: BankTransactionDto },
  { id: string; patch: BankTxnPatch; version?: number; action?: string },
  { state: RootState; rejectValue: BankRequestError & { current?: BankTransactionDto } }
>("bankFeeds/updateTransaction", async ({ id, patch, version, action }, { getState, rejectWithValue }) => {
  const qbConnectionId = getState().quickBooks.qbConnectionId;
  try {
    const response = await authFetch(`/api/bank-transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-QB-Id": qbConnectionId ?? "" },
      body: JSON.stringify({ ...patchBody(patch), version, action }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return rejectWithValue({ message: body?.error || "Couldn't save that change.", status: response.status, reason: body?.reason, current: body?.current });
    }
    return body as { transaction: BankTransactionDto };
  } catch {
    return rejectWithValue({ message: "Couldn't save that change. Check your connection.", status: 0 });
  }
});

export const bulkUpdateBankTransactions = createAsyncThunk<
  { updated: BankTransactionDto[]; failed: { id: string; error: string }[] },
  { ids: string[]; patch: BankTxnPatch } | { items: ({ id: string } & BankTxnPatch)[] },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/bulkUpdate", async (args, { getState, rejectWithValue }) => {
  const items = "items" in args ? args.items.map((i) => ({ id: i.id, ...patchBody(i) })) : args.ids.map((id) => ({ id, ...patchBody(args.patch) }));
  try {
    return await bankFetch(getState(), "/api/bank-transactions/bulk", { method: "POST", body: JSON.stringify({ items }) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

export const importBankCsv = createAsyncThunk<
  { added: number; duplicates: number; transactions: BankTransactionDto[] },
  { accountName: string; rows: { date: string; description: string; amount: number }[] },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/importCsv", async (args, { getState, rejectWithValue }) => {
  try {
    return await bankFetch(getState(), "/api/bank-transactions/import", { method: "POST", body: JSON.stringify(args) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});
