import { createSlice } from "@reduxjs/toolkit";
import { fetchPlans, fetchMySubscription, choosePlan, startCheckout, openBillingPortal, confirmCheckout } from "./subscriptionApi";
import { isSessionBoundary } from "../sessionBoundary";

export interface PlanCatalogEntry {
  key: "trial" | "standard" | "enterprise";
  name: string;
  maxSlots: number;
  trialDays?: number;
  prices: { monthly: number; yearly: number } | null;
}

export interface SubscriptionSlot {
  qbConnectionId: string;
  name: string;
  realmId: string;
  locked: boolean;
  lockedAt: string | null;
  unlockAt: string | null;
}

export interface MySubscription {
  plan: "trial" | "standard" | "enterprise";
  planName: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  billingInterval: "monthly" | "yearly" | null;
  // "stripe" = real, paid web subscription (see stripe.service.js). "manual"
  // (or null) = the free/admin-driven flow. Both use the same currentPeriod/
  // downgradeAvailableAt cycle math below — no special-casing needed.
  provider: "stripe" | "apple" | "google" | "manual" | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  billingAnchor: string | null;
  currentPeriod: { start: string; end: string } | null;
  lockCycle: { start: string; end: string } | null;
  downgradeAvailableAt: string | null;
  maxSlots: number;
  slotsUsed: number;
  slots: SubscriptionSlot[];
}

interface SubscriptionState {
  plans: PlanCatalogEntry[];
  plansLoading: boolean;
  plansError: string | null;

  subscription: MySubscription | null;
  subscriptionLoading: boolean;
  subscriptionError: string | null;
  // Only the most recently started fetch may write — a forced fetch can run
  // alongside an older one, and the older response must not land last.
  latestSubscriptionRequestId: string | null;

  choosingPlan: boolean;
  checkingOut: boolean;
  openingPortal: boolean;
}

const initialState: SubscriptionState = {
  plans: [],
  plansLoading: false,
  plansError: null,

  subscription: null,
  subscriptionLoading: false,
  subscriptionError: null,
  latestSubscriptionRequestId: null,

  choosingPlan: false,
  checkingOut: false,
  openingPortal: false,
};

const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPlans.pending, (state) => {
        state.plansLoading = true;
        state.plansError = null;
      })
      .addCase(fetchPlans.fulfilled, (state, action) => {
        state.plansLoading = false;
        state.plans = action.payload?.data?.plans ?? [];
      })
      .addCase(fetchPlans.rejected, (state, action) => {
        state.plansLoading = false;
        const payload = action.payload as { message?: string } | undefined;
        state.plansError = payload?.message || "Failed to fetch plans";
      });

    builder
      .addCase(fetchMySubscription.pending, (state, action) => {
        state.subscriptionLoading = true;
        state.subscriptionError = null;
        state.latestSubscriptionRequestId = action.meta?.requestId ?? null;
      })
      .addCase(fetchMySubscription.fulfilled, (state, action) => {
        if (action.meta?.requestId && action.meta.requestId !== state.latestSubscriptionRequestId) return;
        state.subscriptionLoading = false;
        state.subscription = action.payload?.data ?? null;
      })
      .addCase(fetchMySubscription.rejected, (state, action) => {
        if (action.meta?.requestId && action.meta.requestId !== state.latestSubscriptionRequestId) return;
        state.subscriptionLoading = false;
        const payload = action.payload as { message?: string } | undefined;
        state.subscriptionError = payload?.message || "Failed to fetch subscription";
      });

    builder
      .addCase(choosePlan.pending, (state) => {
        state.choosingPlan = true;
      })
      .addCase(choosePlan.fulfilled, (state) => {
        state.choosingPlan = false;
        // Caller re-dispatches fetchMySubscription for the authoritative
        // post-switch state (slots/lock/period) rather than hand-merging the
        // choose-plan response shape into MySubscription here.
      })
      .addCase(choosePlan.rejected, (state) => {
        state.choosingPlan = false;
      });

    builder
      .addCase(startCheckout.pending, (state) => {
        state.checkingOut = true;
      })
      .addCase(startCheckout.fulfilled, (state) => {
        state.checkingOut = false;
        // No state to merge — the browser redirects to Stripe next, away
        // from this app entirely.
      })
      .addCase(startCheckout.rejected, (state) => {
        state.checkingOut = false;
      });

    builder
      .addCase(openBillingPortal.pending, (state) => {
        state.openingPortal = true;
      })
      .addCase(openBillingPortal.fulfilled, (state) => {
        state.openingPortal = false;
      })
      .addCase(openBillingPortal.rejected, (state) => {
        state.openingPortal = false;
      });

    builder
      .addCase(confirmCheckout.fulfilled, () => {
        // Caller re-dispatches fetchMySubscription for the authoritative
        // post-checkout state, same pattern as choosePlan above.
      })
      .addCase(confirmCheckout.rejected, () => {
        // Caller (SubscriptionStatusContent) shows an error toast directly
        // from the rejected action's payload — no slice-level error state
        // needed since this only ever runs once, right after redirect.
      });

    // See sessionBoundary.ts — plan/subscription/billing-slot data is
    // account-scoped and must not survive into the next session on a
    // shared browser.
    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export default subscriptionSlice.reducer;
