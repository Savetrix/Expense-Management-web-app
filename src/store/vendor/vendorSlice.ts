import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { isSessionBoundary } from "../sessionBoundary";

interface CreatedVendor {
  name: string;
  currency: string;
  glAccountId?: string;
  taxCodeId?: string;
}

interface SelectedVendor {
  _id: string;
  displayName: string;
  qbVendorId: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  glAccountId?: string | null;
  taxCodeId?: string | null;
}

interface VendorState {
  createdVendor: CreatedVendor | null;
  selectedVendor: SelectedVendor | null;
  /**
   * The invoice this vendor resolution was made FOR.
   *
   * Without it the selection was global: resolving a vendor on one invoice
   * left it selected for whatever invoice you opened next, and the review
   * screen posted that stale vendor to QuickBooks. Only the Pending list
   * happened to clear it, so opening the next invoice from the Invoices list
   * inherited it silently. Readers must ignore the selection unless this
   * matches the invoice actually on screen.
   */
  forInvoiceId: string | null;
}

const initialState: VendorState = {
  createdVendor: null,
  selectedVendor: null,
  forInvoiceId: null,
};

const vendorSlice = createSlice({
  name: "vendor",
  initialState,
  reducers: {
    setCreatedVendor: (
      state,
      action: PayloadAction<CreatedVendor & { forInvoiceId: string }>
    ) => {
      const { forInvoiceId, ...vendor } = action.payload;
      state.createdVendor = vendor;
      state.forInvoiceId = forInvoiceId;
    },
    clearCreatedVendor: (state) => {
      state.createdVendor = null;
      if (!state.selectedVendor) state.forInvoiceId = null;
    },
    setSelectedVendor: (
      state,
      action: PayloadAction<SelectedVendor & { forInvoiceId: string }>
    ) => {
      const { forInvoiceId, ...vendor } = action.payload;
      state.selectedVendor = vendor;
      state.forInvoiceId = forInvoiceId;
    },
    clearSelectedVendor: (state) => {
      state.selectedVendor = null;
      if (!state.createdVendor) state.forInvoiceId = null;
    },
    /** Drops a resolution that belongs to a different invoice. */
    clearVendorResolutionForOtherInvoice: (state, action: PayloadAction<string>) => {
      if (state.forInvoiceId !== null && state.forInvoiceId !== action.payload) {
        state.createdVendor = null;
        state.selectedVendor = null;
        state.forInvoiceId = null;
      }
    },
  },
  extraReducers: (builder) => {
    // See sessionBoundary.ts — a previous session's created/selected vendor
    // must not survive into the next session on a shared browser.
    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export const {
  setCreatedVendor,
  clearCreatedVendor,
  setSelectedVendor,
  clearSelectedVendor,
  clearVendorResolutionForOtherInvoice,
} = vendorSlice.actions;

export default vendorSlice.reducer;
