// Thunks for expense claims and mileage (Scantrix_API /expense-claims and
// /mileage). The company goes in X-QB-Id, attached by lib/api.ts; each read
// returns the company it was made for so the slice never shows one company's
// claims under another.
import { createAsyncThunk } from "@reduxjs/toolkit";

import api from "../../lib/api";
// Type-only: the slice imports this file and store/index imports the slice.
import type { RootState } from "..";

export type ClaimStatus = "awaiting_review" | "awaiting_reimbursement" | "paid";
export type FuelType = "Petrol" | "Diesel" | "Electric" | "Hybrid";
export type VehicleType = "Car" | "Van" | "Motorcycle";
export type VehicleOwnership = "company" | "personal";
export type JourneyStatus = "draft" | "published";

export const FUEL_TYPES: FuelType[] = ["Petrol", "Diesel", "Electric", "Hybrid"];
export const VEHICLE_TYPES: VehicleType[] = ["Car", "Van", "Motorcycle"];

/** A claimant or driver: a user on the company, a saved contact of the company, or a name. */
export interface PersonDto {
  userId: string | null;
  contactId?: string | null;
  name: string;
  email?: string | null;
}

/** Someone outside the team who has been a claimant before. */
export interface ClaimContactDto {
  id: string;
  name: string;
  email: string | null;
}

/** A bank account in the accounting software a claim can be paid from. */
export interface BankAccountDto {
  externalId: string;
  name: string;
  currency: string | null;
}

export interface ClaimReceiptDto {
  /** The scanned invoice's _id. */
  id: string;
  vendor: string;
  date: string; // YYYY-MM-DD, "" when the scan has no date
  glAccountId: string | null;
  glAccount: string | null;
  taxCodeId: string | null;
  tax: number;
  amount: number; // gross, incl. tax
  currency: string | null;
  source: "Upload" | "Email";
  note: string | null;
  fileUrl: string | null;
}

export interface ExpenseClaimDto {
  id: string;
  claimant: PersonDto;
  month: string; // YYYY-MM
  currency: string | null;
  status: ClaimStatus;
  receipts: ClaimReceiptDto[];
  total: number;
  tax: number;
  createdBy: string;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  publishedAt: string | null;
  paidAt: string | null;
  /** "manual" = marked paid in Scantrix; "accounting" = a bill payment was recorded in QuickBooks/Xero. */
  paidVia: "manual" | "accounting" | null;
  billUrl: string | null;
}

export interface VehicleDto {
  id: string;
  name: string;
  vehicleType: VehicleType;
  fuelType: FuelType;
  ownership: VehicleOwnership;
}

export type MileageRates = Record<VehicleType, Record<FuelType, number | null>>;

export interface ExpenseSettingsDto {
  allowSelfApproval: boolean;
  vehicles: VehicleDto[];
  /** Per km, per vehicle type and fuel type. null = not set yet; there is no default rate. */
  rates: MileageRates;
  passengerRate: number | null;
  mileageGlAccountId: string | null;
}

export interface JourneyDto {
  id: string;
  date: string;
  driver: PersonDto;
  vehicle: { vehicleId: string | null; name: string; vehicleType: VehicleType; fuelType: FuelType; ownership: VehicleOwnership };
  start: string;
  end: string;
  returnTrip: boolean;
  km: number;
  rate: number;
  passenger: boolean;
  passengerRate: number;
  amount: number;
  purpose: string;
  status: JourneyStatus;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  billUrl: string | null;
}

export interface ExpenseRequestError {
  message: string;
  statusCode?: number;
  /** The backend's machine-readable reason, e.g. "SELF_APPROVAL_BLOCKED", "MISSING_GL_ACCOUNT". */
  code?: string;
}

interface AxiosLikeError {
  message?: string;
  response?: { status?: number; data?: { message?: string; data?: { code?: string } | null } };
}

const toError = (error: unknown, fallback: string): ExpenseRequestError => {
  const e = error as AxiosLikeError | undefined;
  return {
    message: e?.response?.data?.message || e?.message || fallback,
    statusCode: e?.response?.status,
    code: e?.response?.data?.data?.code,
  };
};

const companyOf = (getState: () => unknown) => (getState() as RootState).quickBooks.qbConnectionId || null;

