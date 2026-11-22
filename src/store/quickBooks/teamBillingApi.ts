import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";

// The company owner's plan from the Team page (Scantrix_API
// /qb-connections/:qbId/billing). The owner and every team admin of the
// company manage it there like the owner on their Subscription page: buy one,
// upgrade or move down, extra slots, cancel/resume, pay with their own card,
// invoices. The plan is the owner's whole account — every company they own.
// The Team page keeps the results in its own state; nothing here is shared
// app-wide.

export type PaidPlanKey = "standard" | "enterprise";
export type BillingInterval = "monthly" | "yearly";

export interface PlanCard {
  brand: string;
  last4: string;
}

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
  /** A removal waiting for the period end: the extra-slot count from then on. */
  addonSlotsNext: number | null;
  addonSlotsNextAt: string | null;
  /** Enterprise's extra slots (null on a plan without them). */
  addon: { maxSlots: number; prices: Record<BillingInterval, number>; purchasable: boolean } | null;
  slotsUsed: number;
  /** The team admin whose card pays for the plan now; null = the owner's own card. */
  paidBy: { name: string | null; isYou: boolean } | null;
  /** No live plan on a payment gateway — a new one can be bought (Checkout). */
  canPay: boolean;
  /** A live web (Stripe) plan this page can change. */
  canManage: boolean;
  /** The card renewals and changes are charged to. */
  card: (PlanCard & { expMonth: number; expYear: number }) | null;
  /** The plan stops at this date (cancelled, or the paying admin left with no card behind). */
  endsAt: string | null;
  /** A move down waiting for the period end. */
  scheduledChange: { plan: PaidPlanKey; planName: string; billingInterval: BillingInterval; addonSlots: number; at: string } | null;
  /** A charge waiting on the bank (3DS) or a failed renewal. */
  paymentPending: { hostedInvoiceUrl: string | null } | null;
  /** A paying admin who left the team — their card came off the plan. */
  payerLeft: { name: string | null } | null;
  /** Stripe didn't answer: card / schedule details are missing for now. */
  stripeUnavailable: boolean;
}

export interface TeamCheckoutInput {
  qbId: string;
  plan: PaidPlanKey;
  billingInterval: BillingInterval;
  /** Enterprise only. */
  addonSlots?: number;
  couponCode?: string;
}

export interface TeamBillingError {
  message: string;
  statusCode?: number;
  /** PRICE_CHANGED, PAYMENT_ACTION_REQUIRED, SCHEDULED_CHANGE, ADDON_REMOVAL_PENDING, COUPON_INVALID, … */
  code?: string;
  /** Stripe's invoice page, when a charge needs the bank (3DS) or failed. */
  hostedInvoiceUrl?: string | null;
  /** ADDON_REMOVAL_PENDING: the paid slots to keep before adding more. */
  keepQuantity?: number;
}

type Rejection = { rejectValue: TeamBillingError };
const reject = (error: any, fallback: string): TeamBillingError => ({
  message: error?.response?.data?.message || error?.message || fallback,
  statusCode: error?.response?.status,
  code: error?.response?.data?.data?.code,
  hostedInvoiceUrl: error?.response?.data?.data?.hostedInvoiceUrl ?? null,
  keepQuantity: error?.response?.data?.data?.keepQuantity,
});

const path = (qbId: string, rest = "") => `/qb-connections/${qbId}/billing${rest}`;
// Changes make a few Stripe calls — longer than the client's 30s default, so
// a slow Stripe isn't reported as a failure for a card it goes on to charge.
const CHANGE_TIMEOUT = { timeout: 60_000 };

/** A change's answer: the server's message, the card's fresh billing, and what it charged (if anything). */
export interface TeamBillingChange {
  message: string;
  billing: TeamBilling;
  charge: { amount: number; currency: string; receiptUrl: string | null } | null;
}
const changeResult = (response: any): TeamBillingChange => ({
  message: response.data.message as string,
  billing: response.data.data.billing as TeamBilling,
  charge: response.data.data?.charge ?? response.data.data?.paid ?? null,
});

