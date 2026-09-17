import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  deleteQuickBooksVendor,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
  getMyQBConnections,
  getQuickBooksStatus,
  updateQuickBooksSettings,
  updateQuickBooksVendor,
} from "./quickBooksApi";
import { isSessionBoundary } from "../sessionBoundary";

export interface Vendor {
  _id: string;
  qbVendorId: string;
  displayName: string;
  normalizedName: string;
  currency?: string;
  glAccountId?: string | null;
  taxCodeId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  syncedFromQB?: boolean;
  /** Mongoose timestamp, present on every vendor doc but not always sent by every environment. */
  createdAt?: string;
}

export interface GLAccount {
  _id: string;
  qbAccountId: string;
  qbConnectionId: string;
  accountType: string;
  accountSubType: string;
  name: string;
  realmId: string;
  isDeleted: boolean;
}

// Confirmed live /quickbooks/taxcodes response shape: data.items[] with
// `id`/`name`/`taxRateIds`. Older field names are kept as fallbacks in case
// other environments still return the GLAccount-style shape.
export interface TaxCode {
  id?: string;
  _id?: string;
  qbTaxCodeId?: string;
  Id?: string;
  name?: string;
  Name?: string;
  description?: string;
  isDeleted?: boolean;
  taxRateIds?: { name: string; value: string }[];
}

interface QuickBooksState {
  connected: boolean;
  realmId: string;
  qbConnectionId: string;
  // True only once qbConnectionId has been set by something that counts as
  // an actual choice for THIS session (the sole connection when there's only
  // one, or a real switcher pick) — never by rehydrating persisted storage.
  // Without this, a qbConnectionId left over from a session before the
  // "blank until chosen" behavior existed looks perfectly valid (it matches
  // a real, still-active connection) and would never get cleared, since it
  // isn't stale/dangling — just never actually chosen this session.
  hasExplicitSelection: boolean;
  statusLoading: boolean;
  statusError: string | null;
  // From /quickbooks/status's `reason` when connected is false — e.g.
  // "session_expired" or "reconnect_required" — lets the UI show a specific
  // message/action instead of a generic "not connected" banner.
  disconnectReason: string | null;
  autoPostEnabled: boolean;
  lineItemWiseEnabled: boolean;
  attachInvoiceCopyEnabled: boolean;
  vendors: Vendor[];
  vendorsLoading: boolean;
  vendorsError: string | null;
  accounts: GLAccount[];
  accountsLoading: boolean;
  accountsError: string | null;
  taxCodes: TaxCode[];
  taxCodesLoading: boolean;
  taxCodesError: string | null;
}

const initialState: QuickBooksState = {
  connected: false,
  realmId: "",
  qbConnectionId: "",
  hasExplicitSelection: false,
  statusLoading: false,
  statusError: null,
  disconnectReason: null,
  // Default true matches the backend's default for connections that predate
  // these settings — see qb_connection.model.js.
  autoPostEnabled: true,
  lineItemWiseEnabled: true,
  // Defaults on — attaching the scanned invoice copy to the QuickBooks bill
  // is the existing behavior; this is an opt-out, not an opt-in.
  attachInvoiceCopyEnabled: true,
  vendors: [],
  vendorsLoading: false,
  vendorsError: null,
  accounts: [],
  accountsLoading: false,
  accountsError: null,
  taxCodes: [],
  taxCodesLoading: false,
  taxCodesError: null,
};