/** The company a change was made in — the slice ignores the result if the header has moved on to another one. */
export interface CompanyMeta {
  qbConnectionId: string | null;
}
type Config = { rejectValue: ExpenseRequestError; fulfilledMeta: CompanyMeta };

// ─── Claims ──────────────────────────────────────────────────────────────────

export const fetchExpenseClaims = createAsyncThunk<
  { claims: ExpenseClaimDto[]; qbConnectionId: string | null },
  void,
  { rejectValue: ExpenseRequestError }
>("expenseClaims/fetchClaims", async (_, { getState, rejectWithValue }) => {
  const qbConnectionId = companyOf(getState);
  try {
    const { data } = await api.get("/expense-claims");
    return { claims: data?.data?.claims ?? [], qbConnectionId };
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load expense claims."));
  }
});

export interface CreateClaimInput {
  claimant: { userId?: string | null; contactId?: string | null; name?: string; email?: string | null };
  receiptIds: string[];
  /** receiptId → the claimant's note on that receipt. */
  notes?: Record<string, string>;
}

export const createExpenseClaim = createAsyncThunk<ExpenseClaimDto, CreateClaimInput, Config>(
  "expenseClaims/createClaim",
  async (input, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post("/expense-claims", input);
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't create the claim."));
    }
  },
);

export const approveExpenseClaim = createAsyncThunk<ExpenseClaimDto, { id: string; pay?: boolean }, Config>(
  "expenseClaims/approveClaim",
  async ({ id, pay }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/expense-claims/${id}/approve${pay ? "?pay=true" : ""}`);
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't approve the claim."));
    }
  },
);

export const publishExpenseClaim = createAsyncThunk<ExpenseClaimDto, string, Config>(
  "expenseClaims/publishClaim",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      // Creating the bill, the payee and one attachment per receipt can take a while.
      const { data } = await api.post(`/expense-claims/${id}/publish`, undefined, { timeout: 90_000 });
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't publish the claim."));
    }
  },
);

export const markExpenseClaimPaid = createAsyncThunk<ExpenseClaimDto, string, Config>(
  "expenseClaims/markPaid",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/expense-claims/${id}/mark-paid`);
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't mark the claim as paid."));
    }
  },
);

/** Back to review: an approved, unpaid claim that isn't in the accounting software yet. */
export const reopenExpenseClaim = createAsyncThunk<ExpenseClaimDto, string, Config>(
  "expenseClaims/reopen",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/expense-claims/${id}/reopen`);
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't send the claim back to review."));
    }
  },
);

/** Resolves with the updated claim, or null when the last receipt went and the claim with it. */
export const removeClaimReceipt = createAsyncThunk<
  { claimId: string; receiptId: string; claim: ExpenseClaimDto | null },
  { claimId: string; receiptId: string },
  Config
>("expenseClaims/removeReceipt", async ({ claimId, receiptId }, { getState, rejectWithValue, fulfillWithValue }) => {
  const meta = { qbConnectionId: companyOf(getState) };
  try {
    const { data } = await api.delete(`/expense-claims/${claimId}/receipts/${receiptId}`);
    return fulfillWithValue({ claimId, receiptId, claim: data?.data?.claim ?? null }, meta);
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't remove the receipt."));
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────

export const fetchExpenseSettings = createAsyncThunk<
  { settings: ExpenseSettingsDto; qbConnectionId: string | null },
  void,
  { rejectValue: ExpenseRequestError }
>("expenseClaims/fetchSettings", async (_, { getState, rejectWithValue }) => {
  const qbConnectionId = companyOf(getState);
  try {
    const { data } = await api.get("/expense-claims/settings");
    return { settings: data.data.settings, qbConnectionId };
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load expense settings."));
  }
});

export type SettingsPatch = Partial<{
  allowSelfApproval: boolean;
  vehicles: Array<Pick<VehicleDto, "name" | "vehicleType" | "fuelType" | "ownership"> & { id?: string }>;
  /** Only the pairs sent change, e.g. { Van: { Diesel: 0.8 } }. */
  rates: Partial<Record<VehicleType, Partial<Record<FuelType, number | null>>>>;
  passengerRate: number | null;
  mileageGlAccountId: string | null;
}>;

export const saveExpenseSettings = createAsyncThunk<ExpenseSettingsDto, SettingsPatch, Config>(
  "expenseClaims/saveSettings",
  async (patch, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.put("/expense-claims/settings", patch);
      return fulfillWithValue(data.data.settings, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't save the settings."));
    }
  },
);

export const addMileageVehicle = createAsyncThunk<
  VehicleDto,
  Pick<VehicleDto, "name" | "vehicleType" | "fuelType" | "ownership">,
  Config
>("expenseClaims/addVehicle", async (vehicle, { getState, rejectWithValue, fulfillWithValue }) => {
  const meta = { qbConnectionId: companyOf(getState) };
  try {
    const { data } = await api.post("/mileage/vehicles", vehicle);
    return fulfillWithValue(data.data.vehicle, meta);
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't add the vehicle."));
  }
});

// ─── Mileage journeys ────────────────────────────────────────────────────────

export const fetchJourneys = createAsyncThunk<
  { journeys: JourneyDto[]; qbConnectionId: string | null },
  void,
  { rejectValue: ExpenseRequestError }
>("expenseClaims/fetchJourneys", async (_, { getState, rejectWithValue }) => {
  const qbConnectionId = companyOf(getState);
  try {
    const { data } = await api.get("/mileage/journeys");
    return { journeys: data?.data?.journeys ?? [], qbConnectionId };
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load journeys."));
  }
});

export interface CreateJourneyInput {
  driver: { userId?: string | null; name?: string };
  vehicleId: string;
  date: string;
  start: string;
  end: string;
  returnTrip: boolean;
  oneWayKm: number;
  passenger: boolean;
  purpose: string;
}

export const createJourney = createAsyncThunk<JourneyDto, CreateJourneyInput, Config>(
  "expenseClaims/createJourney",
  async (input, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post("/mileage/journeys", input);
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't save the journey."));
    }
  },
);

export const publishJourney = createAsyncThunk<JourneyDto, string, Config>(
  "expenseClaims/publishJourney",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/mileage/journeys/${id}/publish`, undefined, { timeout: 60_000 });
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't publish the journey."));
    }
  },
);

