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
export const fetchMySubscription = createAsyncThunk(
  "subscription/fetchMySubscription",
  async (_: void, thunkAPI) => {
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
    condition: (_, { getState }) => !(getState() as RootState).subscription.subscriptionLoading,
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
  async (data: ChoosePlanPayload, thunkAPI) => {
    try {
      console.log("========== STRIPE CHECKOUT REQUEST ==========");
      const response = await api.post("/subscription/checkout", data);
      console.log("========== STRIPE CHECKOUT SUCCESS ==========");
      return response.data;
    } catch (error: any) {
      console.log("========== STRIPE CHECKOUT ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to start checkout";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
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
