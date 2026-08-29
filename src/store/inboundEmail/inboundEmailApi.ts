// Thunks for the email-forwarding routes under /api/inbound.
//
// Like chat/chatApi.ts and unlike every other *Api.ts in this folder, these do
// NOT go through lib/api.ts: the endpoints are this app's own route handlers on
// the same origin, not the Savetrix backend, so there is no baseURL to resolve
// and no refresh-token interceptor to inherit. Credentials are passed explicitly
// from Redux state.
//
// ── WHY THE REFRESH TOKEN IS SENT, ONCE, DELIBERATELY ────────────────────────
// Enabling forwarding delegates the caller's session to the server so an inbound
// email — which has no browser session — can create an invoice as them. That is
// the whole mechanism (see lib/inboundEmail/ingest.ts). It is sent only on the
// two paths that establish or repair the delegation (`enable`, `reconnect`),
// never on a read, and the server seals it with AES-256-GCM before storing it.
//
// The server independently proves the token is valid AND belongs to the caller
// before storing it, so nothing here is taken on trust.
import { createAsyncThunk } from "@reduxjs/toolkit";

import { SESSION_EXPIRED, sessionEmitter } from "../../lib/sessionManager";
// Type-only: the slice imports this file and store/index imports the slice, so
// a value import here would close a runtime cycle.
import type { RootState } from "..";

const BASE_URL = "/api/inbound";

export interface InboundAlias {
  id: string;
  receivingAddress: string;
  companyName: string;
  qbConnectionId: string;
  active: boolean;
  rotationVersion: number;
  ownerEmail: string;
  additionalSenders: string[];
  delegationActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface InboundAuthDiagnostics {
  authenticationResults: string | null;
  receivedSpf: string | null;
  returnPath: string | null;
  authservId: string | null;
  trust: "verified" | "advisory" | "absent" | "rejected";
}

export interface InboundActivityEntry {
  correlationId: string;
  receivedAt: string;
  subject: string | null;
  senderEmail: string | null;
  status: string;
  rejectionCode: string | null;
  detail: string | null;
  invoiceCount: number;
  companyName: string | null;
  qbConnectionId?: string | null;
  authDiagnostics: InboundAuthDiagnostics | null;
}

export interface InboundOverview {
  enabled: boolean;
  domain: string;
  aliases: InboundAlias[];
  recentActivity: InboundActivityEntry[];
}

export interface RejectionValue {
  message: string;
  statusCode?: number;
  /** Present when the deployment is missing env vars, so the UI can say which. */
  missing?: string[];
}

class InboundRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly missing?: string[],
  ) {
    super(message);
    this.name = "InboundRequestError";
  }
}

function requireAccessToken(state: RootState): string {
  const accessToken: string | undefined = state.auth.user?.data?.accessToken;
  if (!accessToken) throw new InboundRequestError("You need to sign in.", 401);
  return accessToken;
}

/** Only the delegation paths need this, and only from Redux — never re-read from storage. */
function requireRefreshToken(state: RootState): string {
  const refreshToken: string | undefined = state.auth.user?.data?.refreshToken;
  if (!refreshToken) {
    throw new InboundRequestError(
      "Sign out and sign in again to enable email forwarding.",
      400,
    );
  }
  return refreshToken;
}

/**
 * The signed-in account's email, as the login response reported it
 * (`user.data.user.email` — the same path AppShell and ProfileContent read).
 *
 * Sent as a FALLBACK for the sender allow-list. The server prefers its own
 * sources and only falls back to this when the backend will not name the
 * account — which, on this backend, is always. See
 * src/lib/inboundEmail/identity.ts for why that is safe.
 */
function accountEmail(state: RootState): string | null {
  const email: unknown = state.auth.user?.data?.user?.email;
  return typeof email === "string" && email.trim() ? email.trim() : null;
}

async function inboundFetch(state: RootState, path: string, init?: RequestInit): Promise<Response> {
  const accessToken = requireAccessToken(state);
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  if (response.ok) return response;

  // A server-rejected token means this session is over, not that the feature is
  // broken — same handling as chat history.
  if (response.status === 401) sessionEmitter.emit(SESSION_EXPIRED);
  const body = await response.json().catch(() => null);
  throw new InboundRequestError(
    body?.error || "Couldn't reach email forwarding settings. Please try again.",
    response.status,
    Array.isArray(body?.missing) ? body.missing : undefined,
  );
}