export const deleteJourney = createAsyncThunk<string, string, Config>(
  "expenseClaims/deleteJourney",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      await api.delete(`/mileage/journeys/${id}`);
      return fulfillWithValue(id, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't delete the journey."));
    }
  },
);

// ─── Contacts, notes, paying, distance ───────────────────────────────────────

export const fetchClaimContacts = createAsyncThunk<
  { contacts: ClaimContactDto[]; qbConnectionId: string | null },
  void,
  { rejectValue: ExpenseRequestError }
>("expenseClaims/fetchContacts", async (_, { getState, rejectWithValue }) => {
  const qbConnectionId = companyOf(getState);
  try {
    const { data } = await api.get("/expense-claims/contacts");
    return { contacts: data?.data?.contacts ?? [], qbConnectionId };
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load contacts."));
  }
});

export const updateReceiptNote = createAsyncThunk<ExpenseClaimDto, { claimId: string; receiptId: string; note: string }, Config>(
  "expenseClaims/updateNote",
  async ({ claimId, receiptId, note }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.patch(`/expense-claims/${claimId}/receipts/${receiptId}`, { note });
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't save the note."));
    }
  },
);

/** Live from QuickBooks/Xero — not kept in the store. */
export const fetchBankAccounts = createAsyncThunk<BankAccountDto[], void, { rejectValue: ExpenseRequestError }>(
  "expenseClaims/fetchBankAccounts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/expense-claims/bank-accounts");
      return data?.data?.accounts ?? [];
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't load bank accounts."));
    }
  },
);

/** Records the payment of the claim's bill in QuickBooks/Xero and marks the claim paid. */
export const payExpenseClaim = createAsyncThunk<ExpenseClaimDto, { id: string; bankAccountId: string; date: string }, Config>(
  "expenseClaims/pay",
  async ({ id, bankAccountId, date }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/expense-claims/${id}/pay`, { bankAccountId, date }, { timeout: 60_000 });
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't record the payment."));
    }
  },
);

export interface DistanceDto {
  km: number;
  /** The addresses Google resolved the two places to. */
  from: string;
  to: string;
}

export const lookupDistance = createAsyncThunk<DistanceDto, { from: string; to: string }, { rejectValue: ExpenseRequestError }>(
  "expenseClaims/lookupDistance",
  async ({ from, to }, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/mileage/distance", { params: { from, to } });
      return data.data;
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't calculate the distance."));
    }
  },
);
