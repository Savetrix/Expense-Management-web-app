// Bank-feed state: the company's connected bank accounts.
//
// Not persisted: everything here is server-owned and cheap to re-read, and the
// list belongs to one company (`qbConnectionId`) — switching company in the
// header must never show the previous company's banks.
import { createSlice, isAnyOf } from "@reduxjs/toolkit";

import {
  bulkUpdateBankTransactions,
  completeBankRelogin,
  disconnectBankAccount,
  exchangePublicToken,
  fetchBankAccounts,
  fetchBankTransactions,
  fetchLedgerAccounts,
  importBankCsv,
  postBankTransactions,
  saveNamedMapping,
  updateBankTransaction,
  saveBankMapping,
  syncBankAccount,
  type BankAccountDto,
  type LedgerAccountDto,
  type NamedAccountDto,
  type BankTransactionDto,
} from "./bankFeedsApi";
import { isSessionBoundary } from "../sessionBoundary";

interface BankFeedsState {
  qbConnectionId: string | null;
  accounts: BankAccountDto[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** "not_configured" / "disabled" when the server has no bank feeds yet. */
  unavailableReason: string | null;
  environment: string | null;
  /** Account whose row is busy (sync, disconnect, mapping). */
  busyAccountId: string | null;
  transactions: BankTransactionDto[];
  transactionsLoading: boolean;
  transactionsLoaded: boolean;
  transactionsError: string | null;
  /** Company the transactions belong to. */
  transactionsConnectionId: string | null;
  /** Line state before an optimistic change, by request id, to roll back to. */
  rollback: Record<string, BankTransactionDto>;
  /** Accounts known only by name (CSV imports, hand-typed transfer accounts). */
  named: NamedAccountDto[];
  /** The company's chart of accounts in QuickBooks/Xero (bank, card, income...). */
  ledgerAccounts: LedgerAccountDto[];
  ledgerAccountsConnectionId: string | null;
  /** Why the chart couldn't load, e.g. "posting_not_configured", "scope", "reconnect". */
  ledgerReason: string | null;
  ledgerError: string | null;
  /** Lines being sent to QuickBooks/Xero right now. */
  postingIds: string[];
}

const initialState: BankFeedsState = {
  qbConnectionId: null,
  accounts: [],
  loading: false,
  loaded: false,
  error: null,
  unavailableReason: null,
  environment: null,
  busyAccountId: null,
  transactions: [],
  transactionsLoading: false,
  transactionsLoaded: false,
  transactionsError: null,
  transactionsConnectionId: null,
  rollback: {},
  named: [],
  ledgerAccounts: [],
  ledgerAccountsConnectionId: null,
  ledgerReason: null,
  ledgerError: null,
  postingIds: [],
};

function replaceRows(state: BankFeedsState, rows: BankTransactionDto[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  state.transactions = state.transactions.map((t) => byId.get(t.id) ?? t);
}

const rowThunks = [syncBankAccount, completeBankRelogin, disconnectBankAccount] as const;

const bankFeedsSlice = createSlice({
  name: "bankFeeds",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchBankAccounts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBankAccounts.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.accounts = action.payload.accounts;
        state.named = action.payload.named;
        state.environment = action.payload.environment;
        state.qbConnectionId = action.payload.qbConnectionId;
        state.unavailableReason = null;
      })
      .addCase(fetchBankAccounts.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.accounts = [];
        state.error = action.payload?.message ?? "Couldn't load bank accounts.";
        state.unavailableReason = action.payload?.status === 503 ? (action.payload.reason ?? "unavailable") : null;
      })
      .addCase(saveBankMapping.pending, (state, action) => {
        state.busyAccountId = action.meta.arg.accountId;
      })
      .addCase(fetchBankTransactions.pending, (state) => {
        state.transactionsLoading = true;
        state.transactionsError = null;
      })
      .addCase(fetchBankTransactions.fulfilled, (state, action) => {
        state.transactionsLoading = false;
        state.transactionsLoaded = true;
        state.transactions = action.payload.transactions;
        state.transactionsConnectionId = action.payload.qbConnectionId;
      })
      .addCase(fetchBankTransactions.rejected, (state, action) => {
        state.transactionsLoading = false;
        state.transactionsLoaded = true;
        state.transactions = [];
        state.transactionsError = action.payload?.message ?? "Couldn't load transactions.";
      })
      // Optimistic: show the change at once, then take the server's row.
      .addCase(updateBankTransaction.pending, (state, action) => {
        const row = state.transactions.find((t) => t.id === action.meta.arg.id);
        if (!row) return;
        state.rollback[action.meta.requestId] = { ...row };
        Object.assign(row, action.meta.arg.patch);
      })
      .addCase(updateBankTransaction.fulfilled, (state, action) => {
        delete state.rollback[action.meta.requestId];
        replaceRows(state, [action.payload.transaction]);
      })
      .addCase(updateBankTransaction.rejected, (state, action) => {
        const before = state.rollback[action.meta.requestId];
        delete state.rollback[action.meta.requestId];
        const current = action.payload?.current;
        if (current) replaceRows(state, [current]);
        else if (before) replaceRows(state, [before]);
      })
      .addCase(bulkUpdateBankTransactions.fulfilled, (state, action) => {
        replaceRows(state, action.payload.updated);
      })
      .addCase(importBankCsv.fulfilled, (state, action) => {
        state.transactions = action.payload.transactions;
      })
      .addCase(fetchLedgerAccounts.fulfilled, (state, action) => {
        state.ledgerAccounts = action.payload.accounts;
        state.ledgerAccountsConnectionId = action.payload.qbConnectionId;
        state.ledgerReason = null;
        state.ledgerError = null;
      })
      .addCase(fetchLedgerAccounts.rejected, (state, action) => {
        state.ledgerAccounts = [];
        state.ledgerReason = action.payload?.reason ?? "unavailable";
        state.ledgerError = action.payload?.message ?? null;
      })
      .addCase(saveNamedMapping.fulfilled, (state, action) => {
        state.named = action.payload.named;
      })
      .addCase(postBankTransactions.pending, (state, action) => {
        state.postingIds = [...new Set([...state.postingIds, ...action.meta.arg.ids])];
      })
      .addCase(postBankTransactions.fulfilled, (state, action) => {
        const done = new Set(action.meta.arg.ids);
        state.postingIds = state.postingIds.filter((id) => !done.has(id));
        replaceRows(state, action.payload.results.flatMap((r) => (r.transaction ? [r.transaction] : [])));
      })
      .addCase(postBankTransactions.rejected, (state, action) => {
        const done = new Set(action.meta.arg.ids);
        state.postingIds = state.postingIds.filter((id) => !done.has(id));
      });
    for (const thunk of rowThunks) {
      builder.addCase(thunk.pending, (state, action) => {
        state.busyAccountId = action.meta.arg;
      });
    }
    builder
      .addMatcher(
        isAnyOf(
          exchangePublicToken.fulfilled,
          syncBankAccount.fulfilled,
          completeBankRelogin.fulfilled,
          disconnectBankAccount.fulfilled,
          saveBankMapping.fulfilled,
        ),
        (state, action) => {
          state.accounts = action.payload.accounts;
          state.busyAccountId = null;
        },
      )
      .addMatcher(isAnyOf(syncBankAccount.rejected, completeBankRelogin.rejected, disconnectBankAccount.rejected, saveBankMapping.rejected), (state) => {
        state.busyAccountId = null;
      })
      .addMatcher(isSessionBoundary, () => initialState);
  },
});

export default bankFeedsSlice.reducer;
