import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";

// A company's team admin paying for the company owner's plan from the Team
// page (Scantrix_API /qb-connections/:qbId/billing). The plan is the owner's
// whole account — every company they own. The Team page keeps the results in
// its own state; nothing here is shared app-wide.

export type PaidPlanKey = "standard" | "enterprise";
export type BillingInterval = "monthly" | "yearly";

export interface TeamBilling {
  owner: { name: string | null; email: string | null };
  isOwner: boolean;
  plan: "trial" | PaidPlanKey;
  planName: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  billingInterval: BillingInterval | null;
  provider: "stripe" | "apple" | "google" | "manual" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  maxSlots: number;
  addonSlots: number;
  slotsUsed: number;
  /** The team admin who bought the owner's live plan, if one did. */
  paidBy: { name: string | null; isYou: boolean } | null;
  /** false while the owner already has a live paid plan. */
  canPay: boolean;
}

export interface TeamCheckoutInput {
  qbId: string;
  plan: PaidPlanKey;
  billingInterval: BillingInterval;
  /** Enterprise only. */
  addonSlots?: number;
  couponCode?: string;
}

type Rejection = { rejectValue: { message: string; code?: string } };
const reject = (error: any, fallback: string) => ({
  message: error?.response?.data?.message || error?.message || fallback,
  code: error?.response?.data?.data?.code,
});

export const fetchTeamBilling = createAsyncThunk<TeamBilling, string, Rejection>("teamBilling/fetch", async (qbId, thunkAPI) => {
  try {
    const response = await api.get(`/qb-connections/${qbId}/billing`);
    return response.data.data.billing as TeamBilling;
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not load the owner's plan"));
  }
});

/** Resolves to the Stripe Checkout url — the browser goes there. */
export const startTeamCheckout = createAsyncThunk<string, TeamCheckoutInput, Rejection>(
  "teamBilling/startCheckout",
  async ({ qbId, ...body }, thunkAPI) => {
    try {
      const response = await api.post(`/qb-connections/${qbId}/billing/checkout`, body);
      return response.data.data.url as string;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not start the payment"));
    }
  },
);

export interface TeamCheckoutResult {
  billing: TeamBilling;
  /** The payment hasn't cleared yet (3DS, a bank debit) — the plan updates once it does. */
  processing: boolean;
  message: string;
}

/** Right after Stripe sends the admin back — the webhook is the durable path. */
export const confirmTeamCheckout = createAsyncThunk<TeamCheckoutResult, { qbId: string; sessionId: string }, Rejection>(
  "teamBilling/confirmCheckout",
  async ({ qbId, sessionId }, thunkAPI) => {
    try {
      const response = await api.post(`/qb-connections/${qbId}/billing/confirm`, { sessionId });
      return { ...response.data.data, message: response.data.message } as TeamCheckoutResult;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not confirm the payment"));
    }
  },
);