function reject(error: unknown, fallback: string): RejectionValue {
  if (error instanceof InboundRequestError) {
    return { message: error.message, statusCode: error.statusCode, missing: error.missing };
  }
  return { message: error instanceof Error ? error.message : fallback };
}

// ================================
// OVERVIEW
// ================================

export const fetchInboundOverview = createAsyncThunk<
  InboundOverview,
  void,
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/fetchOverview", async (_: void, thunkAPI) => {
  try {
    const response = await inboundFetch(thunkAPI.getState(), "/aliases");
    return (await response.json()) as InboundOverview;
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't load email forwarding."));
  }
});

// ================================
// ENABLE FOR A COMPANY
// ================================

export const enableInboundForwarding = createAsyncThunk<
  InboundAlias,
  { qbConnectionId: string },
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/enable", async ({ qbConnectionId }, thunkAPI) => {
  try {
    const state = thunkAPI.getState();
    const response = await inboundFetch(state, "/aliases", {
      method: "POST",
      body: JSON.stringify({
        qbConnectionId,
        // The delegation. Sent once, over HTTPS, to our own origin.
        refreshToken: requireRefreshToken(state),
        // Fallback only — the server uses its own sources when it has any.
        ownerEmail: accountEmail(state),
      }),
    });
    const body = (await response.json()) as { alias: InboundAlias };
    return body.alias;
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't turn on email forwarding."));
  }
});

// ================================
// REVOKE
// ================================

export const revokeInboundForwarding = createAsyncThunk<
  { id: string; purged: boolean; alias: InboundAlias | null },
  { id: string; purge?: boolean },
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/revoke", async ({ id, purge = false }, thunkAPI) => {
  try {
    const response = await inboundFetch(
      thunkAPI.getState(),
      `/aliases/${encodeURIComponent(id)}${purge ? "?purge=true" : ""}`,
      { method: "DELETE" },
    );
    const body = (await response.json()) as { alias?: InboundAlias; status: string };
    return { id, purged: body.status === "purged", alias: body.alias ?? null };
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't turn off email forwarding."));
  }
});

// ================================
// REGENERATE THE ADDRESS
// ================================

export const regenerateInboundAddress = createAsyncThunk<
  { previousId: string; alias: InboundAlias },
  { id: string },
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/regenerate", async ({ id }, thunkAPI) => {
  try {
    const response = await inboundFetch(thunkAPI.getState(), `/aliases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "regenerate" }),
    });
    const body = (await response.json()) as { alias: InboundAlias };
    return { previousId: id, alias: body.alias };
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't generate a new address."));
  }
});

// ================================
// RECONNECT A DEAD DELEGATION
// ================================

export const reconnectInboundForwarding = createAsyncThunk<
  InboundAlias,
  { id: string },
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/reconnect", async ({ id }, thunkAPI) => {
  try {
    const state = thunkAPI.getState();
    const response = await inboundFetch(state, `/aliases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reconnect", refreshToken: requireRefreshToken(state) }),
    });
    const body = (await response.json()) as { alias: InboundAlias };
    return body.alias;
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't reconnect email forwarding."));
  }
});

// ================================
// ADDITIONAL SENDERS
// ================================

export const updateInboundSenders = createAsyncThunk<
  InboundAlias,
  { id: string; additionalSenders: string[] },
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/updateSenders", async ({ id, additionalSenders }, thunkAPI) => {
  try {
    const response = await inboundFetch(thunkAPI.getState(), `/aliases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "senders", additionalSenders }),
    });
    const body = (await response.json()) as { alias: InboundAlias };
    return body.alias;
  } catch (error) {
    return thunkAPI.rejectWithValue(reject(error, "Couldn't update the sender list."));
  }
});

// ================================
// WHICH INVOICES CAME FROM EMAIL
// ================================

export const fetchEmailInvoiceIds = createAsyncThunk<
  string[],
  void,
  { state: RootState; rejectValue: RejectionValue }
>("inboundEmail/fetchSources", async (_: void, thunkAPI) => {
  try {
    const response = await inboundFetch(thunkAPI.getState(), "/sources");
    const body = (await response.json()) as { emailInvoiceIds: string[] };
    return Array.isArray(body.emailInvoiceIds) ? body.emailInvoiceIds : [];
  } catch (error) {
    // A missing badge is cosmetic. Reject quietly so the invoice list still
    // renders when this deployment has no inbound config at all.
    return thunkAPI.rejectWithValue(reject(error, "Couldn't load invoice sources."));
  }
});