export const fetchTeamBilling = createAsyncThunk<TeamBilling, string, Rejection>("teamBilling/fetch", async (qbId, thunkAPI) => {
  try {
    const response = await api.get(path(qbId));
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
      const response = await api.post(path(qbId, "/checkout"), body);
      return response.data.data.url as string;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not start the payment"));
    }
  },
);

/** Right after Stripe sends the admin back — the webhook is the durable path. */
export interface TeamCheckoutConfirmation {
  billing: TeamBilling;
  /** The payment hasn't cleared yet (3DS, a bank debit) — the plan updates once it does. */
  processing: boolean;
  message: string;
}

export const confirmTeamCheckout = createAsyncThunk<TeamCheckoutConfirmation, { qbId: string; sessionId: string }, Rejection>(
  "teamBilling/confirmCheckout",
  async ({ qbId, sessionId }, thunkAPI) => {
    try {
      const response = await api.post(path(qbId, "/confirm"), { sessionId });
      const { billing, processing } = response.data.data;
      return { billing: billing as TeamBilling, processing: !!processing, message: response.data.message as string };
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not confirm the payment"));
    }
  },
);

// ---- Changing the plan --------------------------------------------------

export interface TeamPlanChangeInput {
  plan: PaidPlanKey;
  billingInterval: BillingInterval;
  couponCode?: string;
}

interface PlanChangeCommon {
  plan: PaidPlanKey;
  planName: string;
  billingInterval: BillingInterval;
  currentPlan: PaidPlanKey;
  currentBillingInterval: BillingInterval;
  currency: string;
  /** The card a charge goes to (no payment page opens). */
  paymentMethod: PlanCard | null;
  planListPrice: number;
  /** The plan's price on each renewal, after a coupon that keeps applying. */
  planRenewal: number;
  extraSlots: number;
  extraSlotsPrice: number;
  renewalAmount: number;
  renewalDate: string;
  slotsAfter: number;
}

/** Bigger plan or yearly billing: charged now, prorated. */
export interface TeamUpgradePreview extends PlanChangeCommon {
  kind: "upgrade";
  amountDueNow: number;
  discountNow: number;
  /** Send back with the change — it's charged at exactly amountDueNow. */
  prorationDate: number;
  coupon: { code: string; description: string } | null;
}

/** Smaller plan or monthly billing: from the period end, nothing charged now. */
export interface TeamDowngradePreview extends PlanChangeCommon {
  kind: "downgrade";
  amountDueNow: 0;
  effectiveAt: string;
  /** Extra slots the move drops (a plan without them). */
  extraSlotsDropped: number;
}

export type TeamPlanChangePreview = TeamUpgradePreview | TeamDowngradePreview;

export const previewTeamPlanChange = createAsyncThunk<TeamPlanChangePreview, TeamPlanChangeInput & { qbId: string }, Rejection>(
  "teamBilling/previewPlanChange",
  async ({ qbId, ...params }, thunkAPI) => {
    try {
      const response = await api.get(path(qbId, "/change-plan/preview"), { params });
      return response.data.data as TeamPlanChangePreview;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not price this plan change"));
    }
  },
);

export const changeTeamPlan = createAsyncThunk<
  TeamBillingChange,
  TeamPlanChangeInput & { qbId: string; prorationDate?: number; expectedAmountDue?: number },
  Rejection
>("teamBilling/changePlan", async ({ qbId, ...body }, thunkAPI) => {
  try {
    return changeResult(await api.post(path(qbId, "/change-plan"), body, CHANGE_TIMEOUT));
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not change the plan"));
  }
});

