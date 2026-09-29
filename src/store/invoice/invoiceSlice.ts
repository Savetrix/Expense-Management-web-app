import { createSlice } from "@reduxjs/toolkit";

import { isSessionBoundary } from "../sessionBoundary";

import {
  scanInvoice,
  getInvoiceDetails,
  getInvoices,
  postInvoiceToQuickBooks,
  updateInvoiceExtractedData,
  rejectInvoice,
  deleteInvoice,
} from "./invoiceApi";

// ======================================
// TYPES
// ======================================

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  glAccountId?: string;
  /** Per-line tax code. Unset = inherit the invoice-level (vendor) taxCodeId. */
  taxCodeId?: string | null;
}

export interface ExtraCharge {
  description: string;
  amount: number;
  /** Independent of the invoice-level taxCodeId — an extra charge (delivery,
   * service fee, ...) can carry its own tax treatment. null/unset defaults
   * to non-taxable on the QuickBooks side. */
  taxCodeId?: string | null;
  /** Independent of the invoice-level glAccountId, same reasoning as
   * taxCodeId above — an extra charge can post to its own GL account. */
  glAccountId?: string | null;
}

export interface Discount {
  description: string;
  /** Always a positive magnitude — the backend negates this when building
   * the QuickBooks Bill line (see quickbooks.service.js buildBillPayload).
   * Never send a negative value here. */
  amount: number;
  /** Per-discount GL override; unset = invoice-level glAccountId. */
  glAccountId?: string | null;
}

export interface ExtractedData {
  vendorName?: string;
  currency?: string;
  invoiceNumber?: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  amountBeforeTax?: number;
  taxAmount?: number;
  totalAmount?: number;
  glAccountId?: string | null;
  taxCodeId?: string | null;
  lineItems?: LineItem[];
  extraCharges?: ExtraCharge[];
  discounts?: Discount[];
  description?: string | null;
  vendorAddress?: string | null;
  /** API field: bankingDetails (not vendorBankDetails) */
  bankingDetails?: string | null;
}

export interface ConfidenceBreakdown {
  isDuplicate?: boolean;
  imageQualityScore?: number;
  mistralConfidenceScore?: number;
  llmConfidenceScore?: number;
  lowConfidenceFields?: string[];
  missingFields?: string[];
  scoreDeductions?: Record<string, boolean>;
}

