// Email-forwarding state: the caller's receiving addresses, recent inbound
// activity, and which invoices arrived by email.
//
// Deliberately NOT persisted (like chatSlice): every field is server-owned and
// cheap to re-read, and a stale cached receiving address is worse than a
// momentary spinner — an accountant might copy an address that has since been
// regenerated and forward invoices into a black hole.
import { createSlice } from "@reduxjs/toolkit";

import {
  claimInboundUsername,
  enableInboundForwarding,
  fetchEmailInvoiceIds,
  fetchInboundOverview,
  reconnectInboundForwarding,
  regenerateInboundAddress,
  revokeInboundForwarding,
  updateInboundSenders,
  type InboundActivityEntry,
  type InboundAlias,
} from "./inboundEmailApi";
import { isSessionBoundary } from "../sessionBoundary";

interface InboundEmailState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Env vars this deployment is missing, when the routes report a 503. */
  missingConfig: string[];
  /** Global kill switch as the server reports it. */
  enabled: boolean;
  domain: string;
  aliases: InboundAlias[];
  recentActivity: InboundActivityEntry[];
  /** Per-alias in-flight marker, so one row's spinner is not the whole panel's. */
  busyAliasId: string | null;
  /** Which QuickBooks company is mid-enable, keyed by connection id. */
  enablingConnectionId: string | null;
  emailInvoiceIds: string[];
}

const initialState: InboundEmailState = {
  loading: false,
  loaded: false,
  error: null,
  missingConfig: [],
  enabled: false,
  domain: "",
  aliases: [],
  recentActivity: [],
  busyAliasId: null,
  enablingConnectionId: null,
  emailInvoiceIds: [],
};

/** Newest first, matching how the server orders them. */
const upsertAlias = (aliases: InboundAlias[], next: InboundAlias): InboundAlias[] => {
  const without = aliases.filter((alias) => alias.id !== next.id);
  return [next, ...without];
};

const inboundEmailSlice = createSlice({
  name: "inboundEmail",
  initialState,
  reducers: {
    clearInboundEmailError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // ── OVERVIEW ────────────────────────────────────────────────────────────
    builder.addCase(fetchInboundOverview.pending, (state) => {
      state.loading = true;
      state.error = null;
    });
    builder.addCase(fetchInboundOverview.fulfilled, (state, action) => {
      state.loading = false;
      state.loaded = true;
      state.error = null;
      state.missingConfig = [];
      state.enabled = action.payload.enabled;
      state.domain = action.payload.domain;
      state.aliases = action.payload.aliases;
      state.recentActivity = action.payload.recentActivity;
    });
    builder.addCase(fetchInboundOverview.rejected, (state, action) => {
      state.loading = false;
      state.loaded = true;
      state.error = action.payload?.message ?? "Couldn't load email forwarding.";
      state.missingConfig = action.payload?.missing ?? [];
    });

    // ── ENABLE ──────────────────────────────────────────────────────────────
    builder.addCase(enableInboundForwarding.pending, (state, action) => {
      state.enablingConnectionId = action.meta.arg.qbConnectionId;
      state.error = null;
    });
    builder.addCase(enableInboundForwarding.fulfilled, (state, action) => {
      state.enablingConnectionId = null;
      state.aliases = upsertAlias(state.aliases, action.payload);
    });
    builder.addCase(enableInboundForwarding.rejected, (state, action) => {
      state.enablingConnectionId = null;
      state.error = action.payload?.message ?? "Couldn't turn on email forwarding.";
      state.missingConfig = action.payload?.missing ?? [];
    });

    // ── REVOKE ──────────────────────────────────────────────────────────────
    builder.addCase(revokeInboundForwarding.pending, (state, action) => {
      state.busyAliasId = action.meta.arg.id;
      state.error = null;
    });
    builder.addCase(revokeInboundForwarding.fulfilled, (state, action) => {
      state.busyAliasId = null;
      if (action.payload.purged || !action.payload.alias) {
        state.aliases = state.aliases.filter((alias) => alias.id !== action.payload.id);
      } else {
        state.aliases = upsertAlias(state.aliases, action.payload.alias);
      }
    });
    builder.addCase(revokeInboundForwarding.rejected, (state, action) => {
      state.busyAliasId = null;
      state.error = action.payload?.message ?? "Couldn't turn off email forwarding.";
    });

    // ── REGENERATE ──────────────────────────────────────────────────────────
    builder.addCase(regenerateInboundAddress.pending, (state, action) => {
      state.busyAliasId = action.meta.arg.id;
      state.error = null;
    });
    builder.addCase(regenerateInboundAddress.fulfilled, (state, action) => {
      state.busyAliasId = null;
      // The old record is purged server-side, so drop it here too rather than
      // leaving a dead address on screen next to the new one.
      state.aliases = upsertAlias(
        state.aliases.filter((alias) => alias.id !== action.payload.previousId),
        action.payload.alias,
      );
    });
    builder.addCase(regenerateInboundAddress.rejected, (state, action) => {
      state.busyAliasId = null;
      state.error = action.payload?.message ?? "Couldn't generate a new address.";
    });

    // ── USERNAME ────────────────────────────────────────────────────────────
    builder.addCase(claimInboundUsername.pending, (state, action) => {
      state.busyAliasId = action.meta.arg.id;
      state.error = null;
    });
    builder.addCase(claimInboundUsername.fulfilled, (state, action) => {
      state.busyAliasId = null;
      // The old local part is purged server-side, so drop it here too rather
      // than leaving a dead address on screen beside the new one.
      state.aliases = upsertAlias(
        state.aliases.filter((alias) => alias.id !== action.payload.previousId),
        action.payload.alias,
      );
    });
    builder.addCase(claimInboundUsername.rejected, (state, action) => {
      state.busyAliasId = null;
      state.error = action.payload?.message ?? "Couldn't set that username.";
    });

    // ── RECONNECT / SENDERS ─────────────────────────────────────────────────
    for (const thunk of [reconnectInboundForwarding, updateInboundSenders]) {
      builder.addCase(thunk.pending, (state, action) => {
        state.busyAliasId = action.meta.arg.id;
        state.error = null;
      });
      builder.addCase(thunk.fulfilled, (state, action) => {
        state.busyAliasId = null;
        state.aliases = upsertAlias(state.aliases, action.payload);
      });
      builder.addCase(thunk.rejected, (state, action) => {
        state.busyAliasId = null;
        state.error = action.payload?.message ?? "Something went wrong.";
      });
    }

    // ── INVOICE SOURCES ─────────────────────────────────────────────────────
    builder.addCase(fetchEmailInvoiceIds.fulfilled, (state, action) => {
      state.emailInvoiceIds = action.payload;
    });
    builder.addCase(fetchEmailInvoiceIds.rejected, (state) => {
      // Cosmetic only — never surface this as a page error.
      state.emailInvoiceIds = [];
    });

    // ── SESSION BOUNDARY ────────────────────────────────────────────────────
    // Receiving addresses are per-user, so a sign-out or user switch must not
    // leave the previous account's addresses on screen. addMatcher must come
    // after every addCase in the chain — RTK requires that order.
    builder.addMatcher(isSessionBoundary, () => initialState);
  },
});

export const { clearInboundEmailError } = inboundEmailSlice.actions;
export default inboundEmailSlice.reducer;
