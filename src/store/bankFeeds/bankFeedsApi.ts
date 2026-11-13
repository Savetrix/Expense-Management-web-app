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
import type { MemoryVote } from "@/lib/suggestions/picks";

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

/** An account known only by name: a CSV import, or the other side of a hand-typed transfer. */
export interface NamedAccountDto {
  accountLabel: string;
  lines: number;
  mappedLedgerAccountId?: string;
  mappedLedgerAccountName?: string;
}

export const fetchBankAccounts = createAsyncThunk<{ accounts: BankAccountDto[]; named: NamedAccountDto[]; environment: string; qbConnectionId: string }, void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchAccounts",
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const body = await bankFetch<{ accounts: BankAccountDto[]; named?: NamedAccountDto[]; environment: string }>(state, "/api/bank-accounts");
      return { ...body, named: body.named ?? [], qbConnectionId: state.quickBooks.qbConnectionId as string };
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
  postingStatus?: "processing" | "posted" | "failed";
  /** The entry in QuickBooks/Xero once sent (or the last error). `found`: someone entered it there directly. */
  posting?: { kind: string; externalId: string | null; url: string | null; error: string | null; postedAt: string | null; viaTransactionId: string | null; found?: FoundEntryDto & { auto: boolean } };
  /** Entries already in QuickBooks/Xero that could be this line; a person picks. */
  ledgerCandidates?: FoundEntryDto[];
  decidedAt?: string;
  version: number;
}

/** An entry already in QuickBooks/Xero (an expense, deposit, transfer or payment). */
export interface FoundEntryDto {
  key: string;
  label: string;
  name: string | null;
  date: string;
  amount: number;
  url: string | null;
}

/**
 * Moves lines in To review that someone already entered straight into
 * QuickBooks/Xero to Matched (server: lib/bankFeeds/foundInLedger.ts).
 */
export const checkFoundInLedger = createAsyncThunk<
  { checked?: number; linked?: number; possible?: number; skipped?: boolean },
  void,
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/checkFoundInLedger", async (_, { getState, rejectWithValue }) => {
  try {
    return await bankFetch(getState(), "/api/bank-transactions/found-in-ledger", { method: "POST" });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

/** A person picks which entry already in QuickBooks/Xero is this line. */
export const linkFoundEntry = createAsyncThunk<{ transaction: BankTransactionDto }, { id: string; key: string }, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/linkFoundEntry",
  async ({ id, key }, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), `/api/bank-transactions/${encodeURIComponent(id)}/found`, { method: "POST", body: JSON.stringify({ key }) });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

