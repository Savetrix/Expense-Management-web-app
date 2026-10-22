import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";
import { RootState } from "..";

// ================================
// GET PLANS (public catalog)
// ================================
export const fetchPlans = createAsyncThunk("subscription/fetchPlans", async (_: void, thunkAPI) => {
  try {
    console.log("========== FETCH PLANS REQUEST ==========");
    const response = await api.get("/subscription/plans");
    console.log("========== FETCH PLANS SUCCESS ==========");
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: any) {
    console.log("========== FETCH PLANS ERROR ==========");
    const message =
      error?.response?.data?.message || error?.response?.data?.error || error?.message || "Failed to fetch plans";
    return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
  }
});

// ================================
// GET MY SUBSCRIPTION
// ================================
export interface FetchMySubscriptionOptions {
  /** Bypass the in-flight dedup: a fetch already running may have started
   *  before a change (e.g. a just-confirmed checkout) and return stale data. */
  force?: boolean;
}

export const fetchMySubscription = createAsyncThunk(
  "subscription/fetchMySubscription",
  // Options are read by `condition` below, not here.
  async (_options: FetchMySubscriptionOptions | void, thunkAPI) => {
    try {
      console.log("========== FETCH MY SUBSCRIPTION REQUEST ==========");
      const response = await api.get("/subscription");
      console.log("========== FETCH MY SUBSCRIPTION SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== FETCH MY SUBSCRIPTION ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to fetch subscription";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
    }
  },
  {
    // AppShell's mount effect is the only automatic caller — this only
    // double-fires under React Strict Mode's dev-only double-invoke of
    // mount effects. The various onFocus/retry-button callers elsewhere
    // (SubscriptionStatusContentV2 etc.) all fire well after the initial
    // fetch has settled, so gating on the in-flight flag doesn't block them.
    condition: (options, { getState }) =>
      Boolean(options?.force) || !(getState() as RootState).subscription.subscriptionLoading,
  },
);

// ================================
// CHOOSE PLAN
// ================================
export type SubscriptionPlanKey = "standard" | "enterprise";
export type BillingInterval = "monthly" | "yearly";

interface ChoosePlanPayload {
  plan: SubscriptionPlanKey;
  billingInterval: BillingInterval;
}

export const choosePlan = createAsyncThunk(
  "subscription/choosePlan",
  async (data: ChoosePlanPayload, thunkAPI) => {
    try {
      console.log("========== CHOOSE PLAN REQUEST ==========");
      console.log("POST /subscription/choose-plan", data);
      const response = await api.post("/subscription/choose-plan", data);
      console.log("========== CHOOSE PLAN SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== CHOOSE PLAN ERROR ==========");
      const message =
        error?.response?.data?.message || error?.response?.data?.error || error?.message || "Failed to switch plan";
      const code = error?.response?.data?.data?.code;
      const renewsAt = error?.response?.data?.data?.renewsAt;
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status, code, renewsAt });
    }
  },
);

// ================================
// STRIPE CHECKOUT (real payment — first-time subscribe / no active Stripe subscription yet)
// ================================
export const startCheckout = createAsyncThunk(
  "subscription/startCheckout",
  // couponCode: one checked with validateCoupon — Stripe applies it at Checkout.
  async (data: ChoosePlanPayload & { couponCode?: string }, thunkAPI) => {
    try {
      console.log("========== STRIPE CHECKOUT REQUEST ==========");
      const response = await api.post("/subscription/checkout", data);
      console.log("========== STRIPE CHECKOUT SUCCESS ==========");
      return response.data;
    } catch (error: any) {
      console.log("========== STRIPE CHECKOUT ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to start checkout";
      // code "COUPON_INVALID" = the coupon can't be used (any more).
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status, code: error?.response?.data?.data?.code });
    }
  },
);

// ================================
// COUPON (checked before Checkout, so the plans show the discounted price)
// ================================
export interface AppliedCoupon {
  code: string;
  percentOff: number;
  /** once = first payment only, repeating = durationInMonths, forever = every payment */
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
  /** e.g. "5% off your first payment" */
  description: string;
}

/** checkout = used when starting a plan; plan_change = used when upgrading a running Stripe subscription. */
export type CouponMode = "checkout" | "plan_change";

export const validateCoupon = createAsyncThunk<
  { coupon: AppliedCoupon; mode: CouponMode },
  string,
  { rejectValue: { message: string } }
