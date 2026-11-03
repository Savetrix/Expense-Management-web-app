// Thunks for expense claims and mileage (Scantrix_API /expense-claims and
// /mileage). The company goes in X-QB-Id, attached by lib/api.ts; each read
// returns the company it was made for so the slice never shows one company's
// claims under another.
import { createAsyncThunk } from "@reduxjs/toolkit";

import api from "../../lib/api";
// Type-only: the slice imports this file and store/index imports the slice.
import type { RootState } from "..";

export type ClaimStatus = "awaiting_review" | "awaiting_reimbursement" | "paid" | "rejected";
/** Trips go through the same approval as claims. */
export type JourneyStatus = ClaimStatus;

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
  /** Who it was sent to for approval (they, or an owner/admin as backup, act on it). null on claims from before approvers were assigned. */
  approver: { userId: string; name: string } | null;
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
  rejectedAt: string | null;
  rejectionReason: string | null;
  billUrl: string | null;
}

/** A receipt uploaded from the claims page that isn't on a claim yet. Only "pending" ones can be claimed. */
export interface ClaimableReceiptDto extends ClaimReceiptDto {
  status: "processing" | "pending" | "failed";
  /** Why a scan failed (a duplicate, an unreadable file). */
  reason: string | null;
  uploadedBy: { id: string; name: string } | null;
  uploadedAt: string;
}

export interface ExpenseSettingsDto {
  allowSelfApproval: boolean;
  /** What the company pays per km, one rate for every trip. null = not set yet: no trip can be logged. */
  mileageRate: number | null;
  mileageGlAccountId: string | null;
}