/** "Not this": a line Scantrix found in QuickBooks/Xero goes back to To review. */
export const unlinkFoundEntry = createAsyncThunk<{ transaction: BankTransactionDto }, string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/unlinkFoundEntry",
  async (id, { getState, rejectWithValue }) => {
    try {
      return await bankFetch(getState(), `/api/bank-transactions/${encodeURIComponent(id)}/found`, { method: "DELETE" });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

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

/**
 * Of these bills (QuickBooks/Xero ids), the ones with nothing left to pay there.
 * The bank page stops offering them for a match; when this fails it offers all, as before.
 */
export const fetchPaidBills = createAsyncThunk<string[], string[], { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchPaidBills",
  async (billIds, { getState, rejectWithValue }) => {
    try {
      const body = await bankFetch<{ paid: string[] }>(getState(), "/api/bank-transactions/paid-bills", { method: "POST", body: JSON.stringify({ billIds }) });
      return Array.isArray(body.paid) ? body.paid : [];
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

// ---------------------------------------------------------------- accounting software

/** One account in the company's chart of accounts, in QuickBooks'/Xero's own ids. */
export interface LedgerAccountDto {
  id: string;
  name: string;
  kind: "bank" | "card" | "income" | "expense" | "other";
  type: string;
  currency: string | null;
}

export const fetchLedgerAccounts = createAsyncThunk<{ accounts: LedgerAccountDto[]; qbConnectionId: string }, void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/ledgerAccounts",
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const body = await bankFetch<{ accounts: LedgerAccountDto[] }>(state, "/api/ledger/accounts");
      return { accounts: body.accounts, qbConnectionId: state.quickBooks.qbConnectionId as string };
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const saveNamedMapping = createAsyncThunk<
  { named: NamedAccountDto[] },
  { accountLabel: string; ledgerAccountId: string; ledgerAccountName: string },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/namedMapping", async (body, { getState, rejectWithValue }) => {
  try {
    return await bankFetch(getState(), "/api/bank-accounts/named-mapping", { method: "PUT", body: JSON.stringify(body) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

export interface PostResultDto {
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
  transaction?: BankTransactionDto;
}

/** Sends decided lines to QuickBooks/Xero (at most 100 per call). */
export const postBankTransactions = createAsyncThunk<{ results: PostResultDto[] }, { ids: string[] }, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/post",
  async ({ ids }, { getState, rejectWithValue }) => {
    try {
      const results: PostResultDto[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const body = await bankFetch<{ results: PostResultDto[] }>(getState(), "/api/bank-transactions/post", { method: "POST", body: JSON.stringify({ ids: ids.slice(i, i + 100) }) });
        results.push(...body.results);
        if (body.results.some((r) => r.code && ["reconnect", "scope", "permission", "not_configured"].includes(r.code))) break;
      }
      return { results };
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

// ---------------------------------------------------------------- smart suggestions: company rules

export type SuggestionRuleMatch = "payee" | "description" | "category";
export type AutoClassification = "off" | "suggest" | "fill";

/** A company rule, "Always code Esso to Vehicle expense" (lib/bankFeeds/rules.ts RuleView). */
export interface SuggestionRuleDto {
  id: string;
  match: SuggestionRuleMatch;
  value: string;
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
  /** Its GL account is no longer active in QuickBooks/Xero, so it is skipped. */
  broken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionRuleInput {
  match: SuggestionRuleMatch;
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
}

/** `check` (the Rules tab) first marks rules whose GL account is gone. */
export const fetchSuggestionRules = createAsyncThunk<SuggestionRuleDto[], { check?: boolean } | void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchRules",
  async (args, { getState, rejectWithValue }) => {
    try {
      const body = await bankFetch<{ rules: SuggestionRuleDto[] }>(getState(), `/api/suggestion-rules${args?.check ? "?check=1" : ""}`);
      return body.rules;
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

/** Creates a rule (no id) or changes one. `filled` = lines to review it filled in (or, with Suggest only, suggested on). */
export const saveSuggestionRule = createAsyncThunk<
  { rule: SuggestionRuleDto; filled: number; autoClassification: AutoClassification },
  { id?: string; input: SuggestionRuleInput },
  { state: RootState; rejectValue: BankRequestError }
>("bankFeeds/saveRule", async ({ id, input }, { getState, rejectWithValue }) => {
  try {
    const path = id ? `/api/suggestion-rules/${encodeURIComponent(id)}` : "/api/suggestion-rules";
    return await bankFetch(getState(), path, { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
  } catch (e) {
    return rejectWithValue(reject(e));
  }
});

export const deleteSuggestionRule = createAsyncThunk<{ id: string }, string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/deleteRule",
  async (id, { getState, rejectWithValue }) => {
    try {
      await bankFetch(getState(), `/api/suggestion-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { id };
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

/** Smart Suggestions, step 2: what people coded this vendor's bank lines to (company memory). */
export const fetchVendorMemory = createAsyncThunk<MemoryVote[], string, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchVendorMemory",
  async (vendorId, { getState, rejectWithValue }) => {
    try {
      const body = await bankFetch<{ votes: MemoryVote[] }>(getState(), `/api/suggestions/vendor-memory?vendorId=${encodeURIComponent(vendorId)}`);
      return Array.isArray(body.votes) ? body.votes : [];
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export interface SuggestionSettingsDto {
  autoClassification: AutoClassification;
  /** Owner or Admin. */
  canChange: boolean;
}

export const fetchSuggestionSettings = createAsyncThunk<SuggestionSettingsDto, void, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/fetchSuggestionSettings",
  async (_, { getState, rejectWithValue }) => {
    try {
      return await bankFetch<SuggestionSettingsDto>(getState(), "/api/suggestion-settings");
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);

export const saveSuggestionSettings = createAsyncThunk<SuggestionSettingsDto, AutoClassification, { state: RootState; rejectValue: BankRequestError }>(
  "bankFeeds/saveSuggestionSettings",
  async (autoClassification, { getState, rejectWithValue }) => {
    try {
      return await bankFetch<SuggestionSettingsDto>(getState(), "/api/suggestion-settings", { method: "PUT", body: JSON.stringify({ autoClassification }) });
    } catch (e) {
      return rejectWithValue(reject(e));
    }
  },
);
