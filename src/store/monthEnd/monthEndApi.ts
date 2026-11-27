// Thunks for month-end adjustments (Scantrix_API /month-end). Only
// prepayments so far. The company goes in X-QB-Id, attached by lib/api.ts.
// The Month-End page keeps the results in its own state — nothing here is
// shared app-wide, so there is no slice (same as store/admin/couponAdminApi.ts).
import { createAsyncThunk } from "@reduxjs/toolkit";

import api from "../../lib/api";

export type PrepaymentStatus = "review" | "active" | "archived";
/** `completed` = active, every journal posted and the last one's date has come. */
export type PrepaymentDisplayStatus = PrepaymentStatus | "completed";
export type PrepaymentEntryStatus = "pending" | "posted" | "failed" | "removed";

/** One monthly release: Dr expense / Cr prepaid. */
export interface PrepaymentEntryDto {
  seq: number;
  /** The journal's date (YYYY-MM-DD) — the period-start day of its month. */
  date: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  amount: number;
  /** A foreign bill's release in the home currency — what the journal actually posts. */
  homeAmount: number | null;
  balanceAfter: number;
  /** Before release-from: released outside ScanTrix, never posted. */
  trackedOnly: boolean;
  status: PrepaymentEntryStatus;
  externalId: string | null;
  /** Link to the journal in QuickBooks/Xero. */
  url: string | null;
  error: string | null;
  /** The call may have reached the books (timeout) — Retry posts it safely with the same key. */
  outcomeUnknown: boolean;
  postedAt: string | null;
}

export interface PrepaymentDto {
  _id: string;
  invoiceId: string;
  vendorName: string | null;
  /** The invoice number. */
  sourceRef: string | null;
  currency: string | null;
  /** What the bill put in the prepaid account. */
  total: number;
  /** Set once a foreign bill is published: its journals release in this (home) currency. */
  homeCurrency: string | null;
  homeTotal: number | null;
  startDate: string;
  endDate: string;
  releaseFrom: string | null;
  balanceAccountId: string | null;
  balanceAccountName: string | null;
  pnlAccountId: string | null;
  pnlAccountName: string | null;
  status: PrepaymentStatus;
  displayStatus: PrepaymentDisplayStatus;
  months: number;
  releasedToDate: number;
  balance: number;
  postedCount: number;
  failedCount: number;
  /** A background job is running (posting or removing journals) — poll until false. */
  posting: boolean;
  /** What that job does: "publish" posts journals, "archive" removes them. */
  postingJob: "publish" | "archive" | null;
  entries: PrepaymentEntryDto[];
  lastError: string | null;
  /** e.g. "RECONNECT_REQUIRED", "PARTLY_POSTED", "OUTCOME_UNKNOWN", "REMOVE_FAILED". */
  lastErrorCode: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface MonthEndSettingsDto {
  /** Off = the scanner never flags a prepayment (one can still be marked by hand). */
  prepaymentDetection: boolean;
  /** Invoices below this are expensed straight away. 0 = no minimum. */
  prepaymentMinAmount: number;
  /** The prepaid (asset) account; null = picked automatically on first use. */
  prepaidAccountId: string | null;
}

export interface MonthEndRequestError {
  message: string;
  statusCode?: number;
  code?: string;
}

interface AxiosLikeError {
  message?: string;
  response?: { status?: number; data?: { message?: string; data?: { code?: string } | null } };
}

const toError = (error: unknown, fallback: string): MonthEndRequestError => {
  const e = error as AxiosLikeError | undefined;
  return {
    message: e?.response?.data?.message || e?.message || fallback,
    statusCode: e?.response?.status,
    code: e?.response?.data?.data?.code,
  };
};

type Config = { rejectValue: MonthEndRequestError };

export const fetchPrepayments = createAsyncThunk<PrepaymentDto[], { invoiceId?: string } | void, Config>(
  "monthEnd/fetchPrepayments",
  async (args, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/month-end/prepayments", { params: args?.invoiceId ? { invoiceId: args.invoiceId } : undefined });
      return data?.data?.prepayments ?? [];
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't load prepayments."));
    }
  },
);

export const fetchPrepayment = createAsyncThunk<PrepaymentDto, string, Config>("monthEnd/fetchPrepayment", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/month-end/prepayments/${id}`);
    return data.data.prepayment;
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load the prepayment."));
  }
});

/** The prepaid account isn't patchable — it's wherever the bill was posted. */
export type PrepaymentPatch = Partial<{
  startDate: string;
  endDate: string;
  releaseFrom: string | null;
  pnlAccountId: string | null;
}>;

/** Only while in review — the schedule is recalculated server-side. */
export const updatePrepayment = createAsyncThunk<PrepaymentDto, { id: string; patch: PrepaymentPatch }, Config>(
  "monthEnd/updatePrepayment",
  async ({ id, patch }, { rejectWithValue }) => {
    try {
      const { data } = await api.patch(`/month-end/prepayments/${id}`, patch);
      return data.data.prepayment;
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't update the schedule."));
    }
  },
);

const action = (name: string, path: string, fallback: string) =>
  createAsyncThunk<PrepaymentDto, string, Config>(`monthEnd/${name}`, async (id, { rejectWithValue }) => {
    try {
      const { data } = await api.post(`/month-end/prepayments/${id}/${path}`, undefined, { timeout: 120_000 });
      return data.data.prepayment;
    } catch (error) {
      return rejectWithValue(toError(error, fallback));
    }
  });

/** Posts every journal (in the background — the result says `posting: true` until done). */
export const publishPrepayment = action("publishPrepayment", "publish", "Couldn't publish the schedule.");
/** Posts the journals a publish couldn't. */
export const retryPrepayment = action("retryPrepayment", "retry", "Couldn't retry the schedule.");
/** A draft is archived at once; a published one's journals are removed first, in the background (`posting` + `postingJob: "archive"`). */
export const archivePrepayment = action("archivePrepayment", "archive", "Couldn't archive the schedule.");
export const unarchivePrepayment = action("unarchivePrepayment", "unarchive", "Couldn't restore the schedule.");

export const fetchMonthEndSettings = createAsyncThunk<MonthEndSettingsDto, void, Config>("monthEnd/fetchSettings", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/month-end/settings");
    return data.data.settings;
  } catch (error) {
    return rejectWithValue(toError(error, "Couldn't load month-end settings."));
  }
});

export const saveMonthEndSettings = createAsyncThunk<MonthEndSettingsDto, Partial<MonthEndSettingsDto>, Config>(
  "monthEnd/saveSettings",
  async (patch, { rejectWithValue }) => {
    try {
      const { data } = await api.put("/month-end/settings", patch);
      return data.data.settings;
    } catch (error) {
      return rejectWithValue(toError(error, "Couldn't save the settings."));
    }
  },
);
