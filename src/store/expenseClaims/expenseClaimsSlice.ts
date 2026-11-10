// Expense claims, mileage journeys and their settings for the company picked
// in the header.
//
// Not persisted: server-owned and scoped to one company. Each list remembers
// the company it was loaded for (`*ConnectionId`); the page treats a list
// loaded for another company as not loaded, so switching company never shows
// the previous company's claims. Two more guards keep a slow response from
// landing in the wrong place after a switch: a fetch only lands if it's the
// latest one for its list (`*RequestId`), and a change only lands in a list
// loaded for the company it was made in (the thunk's `meta.qbConnectionId`).
import { createSlice } from "@reduxjs/toolkit";

import {
  approveExpenseClaim,
  createExpenseClaim,
  deleteExpenseClaim,
  createJourney,
  deleteJourney,
  fetchExpenseClaims,
  fetchExpenseSettings,
  fetchJourneys,
  markExpenseClaimPaid,
  approveJourney,
  rejectJourney,
  markJourneyPaid,
  payJourney,
  rejectExpenseClaim,
  removeClaimReceipt,
  saveExpenseSettings,
  fetchClaimContacts,
  fetchClaimSummary,
  updateReceiptNote,
  payExpenseClaim,
  type ClaimContactDto,
  type ExpenseClaimDto,
  type ExpenseSettingsDto,
  type JourneyDto,
} from "./expenseClaimsApi";
import { isSessionBoundary } from "../sessionBoundary";

interface ExpenseClaimsState {
  claims: ExpenseClaimDto[];
  claimsConnectionId: string | null;
  claimsRequestId: string | null;
  claimsLoading: boolean;
  claimsError: string | null;

  journeys: JourneyDto[];
  journeysConnectionId: string | null;
  journeysRequestId: string | null;
  journeysLoading: boolean;
  journeysError: string | null;

  settings: ExpenseSettingsDto | null;
  settingsConnectionId: string | null;
  settingsRequestId: string | null;
  settingsLoading: boolean;
  settingsError: string | null;

  /** Claimants outside the team (approvers only; empty for contributors). */
  contacts: ClaimContactDto[];
  contactsConnectionId: string | null;
  contactsRequestId: string | null;

  /** Claims in review sent to the signed-in user (sidebar count). */
  assignedToMe: number;
  summaryConnectionId: string | null;
  summaryRequestId: string | null;
}

const initialState: ExpenseClaimsState = {
  claims: [],
  claimsConnectionId: null,
  claimsRequestId: null,
  claimsLoading: false,
  claimsError: null,
  journeys: [],
  journeysConnectionId: null,
  journeysRequestId: null,
  journeysLoading: false,
  journeysError: null,
  settings: null,
  settingsConnectionId: null,
  settingsRequestId: null,
  settingsLoading: false,
  settingsError: null,
  contacts: [],
  contactsConnectionId: null,
  contactsRequestId: null,
  assignedToMe: 0,
  summaryConnectionId: null,
  summaryRequestId: null,
};

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];

const claimChanged = [
  createExpenseClaim,
  approveExpenseClaim,
  rejectExpenseClaim,
  markExpenseClaimPaid,
  updateReceiptNote,
  payExpenseClaim,
] as const;