>(
  "subscription/validateCoupon",
  async (code, thunkAPI) => {
    try {
      const response = await api.post("/subscription/coupon/validate", { code });
      return { coupon: response.data.data.coupon as AppliedCoupon, mode: response.data.data.mode as CouponMode };
    } catch (error: any) {
      return thunkAPI.rejectWithValue({
        message: error?.response?.data?.message || error?.message || "Could not check this coupon",
      });
    }
  },
);

// ================================
// STRIPE BILLING PORTAL (manage/cancel/switch plan for an existing Stripe subscription)
// ================================
export const openBillingPortal = createAsyncThunk(
  "subscription/openBillingPortal",
  async (_: void, thunkAPI) => {
    try {
      console.log("========== STRIPE BILLING PORTAL REQUEST ==========");
      const response = await api.post("/subscription/billing-portal");
      console.log("========== STRIPE BILLING PORTAL SUCCESS ==========");
      return response.data;
    } catch (error: any) {
      console.log("========== STRIPE BILLING PORTAL ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to open billing portal";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
    }
  },
);

// ================================
// CONFIRM CHECKOUT (called right after Stripe redirects back to success_url,
// for an immediate update instead of waiting on the async webhook)
// ================================
export const confirmCheckout = createAsyncThunk(
  "subscription/confirmCheckout",
  async (sessionId: string, thunkAPI) => {
    try {
      console.log("========== CONFIRM CHECKOUT REQUEST ==========");
      const response = await api.post("/subscription/confirm-checkout", { sessionId });
      console.log("========== CONFIRM CHECKOUT SUCCESS ==========");
      return response.data;
    } catch (error: any) {
      console.log("========== CONFIRM CHECKOUT ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to confirm checkout";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
    }
  },
);

// ================================
// EXTRA SLOTS (Enterprise add-on on the Stripe subscription)
// quantity is always the new TOTAL of extra slots, not a delta.
// ================================
export interface SavedCard {
  brand: string;
  last4: string;
}

export interface AddonSlotsPreview {
  quantity: number;
  currentAddonSlots: number;
  /** Charged right away to the saved card, for the rest of the period. 0 for a removal. */
  amountDueNow: number;
  /** The new slots' price for a whole period — amountDueNow is below it only when prorated. */
  fullPeriodAmount: number;
  currency: string;
  /** The card the charge goes to (no payment page opens). null if none is on file. */
  paymentMethod: SavedCard | null;
  /** What renewalAmount is made of: the plan (after any coupon still running) + extra slots (list price). */
  planPrice: number;
  addonPrice: number;
  /** A coupon lowers the next renewal's plan price. */
  renewalDiscounted: boolean;
  /** End of the current period = the next renewal. */
  renewalDate: string;
  /** The moment the charge was priced at — send it back to buy at exactly amountDueNow. null when nothing is charged. */
  prorationDate: number | null;
  /** List price of every renewal from the next period on (plan + extra slots). */
  renewalAmount: number;
  billingInterval: BillingInterval;
  /** When the new count applies — a removal waits for the period end. */
  effectiveAt: string;
}

interface AddonSlotsError {
  message: string;
  statusCode?: number;
  /** e.g. PAYMENT_ACTION_REQUIRED, PRICE_CHANGED, ADDON_REMOVAL_PENDING */
  code?: string;
  /** Stripe's invoice page, when the charge needs the customer (3DS / declined card). */
  hostedInvoiceUrl?: string | null;
}

const addonSlotsError = (error: any, fallback: string): AddonSlotsError => ({
  message: error?.response?.data?.message || error?.message || fallback,
  statusCode: error?.response?.status,
  code: error?.response?.data?.data?.code,
  hostedInvoiceUrl: error?.response?.data?.data?.hostedInvoiceUrl ?? null,
});

export const previewAddonSlots = createAsyncThunk<AddonSlotsPreview, number, { rejectValue: AddonSlotsError }>(
  "subscription/previewAddonSlots",
  async (quantity, thunkAPI) => {
    try {
      const response = await api.get("/subscription/addon-slots/preview", { params: { quantity } });
      return response.data.data as AddonSlotsPreview;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(addonSlotsError(error, "Failed to price extra slots"));
    }
  },
);

export interface AddonSlotsCharge {
  amount: number;
  currency: string;
  /** Stripe's page for the paid invoice. */
  receiptUrl: string | null;
  paymentMethod: SavedCard | null;
}

export interface UpdateAddonSlotsArgs {
  quantity: number;
  /** From the preview the customer confirmed — a purchase is charged exactly amountDueNow. */
  prorationDate?: number | null;
  expectedAmountDue?: number;
}

export const updateAddonSlots = createAsyncThunk<
  { message: string; charge: AddonSlotsCharge | null },
  UpdateAddonSlotsArgs,
  { rejectValue: AddonSlotsError }
>(
  "subscription/updateAddonSlots",
  async (args, thunkAPI) => {
    try {
      // Longer than the client's 30s default: a purchase makes a few Stripe
      // calls, and giving up early would report a failure for a card the
      // server goes on to charge.
      const response = await api.post("/subscription/addon-slots", args, { timeout: 60_000 });
      return { message: response.data.message as string, charge: response.data.data?.charge ?? null };
    } catch (error: any) {
      return thunkAPI.rejectWithValue(addonSlotsError(error, "Failed to update extra slots"));
    }
  },
);

// ================================
// IN-APP UPGRADE (existing Stripe subscriber → bigger plan or yearly billing).
// Moving down stays in the Billing Portal (the preview answers USE_BILLING_PORTAL).
// ================================
export interface PlanChangeInput {
  plan: SubscriptionPlanKey;
  billingInterval: BillingInterval;
  couponCode?: string;
}

export interface PlanChangePreview {
  plan: SubscriptionPlanKey;
  planName: string;
  billingInterval: BillingInterval;
  /** Charged now to the saved card: the change, prorated, after any coupon. */
  amountDueNow: number;
  /** What the coupon takes off that charge. */
  discountNow: number;
  /** Send back with the purchase — it's charged at exactly amountDueNow. */
  prorationDate: number;
  currency: string;
  paymentMethod: SavedCard | null;
  coupon: AppliedCoupon | null;
  planListPrice: number;
  /** The plan's price on each renewal, after a coupon that keeps applying. */
  planRenewal: number;
  extraSlots: number;
  extraSlotsPrice: number;
  renewalAmount: number;
  renewalDate: string;
  slotsAfter: number;
}

interface PlanChangeError {
  message: string;
  statusCode?: number;
  /** USE_BILLING_PORTAL, PRICE_CHANGED, PAYMENT_ACTION_REQUIRED, COUPON_INVALID, … */
  code?: string;
  hostedInvoiceUrl?: string | null;
}

const planChangeError = (error: any, fallback: string): PlanChangeError => ({
  message: error?.response?.data?.message || error?.message || fallback,
  statusCode: error?.response?.status,
  code: error?.response?.data?.data?.code,
  hostedInvoiceUrl: error?.response?.data?.data?.hostedInvoiceUrl ?? null,
});

export const previewPlanChange = createAsyncThunk<PlanChangePreview, PlanChangeInput, { rejectValue: PlanChangeError }>(
  "subscription/previewPlanChange",
  async (input, thunkAPI) => {
    try {
      const response = await api.get("/subscription/change-plan/preview", { params: input });
      return response.data.data as PlanChangePreview;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(planChangeError(error, "Could not price this plan change"));
    }
  },
);

export const changePlan = createAsyncThunk<
  { message: string; charge: AddonSlotsCharge | null },
  PlanChangeInput & { prorationDate: number; expectedAmountDue: number },
  { rejectValue: PlanChangeError }
>("subscription/changePlan", async (body, thunkAPI) => {
  try {
    // A few Stripe calls — longer than the client's 30s default, so a slow
    // Stripe isn't reported as a failure for a card it goes on to charge.
    const response = await api.post("/subscription/change-plan", body, { timeout: 60_000 });
    return { message: response.data.message as string, charge: response.data.data?.charge ?? null };
  } catch (error: any) {
    return thunkAPI.rejectWithValue(planChangeError(error, "Could not change your plan"));
  }
});

// The coupon on the user's subscription right now (null when none).
export interface CurrentDiscount {
  code: string | null;
  percentOff: number | null;
  description: string;
  /** null = every payment */
  endsAt: string | null;
}

export const fetchDiscount = createAsyncThunk<CurrentDiscount | null, void, { rejectValue: { message: string } }>(
  "subscription/fetchDiscount",
  async (_, thunkAPI) => {
    try {
      const response = await api.get("/subscription/discount");
      return (response.data.data.discount ?? null) as CurrentDiscount | null;
    } catch (error: any) {
      return thunkAPI.rejectWithValue({ message: error?.response?.data?.message || error?.message || "Could not load your discount" });
    }
  },
);
