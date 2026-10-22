import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";

// Superadmin coupon management (Scantrix_API /superadmin/coupons). The admin
// page keeps the results in its own state — nothing here is shared app-wide.

export type CouponDuration = "once" | "repeating" | "forever";
export type CouponStatus = "active" | "inactive" | "expired" | "used_up";
/** all = new and existing customers; new = only people who never paid for a plan */
export type CouponAudience = "all" | "new";

export interface AdminCoupon {
  _id: string;
  code: string;
  percentOff: number;
  duration: CouponDuration;
  durationInMonths: number | null;
  /** e.g. "5% off for 3 months" */
  description: string;
  audience: CouponAudience;
  /** null = unlimited (until deactivated) */
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null;
  active: boolean;
  status: CouponStatus;
  createdAt: string;
  deactivatedAt: string | null;
}

export interface CouponRedemptionRow {
  _id: string;
  user: { _id: string; name: string; email: string } | null;
  plan: string | null;
  billingInterval: string | null;
  amountOff: number;
  currency: string | null;
  redeemedAt: string;
}

export interface CreateCouponInput {
  code: string;
  percentOff: number;
  duration: CouponDuration;
  durationInMonths?: number;
  audience: CouponAudience;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}

type Rejection = { rejectValue: { message: string } };
const reject = (error: any, fallback: string) => ({ message: error?.response?.data?.message || error?.message || fallback });

export const fetchCoupons = createAsyncThunk<AdminCoupon[], void, Rejection>("couponAdmin/fetchCoupons", async (_, thunkAPI) => {
  try {
    const response = await api.get("/superadmin/coupons");
    return response.data.data.coupons as AdminCoupon[];
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not load coupons"));
  }
});

export const createCoupon = createAsyncThunk<AdminCoupon, CreateCouponInput, Rejection>(
  "couponAdmin/createCoupon",
  async (input, thunkAPI) => {
    try {
      const response = await api.post("/superadmin/coupons", input);
      return response.data.data.coupon as AdminCoupon;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not create the coupon"));
    }
  },
);

export const setCouponActive = createAsyncThunk<AdminCoupon, { couponId: string; active: boolean }, Rejection>(
  "couponAdmin/setCouponActive",
  async ({ couponId, active }, thunkAPI) => {
    try {
      const response = await api.patch(`/superadmin/coupons/${couponId}`, { active });
      return response.data.data.coupon as AdminCoupon;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(reject(error, "Could not update the coupon"));
    }
  },
);

export const fetchCouponRedemptions = createAsyncThunk<
  { coupon: AdminCoupon; redemptions: CouponRedemptionRow[] },
  string,
  Rejection
>("couponAdmin/fetchCouponRedemptions", async (couponId, thunkAPI) => {
  try {
    const response = await api.get(`/superadmin/coupons/${couponId}/redemptions`);
    return response.data.data;
  } catch (error: any) {
    return thunkAPI.rejectWithValue(reject(error, "Could not load who used this coupon"));
  }
});