const expenseClaimsSlice = createSlice({
  name: "expenseClaims",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // ─── Claims ─────────────────────────────────────────────────────────────
    builder.addCase(fetchExpenseClaims.pending, (state, action) => {
      state.claimsRequestId = action.meta.requestId;
      state.claimsLoading = true;
      state.claimsError = null;
    });
    builder.addCase(fetchExpenseClaims.fulfilled, (state, action) => {
      if (action.meta.requestId !== state.claimsRequestId) return;
      state.claimsLoading = false;
      state.claims = action.payload.claims;
      state.claimsConnectionId = action.payload.qbConnectionId;
    });
    builder.addCase(fetchExpenseClaims.rejected, (state, action) => {
      if (action.meta.requestId !== state.claimsRequestId) return;
      state.claimsLoading = false;
      state.claimsError = action.payload?.message ?? "Couldn't load expense claims.";
      state.claims = [];
      state.claimsConnectionId = null;
    });

    for (const thunk of claimChanged) {
      builder.addCase(thunk.fulfilled, (state, action) => {
        if (action.meta.qbConnectionId !== state.claimsConnectionId) return;
        state.claims = upsert(state.claims, action.payload);
      });
    }
    builder.addCase(deleteExpenseClaim.fulfilled, (state, action) => {
      if (action.meta.qbConnectionId !== state.claimsConnectionId) return;
      state.claims = state.claims.filter((c) => c.id !== action.payload);
    });
    builder.addCase(removeClaimReceipt.fulfilled, (state, action) => {
      if (action.meta.qbConnectionId !== state.claimsConnectionId) return;
      const { claimId, claim } = action.payload;
      state.claims = claim ? upsert(state.claims, claim) : state.claims.filter((c) => c.id !== claimId);
    });

    // ─── Journeys ───────────────────────────────────────────────────────────
    builder.addCase(fetchJourneys.pending, (state, action) => {
      state.journeysRequestId = action.meta.requestId;
      state.journeysLoading = true;
      state.journeysError = null;
    });
    builder.addCase(fetchJourneys.fulfilled, (state, action) => {
      if (action.meta.requestId !== state.journeysRequestId) return;
      state.journeysLoading = false;
      state.journeys = action.payload.journeys;
      state.journeysConnectionId = action.payload.qbConnectionId;
    });
    builder.addCase(fetchJourneys.rejected, (state, action) => {
      if (action.meta.requestId !== state.journeysRequestId) return;
      state.journeysLoading = false;
      state.journeysError = action.payload?.message ?? "Couldn't load journeys.";
      state.journeys = [];
      state.journeysConnectionId = null;
    });
    for (const thunk of [createJourney, approveJourney, rejectJourney, markJourneyPaid, payJourney] as const) {
      builder.addCase(thunk.fulfilled, (state, action) => {
        if (action.meta.qbConnectionId !== state.journeysConnectionId) return;
        state.journeys = upsert(state.journeys, action.payload);
      });
    }
    builder.addCase(deleteJourney.fulfilled, (state, action) => {
      if (action.meta.qbConnectionId !== state.journeysConnectionId) return;
      state.journeys = state.journeys.filter((j) => j.id !== action.payload);
    });

    // ─── Settings ───────────────────────────────────────────────────────────
    builder.addCase(fetchExpenseSettings.pending, (state, action) => {
      state.settingsRequestId = action.meta.requestId;
      state.settingsLoading = true;
      state.settingsError = null;
    });
    builder.addCase(fetchExpenseSettings.fulfilled, (state, action) => {
      if (action.meta.requestId !== state.settingsRequestId) return;
      state.settingsLoading = false;
      state.settings = action.payload.settings;
      state.settingsConnectionId = action.payload.qbConnectionId;
    });
    builder.addCase(fetchExpenseSettings.rejected, (state, action) => {
      if (action.meta.requestId !== state.settingsRequestId) return;
      state.settingsLoading = false;
      state.settingsError = action.payload?.message ?? "Couldn't load expense settings.";
      state.settings = null;
      state.settingsConnectionId = null;
    });
    builder.addCase(saveExpenseSettings.fulfilled, (state, action) => {
      if (action.meta.qbConnectionId !== state.settingsConnectionId) return;
      state.settings = action.payload;
    });

    // ─── Contacts ───────────────────────────────────────────────────────────
    builder.addCase(fetchClaimContacts.pending, (state, action) => {
      state.contactsRequestId = action.meta.requestId;
    });
    builder.addCase(fetchClaimContacts.fulfilled, (state, action) => {
      if (action.meta.requestId !== state.contactsRequestId) return;
      state.contacts = action.payload.contacts;
      state.contactsConnectionId = action.payload.qbConnectionId;
    });
    builder.addCase(fetchClaimContacts.rejected, (state, action) => {
      if (action.meta.requestId !== state.contactsRequestId) return;
      state.contacts = [];
      state.contactsConnectionId = null;
    });

    // ─── Summary ────────────────────────────────────────────────────────────
    builder.addCase(fetchClaimSummary.pending, (state, action) => {
      state.summaryRequestId = action.meta.requestId;
    });
    builder.addCase(fetchClaimSummary.fulfilled, (state, action) => {
      if (action.meta.requestId !== state.summaryRequestId) return;
      state.assignedToMe = action.payload.assignedToMe;
      state.summaryConnectionId = action.payload.qbConnectionId;
    });

    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export default expenseClaimsSlice.reducer;