const quickBooksSlice = createSlice({
  name: "quickBooks",
  initialState,
  reducers: {
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload;
    },
  },
  extraReducers: (builder) => {
    // ── Get My Connections (bootstrap) ─────────────────────────────────
    builder
      .addCase(getMyQBConnections.pending, (state) => {
        state.statusLoading = true;
        state.statusError = null;
      })
      .addCase(getMyQBConnections.fulfilled, (state, action) => {
        state.statusLoading = false;
        state.statusError = null;
        console.log("GET MY CONNECTIONS PAYLOAD:", JSON.stringify(action.payload, null, 2));

        const connections = action.payload?.data?.connections; // ← was action.payload?.data
        const list = Array.isArray(connections) ? connections : [];
        const activeConns = list.filter((c: { status?: string }) => c?.status !== "disconnected");

        if (activeConns.length > 0) {
          state.connected = true; // if a connection record exists, they're connected

          if (activeConns.length === 1) {
            // Only one choice — always the right selection, whether it was
            // already set or not. No ambiguity, so this always counts as
            // "explicit" even though the user didn't click anything.
            const only = activeConns[0];
            if (state.qbConnectionId !== only._id) {
              state.qbConnectionId = only._id ?? "";
              state.realmId = only.realmId ?? "";
            }
            state.hasExplicitSelection = true;
          } else if (!state.hasExplicitSelection) {
            // 2+ choices and nothing has been explicitly picked THIS
            // session — this is the case a merely-persisted qbConnectionId
            // from before this behavior existed would otherwise slip
            // through (it matches a real, still-active connection, so it
            // isn't "stale" by the dangling-id check below). Force blank so
            // the switcher starts unselected until the user picks one.
            state.qbConnectionId = "";
            state.realmId = "";
          } else if (state.qbConnectionId && !activeConns.some((c: { _id: string }) => c._id === state.qbConnectionId)) {
            // An explicit pick from earlier no longer matches any active
            // connection (disconnected since, or removed) — clear it rather
            // than keep sending a dangling X-QB-Id.
            state.qbConnectionId = "";
            state.realmId = "";
            state.hasExplicitSelection = false;
          }
        } else {
          state.connected = false;
          state.realmId = "";
          state.qbConnectionId = "";
          state.hasExplicitSelection = false;
        }
      })
      .addCase(getMyQBConnections.rejected, (state, action) => {
        state.statusLoading = false;
        const payload = action.payload as { message?: string; statusCode?: number } | undefined;
        const statusCode = payload?.statusCode;
        // 400/404 = no connection exists yet
        if (statusCode === 400 || statusCode === 404) {
          state.connected = false;
          state.realmId = "";
          state.qbConnectionId = "";
          state.hasExplicitSelection = false;
          state.statusError = null;
        } else {
          state.statusError = payload?.message || "Failed to fetch QB connections";
        }
      });

    // ── QB Status ──────────────────────────────────────────────────────
    builder
      .addCase(getQuickBooksStatus.pending, (state) => {
        state.statusLoading = true;
        state.statusError = null;
      })
      .addCase(getQuickBooksStatus.fulfilled, (state, action) => {
        state.statusLoading = false;
        state.statusError = null;
        const qbData = action.payload?.data ?? action.payload;
        state.connected = qbData?.connected ?? false;
        state.disconnectReason = qbData?.connected ? null : qbData?.reason ?? null;
        state.realmId = qbData?.realmId ?? "";
        state.autoPostEnabled = qbData?.autoPostEnabled ?? true;
        state.lineItemWiseEnabled = qbData?.lineItemWiseEnabled ?? true;
        state.attachInvoiceCopyEnabled = qbData?.attachInvoiceCopyEnabled ?? true;
        // The backend's status response never echoes back qbConnectionId,
        // so use the one this request was made WITH (action.meta.arg) — that's
        // the connection being switched to. Falling back to the response
        // payload would just keep the old id forever, which is what made
        // switching companies silently no-op.
        state.qbConnectionId =
          action.meta.arg.qbConnectionId || state.qbConnectionId;
        // This thunk only ever runs for a connection the app has decided to
        // use (a switcher pick, or the sole connection) — never speculatively
        // — so any id it sets counts as an explicit selection.
        if (action.meta.arg.qbConnectionId) state.hasExplicitSelection = true;
      })
      .addCase(getQuickBooksStatus.rejected, (state, action) => {
        state.statusLoading = false;
        const payload = action.payload as { message?: string; statusCode?: number } | undefined;
        state.statusError = payload?.message || "Failed to fetch QuickBooks status";
      });

    // ── Settings (auto-post / line-item-wise entry) ───────────────────
    builder.addCase(updateQuickBooksSettings.fulfilled, (state, action) => {
      // Same defensive probe as getQuickBooksStatus.fulfilled above: this
      // backend has proven inconsistent about wrapping payloads in `data`
      // per-endpoint (see the auth/refresh comment in lib/api.ts), and this
      // PATCH was found to return the updated fields on the root object, not
      // nested under `data` — reading only `action.payload?.data` meant the
      // request succeeded (and the toast fired) but the toggle never
      // actually flipped, since nothing here ever matched.
      const data = action.payload?.data ?? action.payload;
      if (data?.autoPostEnabled !== undefined) state.autoPostEnabled = data.autoPostEnabled;
      if (data?.lineItemWiseEnabled !== undefined) state.lineItemWiseEnabled = data.lineItemWiseEnabled;
      if (data?.attachInvoiceCopyEnabled !== undefined) state.attachInvoiceCopyEnabled = data.attachInvoiceCopyEnabled;
    });

    // ── Vendors ────────────────────────────────────────────────────────
    builder
      .addCase(fetchQuickBooksVendors.pending, (state) => {
        state.vendorsLoading = true;
        state.vendorsError = null;
      })
      .addCase(fetchQuickBooksVendors.fulfilled, (state, action) => {
        state.vendorsLoading = false;
        state.vendors = action.payload || [];
      })
      .addCase(fetchQuickBooksVendors.rejected, (state, action) => {
        state.vendorsLoading = false;
        state.vendorsError = action.payload as string;
      });

    // ── Update / Delete Vendor ────────────────────────────────────────
    builder
      .addCase(updateQuickBooksVendor.fulfilled, (state, action) => {
        const updated = action.payload?.data?.vendor;
        if (updated?._id) {
          state.vendors = state.vendors.map((v) => (v._id === updated._id ? updated : v));
        }
      })
      .addCase(deleteQuickBooksVendor.fulfilled, (state, action) => {
        const vendorId = (action.payload as { vendorId?: string })?.vendorId;
        if (vendorId) {
          state.vendors = state.vendors.filter((v) => v._id !== vendorId);
        }
      });

    // ── GL Accounts ────────────────────────────────────────────────────
    builder
      .addCase(fetchQuickBooksAccounts.pending, (state) => {
        state.accountsLoading = true;
        state.accountsError = null;
      })
      .addCase(fetchQuickBooksAccounts.fulfilled, (state, action) => {
        state.accountsLoading = false;
        state.accounts = action.payload || [];
      })
      .addCase(fetchQuickBooksAccounts.rejected, (state, action) => {
        state.accountsLoading = false;
        state.accountsError = action.payload as string;
      });

    // ── Tax Codes ──────────────────────────────────────────────────────
    builder
      .addCase(fetchQuickBooksTaxCodes.pending, (state) => {
        state.taxCodesLoading = true;
        state.taxCodesError = null;
      })
      .addCase(fetchQuickBooksTaxCodes.fulfilled, (state, action) => {
        state.taxCodesLoading = false;
        state.taxCodes = action.payload || [];
      })
      .addCase(fetchQuickBooksTaxCodes.rejected, (state, action) => {
        state.taxCodesLoading = false;
        state.taxCodesError = action.payload as string;
      });

    // ── Session boundary ────────────────────────────────────────────────
    // This is the only persisted slice in the app (see the persistReducer
    // whitelist in store/index.ts), so it's the one place a value can
    // survive across users on a shared browser. Reset it to initialState on
    // every session start/end (see sessionBoundary.ts) — before any
    // component can read a qbConnectionId left over from whoever used this
    // browser last. Must come after every addCase above — RTK's builder
    // requires all addCase calls before any addMatcher call.
    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export const { setConnected } = quickBooksSlice.actions;
export default quickBooksSlice.reducer;