export const cancelTeamScheduledChange = createAsyncThunk<TeamBillingChange, string, Rejection>(
  "teamBilling/cancelScheduledChange",
  async (qbId, thunkAPI) => {
    try {
      return changeResult(await api.delete(path(qbId, "/scheduled-change"), CHANGE_TIMEOUT));
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not cancel the scheduled change"));
    }
  },
);

// ---- Extra slots -----------------------------------------------------------

export interface TeamAddonSlotsPreview {
  quantity: number;
  currentAddonSlots: number;
  /** Charged right away to the plan's card, for the rest of the period. 0 for a removal. */
  amountDueNow: number;
  fullPeriodAmount: number;
  currency: string;
  paymentMethod: PlanCard | null;
  planPrice: number;
  addonPrice: number;
  renewalDiscounted: boolean;
  renewalDate: string;
  /** Send back to buy at exactly amountDueNow. null when nothing is charged. */
  prorationDate: number | null;
  renewalAmount: number;
  billingInterval: BillingInterval;
  /** When the new count applies — a removal waits for the period end. */
  effectiveAt: string;
}

export const previewTeamAddonSlots = createAsyncThunk<TeamAddonSlotsPreview, { qbId: string; quantity: number }, Rejection>(
  "teamBilling/previewAddonSlots",
  async ({ qbId, quantity }, thunkAPI) => {
    try {
      const response = await api.get(path(qbId, "/addon-slots/preview"), { params: { quantity } });
      return response.data.data as TeamAddonSlotsPreview;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not price extra slots"));
    }
  },
);

export const setTeamAddonSlots = createAsyncThunk<
  TeamBillingChange,
  { qbId: string; quantity: number; prorationDate?: number | null; expectedAmountDue?: number },
  Rejection
>("teamBilling/setAddonSlots", async ({ qbId, ...body }, thunkAPI) => {
  try {
    return changeResult(await api.post(path(qbId, "/addon-slots"), body, CHANGE_TIMEOUT));
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not update extra slots"));
  }
});

// ---- Cancel / resume, card, invoices ---------------------------------------

/** cancel: stop at the period end; false resumes it. */
export const setTeamCancellation = createAsyncThunk<TeamBillingChange, { qbId: string; cancel: boolean }, Rejection>(
  "teamBilling/setCancellation",
  async ({ qbId, cancel }, thunkAPI) => {
    try {
      return changeResult(await api.post(path(qbId, cancel ? "/cancel" : "/resume"), {}, CHANGE_TIMEOUT));
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, cancel ? "Could not cancel the plan" : "Could not resume the plan"));
    }
  },
);

/** Resolves to Stripe's page for entering a card — the browser goes there. */
export const startTeamCardSetup = createAsyncThunk<string, string, Rejection>("teamBilling/startCardSetup", async (qbId, thunkAPI) => {
  try {
    const response = await api.post(path(qbId, "/card/setup"), {});
    return response.data.data.url as string;
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not open the card page"));
  }
});

/** Back from that page: the card pays for the plan from now (an overdue invoice too). */
export const confirmTeamCardSetup = createAsyncThunk<TeamBillingChange, { qbId: string; sessionId: string }, Rejection>(
  "teamBilling/confirmCardSetup",
  async ({ qbId, sessionId }, thunkAPI) => {
    try {
      return changeResult(await api.post(path(qbId, "/card/confirm"), { sessionId }, CHANGE_TIMEOUT));
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not put the card on the plan"));
    }
  },
);

export interface PlanInvoice {
  id: string;
  number: string | null;
  date: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: "open" | "paid" | "uncollectible" | "void";
  /** Stripe's page for it (pay / download). */
  url: string | null;
}

export const fetchTeamInvoices = createAsyncThunk<PlanInvoice[], string, Rejection>("teamBilling/fetchInvoices", async (qbId, thunkAPI) => {
  try {
    const response = await api.get(path(qbId, "/invoices"));
    return response.data.data.invoices as PlanInvoice[];
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not load the invoices"));
  }
});