export interface PopulatedUserRef {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface QuickBooksData {
  billUrl?: string | null;
  vendorId?: string;
  billId?: string;
  postedAt?: string;
  postedBy?: string | PopulatedUserRef;
}

export interface VendorData {
  vendorDbId?: string;
  resolutionStatus?: "exact" | "suggested" | "unresolved";
  suggestedVendors?: any[];
}

export interface FileData {
  s3Url?: string;
  s3Key?: string;
  type?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface StatusHistoryItem {
  postedStatus?: string;
  changedAt?: string;
  changedBy?: string | PopulatedUserRef;
  reason?: string;
}

export interface InvoiceRecord {
  _id: string;
  userId?: string;
  uploadedBy?: string | PopulatedUserRef;
  batchId?: string;
  postedStatus?: string;
  confidenceScore?: number;
  extractedData?: ExtractedData;
  confidenceBreakdown?: ConfidenceBreakdown;
  quickbooks?: QuickBooksData;
  vendor?: VendorData;
  file?: FileData;
  googleDrive?: { fileId?: string | null; fileUrl?: string | null; uploadedAt?: string | null };
  statusHistory?: StatusHistoryItem[];
  processedBy?: string;
  extractedByModel?: string;
  normalizedInvoiceNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface InvoiceState {
  loading: boolean;
  // `loading` above is shared across scanInvoice/getInvoiceDetails/getInvoices
  // (and read for UI spinners in several places), so it can't safely gate a
  // dedup `condition` on getInvoices/getInvoiceDetails — e.g. a getInvoices
  // condition checking `loading` would wrongly skip if getInvoiceDetails
  // merely happened to be in flight at the same moment. These two are
  // dedicated, only ever toggled by their own thunk, and exist purely so
  // invoiceApi.ts's `condition` can block a genuine duplicate in-flight
  // request without touching `loading`'s existing (broader) meaning.
  invoicesFetchPending: boolean;
  /** Which invoiceId getInvoiceDetails currently has in flight, or null. */
  invoiceDetailsFetchId: string | null;
  // Which invoice's getInvoiceDetails last failed. The "not found → back to
  // the list" redirects key off this rather than the shared `error`, which
  // any other invoice thunk (e.g. a failed getInvoices) can leave set.
  invoiceDetailsErrorFor: string | null;
  invoiceData: any;
  invoiceDetails: InvoiceRecord | null;
  invoices: InvoiceRecord[];
  autoPostedInvoices: InvoiceRecord[];
  manualPostedInvoices: InvoiceRecord[];
  pendingInvoices: InvoiceRecord[];
  failedInvoices: InvoiceRecord[];
  selectedInvoice: InvoiceRecord | null;
  posting: boolean;
  postingError: any;
  rejecting: boolean;
  rejectingError: any;
  updatingExtractedData: boolean;
  updatingExtractedDataError: any;
  deleting: boolean;
  deletingError: any;
  error: any;
}

// ======================================
// INITIAL STATE
// ======================================

const initialState: InvoiceState = {
  loading: false,
  invoicesFetchPending: false,
  invoiceDetailsFetchId: null,
  invoiceDetailsErrorFor: null,
  invoiceData: null,
  invoiceDetails: null,
  invoices: [],
  autoPostedInvoices: [],
  manualPostedInvoices: [],
  pendingInvoices: [],
  failedInvoices: [],
  selectedInvoice: null,
  posting: false,
  postingError: null,
  rejecting: false,
  rejectingError: null,
  updatingExtractedData: false,
  updatingExtractedDataError: null,
  deleting: false,
  deletingError: null,
  error: null,
};

// The updateInvoice endpoint (backs post/reject/edit) nests the invoice
// under data.invoice — same shape getInvoiceDetails already unwraps in
// invoiceApi.ts. `?? payload?.data` is kept as a fallback for any response
// shape that isn't nested this way.
function extractInvoice(payload: any): InvoiceRecord | undefined {
  return payload?.data?.invoice ?? payload?.data;
}

// ======================================
// SLICE
// ======================================

const invoiceSlice = createSlice({
  name: "invoice",

  initialState,

  reducers: {
    setSelectedInvoice: (state, action) => {
      state.selectedInvoice = action.payload;
    },

    clearSelectedInvoice: (state) => {
      state.selectedInvoice = null;
    },
  },

  extraReducers: (builder) => {
    // ======================================
    // SCAN INVOICE
    // ======================================

    builder.addCase(scanInvoice.pending, (state) => {
      state.loading = true;
      state.error = null;
    });

    builder.addCase(scanInvoice.fulfilled, (state, action) => {
      state.loading = false;
      state.invoiceData = action.payload;
    });

    builder.addCase(scanInvoice.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload;
    });

    // ======================================
    // GET INVOICE DETAILS
    // ======================================

    builder.addCase(getInvoiceDetails.pending, (state, action) => {
      state.loading = true;
      state.error = null;
      state.invoiceDetailsFetchId = action.meta.arg;
      state.invoiceDetailsErrorFor = null;
    });

    builder.addCase(getInvoiceDetails.fulfilled, (state, action) => {
      state.loading = false;
      state.invoiceDetailsFetchId = null;
      // Payload is already the unwrapped invoice object (see invoiceApi.ts)
      state.invoiceDetails = action.payload;
      // Also keep selectedInvoice in sync so InvoiceReviewScreen always has
      // the freshest data when navigating directly via invoiceId.
      state.selectedInvoice = action.payload;
    });

    builder.addCase(getInvoiceDetails.rejected, (state, action) => {
      state.loading = false;
      state.invoiceDetailsFetchId = null;
      state.invoiceDetailsErrorFor = action.meta?.arg ?? null;
      state.error = action.payload;
    });

    // ======================================
    // GET ALL INVOICES
    // ======================================

    builder.addCase(getInvoices.pending, (state, action) => {
      state.invoicesFetchPending = true;
      if (action.meta?.arg?.background) return;
      state.loading = true;
      state.error = null;
    });

    builder.addCase(getInvoices.fulfilled, (state, action) => {
      // A background poll never set `loading`, so it mustn't clear it either —
      // it's shared with getInvoiceDetails, which may still be in flight.
      if (!action.meta?.arg?.background) state.loading = false;
      state.invoicesFetchPending = false;
      state.invoices = action.payload || [];

      state.autoPostedInvoices = state.invoices.filter(
        (item) => item?.postedStatus === "auto",
      );
      state.manualPostedInvoices = state.invoices.filter(
        (item) => item?.postedStatus === "manual",
      );
      state.pendingInvoices = state.invoices.filter(
        (item) => item?.postedStatus === "pending",
      );
      state.failedInvoices = state.invoices.filter(
        (item) => item?.postedStatus === "failed",
      );
    });

    builder.addCase(getInvoices.rejected, (state, action) => {
      state.invoicesFetchPending = false;
      // A failed background poll (network blip, 429) keeps what's on screen —
      // clearing it blanked the dashboard and, with no "processing" invoices
      // left in the list, silently stopped the poll itself. An expired
      // session is handled by the api.ts refresh/sign-out path instead.
      if (action.meta?.arg?.background) return;
      state.loading = false;
      state.error = action.payload;
      // A failed fetch (e.g. token expiry, or a genuinely disconnected
      // account getting a 400 for missing X-QB-Id) must not leave a
      // previous successful fetch's data on screen — otherwise the UI
      // renders stale invoices as if they belong to whoever's looking now.
      state.invoices = [];
      state.autoPostedInvoices = [];
      state.manualPostedInvoices = [];
      state.pendingInvoices = [];
      state.failedInvoices = [];
    });

    // ======================================
    // POST TO QUICKBOOKS
    // ======================================

    builder.addCase(postInvoiceToQuickBooks.pending, (state) => {
      state.posting = true;
      state.postingError = null;
    });

    builder.addCase(postInvoiceToQuickBooks.fulfilled, (state, action) => {
      state.posting = false;
      state.selectedInvoice = extractInvoice(action.payload) ?? state.selectedInvoice;
    });

    builder.addCase(postInvoiceToQuickBooks.rejected, (state, action) => {
      state.posting = false;
      state.postingError = action.payload;
    });

    // ======================================
    // REJECT INVOICE
    // ======================================

    builder.addCase(rejectInvoice.pending, (state) => {
      state.rejecting = true;
      state.rejectingError = null;
    });

    builder.addCase(rejectInvoice.fulfilled, (state, action) => {
      state.rejecting = false;
      state.selectedInvoice = extractInvoice(action.payload) ?? state.selectedInvoice;

      const updatedInvoice = extractInvoice(action.payload);
      if (updatedInvoice?._id) {
        state.pendingInvoices = state.pendingInvoices.filter(
          (inv) => inv._id !== updatedInvoice._id,
        );
        state.failedInvoices = [updatedInvoice, ...state.failedInvoices];
        state.invoices = state.invoices.map((inv) =>
          inv._id === updatedInvoice._id ? updatedInvoice : inv,
        );
      }
    });

    builder.addCase(rejectInvoice.rejected, (state, action) => {
      state.rejecting = false;
      state.rejectingError = action.payload;
    });

    // ======================================
    // UPDATE INVOICE EXTRACTED DATA
    // ======================================

    builder.addCase(updateInvoiceExtractedData.pending, (state) => {
      state.updatingExtractedData = true;
      state.updatingExtractedDataError = null;
    });

    builder.addCase(updateInvoiceExtractedData.fulfilled, (state, action) => {
      state.updatingExtractedData = false;

      const updatedInvoice = extractInvoice(action.payload);
      if (updatedInvoice?._id) {
        state.selectedInvoice = updatedInvoice;
        state.invoices = state.invoices.map((inv) =>
          inv._id === updatedInvoice._id ? updatedInvoice : inv,
        );
        // The edit endpoint never changes postedStatus, so the invoice stays
        // in whichever per-status array it was already in — just refresh
        // its contents there too, otherwise list pages would keep showing
        // pre-edit data until the next full getInvoices() refetch.
        const replaceIn = (list: InvoiceRecord[]) =>
          list.map((inv) => (inv._id === updatedInvoice._id ? updatedInvoice : inv));
        state.autoPostedInvoices = replaceIn(state.autoPostedInvoices);
        state.manualPostedInvoices = replaceIn(state.manualPostedInvoices);
        state.pendingInvoices = replaceIn(state.pendingInvoices);
        state.failedInvoices = replaceIn(state.failedInvoices);
      }
    });

    builder.addCase(updateInvoiceExtractedData.rejected, (state, action) => {
      state.updatingExtractedData = false;
      state.updatingExtractedDataError = action.payload;
    });

    // ======================================
    // DELETE INVOICE
    // ======================================

    builder.addCase(deleteInvoice.pending, (state) => {
      state.deleting = true;
      state.deletingError = null;
    });

    builder.addCase(deleteInvoice.fulfilled, (state, action) => {
      state.deleting = false;

      const { invoiceId } = action.payload;
      const removeFrom = (list: InvoiceRecord[]) => list.filter((inv) => inv._id !== invoiceId);
      state.invoices = removeFrom(state.invoices);
      state.autoPostedInvoices = removeFrom(state.autoPostedInvoices);
      state.manualPostedInvoices = removeFrom(state.manualPostedInvoices);
      state.pendingInvoices = removeFrom(state.pendingInvoices);
      state.failedInvoices = removeFrom(state.failedInvoices);
      if (state.selectedInvoice?._id === invoiceId) state.selectedInvoice = null;
      if (state.invoiceDetails?._id === invoiceId) state.invoiceDetails = null;
    });

    builder.addCase(deleteInvoice.rejected, (state, action) => {
      state.deleting = false;
      state.deletingError = action.payload;
    });

    // ======================================
    // SESSION BOUNDARY
    // ======================================
    // Not persisted, but very much alive in memory for the tab's whole SPA
    // lifetime — a logout/login/register that never hard-reloads the page
    // would otherwise leave the previous account's invoices rendering under
    // the new session. Reset on every session start/end (see
    // sessionBoundary.ts).
    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export const { setSelectedInvoice, clearSelectedInvoice } =
  invoiceSlice.actions;

export default invoiceSlice.reducer;