/** A business trip: total km × the rate it was logged with, sent to an approver like a claim. */
export interface JourneyDto {
  id: string;
  date: string;
  driver: PersonDto;
  approver: { userId: string; name: string } | null;
  km: number;
  rate: number;
  amount: number;
  purpose: string;
  status: JourneyStatus;
  createdBy: string;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paidVia: "manual" | "accounting" | null;
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

/** Claims and mileage trips waiting on the signed-in user's approval — the sidebar count. */
export const fetchClaimSummary = createAsyncThunk<
  /** assignedToMe = claims + trips in review sent to you. */
  { assignedToMe: number; qbConnectionId: string | null },
  void,
  { rejectValue: ExpenseRequestError }
>("expenseClaims/fetchSummary", async (_, { getState, rejectWithValue }) => {
  const qbConnectionId = companyOf(getState);
  try {
    const { data } = await api.get("/expense-claims/summary");
    return { assignedToMe: data?.data?.assignedToMe ?? 0, qbConnectionId };
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load the claims summary."));
  }
});

export interface CreateClaimInput {
  claimant: { userId?: string | null; contactId?: string | null; name?: string; email?: string | null };
  receiptIds: string[];
  /** receiptId → the claimant's note on that receipt. */
  notes?: Record<string, string>;
  /** The owner, admin or accountant the claim is sent to. */
  approverId: string;
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

/** Approving posts the claim to QuickBooks/Xero as one bill payable to the claimant. */
export const approveExpenseClaim = createAsyncThunk<
  ExpenseClaimDto,
  /** expectedTotal: the total the approver saw — the backend refuses (CLAIM_CHANGED) if the receipts changed since. */
  { id: string; pay?: boolean; expectedTotal?: number },
  Config
>(
  "expenseClaims/approveClaim",
  async ({ id, pay, expectedTotal }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      // Creating the bill, the payee and one attachment per receipt can take a while.
      const { data } = await api.post(`/expense-claims/${id}/approve${pay ? "?pay=true" : ""}`, { expectedTotal }, { timeout: 90_000 });
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't approve the claim."));
    }
  },
);

export const rejectExpenseClaim = createAsyncThunk<ExpenseClaimDto, { id: string; reason: string }, Config>(
  "expenseClaims/rejectClaim",
  async ({ id, reason }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/expense-claims/${id}/reject`, { reason });
      return fulfillWithValue(data.data.claim, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't reject the claim."));
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

/** A claim in review, or a rejected one — its receipts are freed for a new claim. */
export const deleteExpenseClaim = createAsyncThunk<string, string, Config>(
  "expenseClaims/deleteClaim",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      await api.delete(`/expense-claims/${id}`);
      return fulfillWithValue(id, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't delete the claim."));
    }
  },
);

// ─── Receipts uploaded from the claims page ─────────────────────────────────
// Kept out of the store: only the new-claim wizard shows them, and it polls
// while they scan.

export const fetchClaimReceipts = createAsyncThunk<ClaimableReceiptDto[], void, { rejectValue: ExpenseRequestError }>(
  "expenseClaims/fetchReceipts",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/expense-claims/receipts");
      return data?.data?.receipts ?? [];
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't load your receipts."));
    }
  },
);

/** Same scanner as the dashboard, flagged as claim receipts: never auto-posted, kept out of the invoice list. */
export const uploadClaimReceipts = createAsyncThunk<{ ids: string[]; failed: string[] }, File[], { rejectValue: ExpenseRequestError }>(
  "expenseClaims/uploadReceipts",
  async (files, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append("claimReceipt", "true");
      files.forEach((file) => formData.append("files", file, file.name));
      // No Content-Type: the browser sets the multipart boundary itself.
      const { data } = await api.post("/invoices", formData, { timeout: 120_000 });
      const uploaded: Array<{ _id: string }> = data?.data?.invoices ?? [];
      const failed: Array<{ fileName?: string }> = data?.data?.failed ?? [];
      return { ids: uploaded.map((i) => i._id), failed: failed.map((f) => f.fileName ?? "file") };
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't upload the receipts."));
    }
  },
);

export const deleteClaimReceipt = createAsyncThunk<string, string, { rejectValue: ExpenseRequestError }>(
  "expenseClaims/deleteReceipt",
  async (id, { rejectWithValue }) => {
    try {
      await api.delete(`/expense-claims/receipts/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't delete the receipt."));
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

/** Owner/admin only. */
export type SettingsPatch = Partial<{
  allowSelfApproval: boolean;
  mileageRate: number | null;
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
  date: string;
  /** The whole trip. */
  km: number;
  purpose: string;
  /** The owner, admin or accountant the trip is sent to. */
  approverId: string;
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

/** Approving posts the trip to QuickBooks/Xero as a bill payable to the driver. */
export const approveJourney = createAsyncThunk<JourneyDto, { id: string; pay?: boolean }, Config>(
  "expenseClaims/approveJourney",
  async ({ id, pay }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/mileage/journeys/${id}/approve${pay ? "?pay=true" : ""}`, undefined, { timeout: 60_000 });
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't approve the trip."));
    }
  },
);

export const rejectJourney = createAsyncThunk<JourneyDto, { id: string; reason: string }, Config>(
  "expenseClaims/rejectJourney",
  async ({ id, reason }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/mileage/journeys/${id}/reject`, { reason });
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't reject the trip."));
    }
  },
);

export const markJourneyPaid = createAsyncThunk<JourneyDto, string, Config>(
  "expenseClaims/markJourneyPaid",
  async (id, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/mileage/journeys/${id}/mark-paid`);
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't mark the trip as paid."));
    }
  },
);

/** Records the payment of the trip's bill in QuickBooks/Xero and marks it paid. */
export const payJourney = createAsyncThunk<JourneyDto, { id: string; bankAccountId: string; date: string }, Config>(
  "expenseClaims/payJourney",
  async ({ id, bankAccountId, date }, { getState, rejectWithValue, fulfillWithValue }) => {
    const meta = { qbConnectionId: companyOf(getState) };
    try {
      const { data } = await api.post(`/mileage/journeys/${id}/pay`, { bankAccountId, date }, { timeout: 60_000 });
      return fulfillWithValue(data.data.journey, meta);
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't record the payment."));
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

// ─── Contacts, notes, paying ─────────────────────────────────────────────────

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
