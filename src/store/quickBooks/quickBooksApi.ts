import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";
import { RootState } from "..";

// ================================
// CONNECT QUICKBOOKS
// ================================
interface ConnectQuickBooksPayload {
  accessToken: string;
  redirectAfter?: string;
  /** Present → re-auth an existing connection instead of creating a new one */
  qbConnectionId?: string;
}

export const connectQuickBooks = createAsyncThunk(
  "quickbooks/connectQuickBooks",
  async (data: ConnectQuickBooksPayload, thunkAPI) => {
    try {
      console.log("========== QUICKBOOKS CONNECT REQUEST ==========");
      const params = {
        ...(data.redirectAfter ? { redirectAfter: data.redirectAfter } : {}),
        ...(data.qbConnectionId ? { qbConnectionId: data.qbConnectionId } : {}),
      };
      console.log("GET /quickbooks/connect", params);
      const response = await api.get("/quickbooks/connect", {
        headers: { Authorization: `Bearer ${data.accessToken}` },
        params,
      });
      console.log("========== QUICKBOOKS CONNECT SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== QUICKBOOKS CONNECT ERROR ==========");
      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to connect QuickBooks";
      return thunkAPI.rejectWithValue(errorMessage);
    }
  },
);

// ================================
// GET MY QB CONNECTIONS
// ================================
interface GetMyConnectionsPayload {
  accessToken: string;
}

export const getMyQBConnections = createAsyncThunk(
  "quickbooks/getMyConnections",
  async (data: GetMyConnectionsPayload, thunkAPI) => {
    try {
      console.log("========== GET MY QB CONNECTIONS REQUEST ==========");
      // Try the correct endpoint from Postman "Get My Connections"
      const response = await api.get("/qb-connections", {
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      console.log("========== GET MY QB CONNECTIONS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== GET MY QB CONNECTIONS ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to fetch QB connections";
      const statusCode = error?.response?.status;
      return thunkAPI.rejectWithValue({ message, statusCode });
    }
  },
);

// ================================
// QB STATUS
// ================================
interface QuickBooksStatusPayload {
  accessToken: string;
  qbConnectionId: string;
}

export const getQuickBooksStatus = createAsyncThunk(
  "quickbooks/getQuickBooksStatus",
  async (data: QuickBooksStatusPayload, thunkAPI) => {
    try {
      console.log("========== QUICKBOOKS STATUS REQUEST ==========");
      const response = await api.get("/quickbooks/status", {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          "X-QB-Id": data.qbConnectionId,
        },
      });
      console.log("========== QUICKBOOKS STATUS SUCCESS ==========");
      console.log("QB STATUS PAYLOAD:", JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to fetch QuickBooks status";
      const statusCode = error?.response?.status;
      return thunkAPI.rejectWithValue({ message, statusCode });
    }
  },
);

// ================================
// UPDATE SETTINGS (auto-post / line-item-wise entry)
// ================================
interface UpdateQuickBooksSettingsPayload {
  accessToken: string;
  autoPostEnabled?: boolean;
  lineItemWiseEnabled?: boolean;
  attachInvoiceCopyEnabled?: boolean;
}

export const updateQuickBooksSettings = createAsyncThunk(
  "quickbooks/updateSettings",
  async (data: UpdateQuickBooksSettingsPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const body: Record<string, boolean> = {};
    if (data.autoPostEnabled !== undefined) body.autoPostEnabled = data.autoPostEnabled;
    if (data.lineItemWiseEnabled !== undefined) body.lineItemWiseEnabled = data.lineItemWiseEnabled;
    if (data.attachInvoiceCopyEnabled !== undefined) body.attachInvoiceCopyEnabled = data.attachInvoiceCopyEnabled;
    try {
      console.log("========== UPDATE QB SETTINGS REQUEST ==========");
      const response = await api.patch("/quickbooks/settings", body, {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
        },
      });
      console.log("========== UPDATE QB SETTINGS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== UPDATE QB SETTINGS ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to update QuickBooks settings";
      return thunkAPI.rejectWithValue(message);
    }
  },
);

// ================================
// DISCONNECT QUICKBOOKS
// ================================
interface DisconnectQuickBooksPayload {
  accessToken: string;
  qbConnectionId: string;
}

export interface DisconnectQuickBooksResponse {
  success: boolean;
  message: string;
  // Present only when the slot was locked this billing cycle: the backend
  // revokes QB access but deliberately keeps the slot reserved (see
  // invoice.controller.js lockSlotOnFirstScan) instead of a full disconnect.
  data?: {
    code?: string;
    unlockAt?: string;
    accessRevoked?: boolean;
  } | null;
}

export const disconnectQuickBooks = createAsyncThunk(
  "quickbooks/disconnectQuickBooks",
  async (data: DisconnectQuickBooksPayload, thunkAPI) => {
    try {
      console.log("========== QUICKBOOKS DISCONNECT REQUEST ==========");
      const response = await api.delete<DisconnectQuickBooksResponse>("/quickbooks/disconnect", {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          "X-QB-Id": data.qbConnectionId,
        },
      });
      console.log("========== QUICKBOOKS DISCONNECT SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== QUICKBOOKS DISCONNECT ERROR ==========");
      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to disconnect QuickBooks";
      return thunkAPI.rejectWithValue(errorMessage);
    }
  },
);

// ================================
// VENDORS
// ================================
interface CreateVendorPayload {
  accessToken: string;
  displayName: string;
  currency: string;
  // Optional QuickBooks defaults for the vendor. The backend accepts empty
  // strings for both, so they're always sent.
  glAccountId?: string;
  taxCodeId?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export const createQuickBooksVendor = createAsyncThunk(
  "quickbooks/createVendor",
  async (data: CreateVendorPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const headers = {
      Authorization: `Bearer ${data.accessToken}`,
      ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
    };
    const glAccountId = data.glAccountId || "";
    const taxCodeId = data.taxCodeId || "";

    try {
      console.log("========== CREATE VENDOR REQUEST ==========");
      const response = await api.post(
        "/quickbooks/vendors",
        {
          displayName: data.displayName,
          currency: data.currency,
          glAccountId,
          taxCodeId,
          ...(data.email ? { email: data.email } : {}),
          ...(data.phone ? { phone: data.phone } : {}),
          ...(data.address ? { address: data.address } : {}),
        },
        { headers },
      );
      console.log("========== CREATE VENDOR SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || "";

      // QBO error code 6000: companies without Multi-Currency enabled reject
      // any CurrencyRef on the vendor payload, regardless of which currency
      // was picked. Retry once without `currency` — the vendor then just
      // gets the company's home currency instead of hard-failing.
      if (message.includes("Multi Currency should be enabled")) {
        try {
          console.log(
            "========== RETRYING CREATE VENDOR WITHOUT CURRENCY ==========",
          );
          const retryResponse = await api.post(
            "/quickbooks/vendors",
            {
              displayName: data.displayName,
              glAccountId,
              taxCodeId,
              ...(data.email ? { email: data.email } : {}),
              ...(data.phone ? { phone: data.phone } : {}),
              ...(data.address ? { address: data.address } : {}),
            },
            { headers },
          );
          console.log("========== CREATE VENDOR SUCCESS (no currency) ==========");
          console.log(JSON.stringify(retryResponse.data, null, 2));
          return retryResponse.data;
        } catch (retryError: any) {
          console.log("========== CREATE VENDOR RETRY ERROR ==========");
          return thunkAPI.rejectWithValue({
            message:
              retryError?.response?.data?.message ||
              retryError?.message ||
              "Failed to create vendor",
            statusCode: retryError?.response?.data?.statusCode,
          });
        }
      }

      console.log("========== CREATE VENDOR ERROR ==========");
      return thunkAPI.rejectWithValue({
        message: message || "Failed to create vendor",
        statusCode: error?.response?.data?.statusCode,
      });
    }
  },
);

interface UpdateVendorPayload {
  accessToken: string;
  vendorId: string;
  displayName?: string;
  currency?: string;
  glAccountId?: string;
  taxCodeId?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export const updateQuickBooksVendor = createAsyncThunk(
  "quickbooks/updateVendor",
  async (data: UpdateVendorPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const headers = {
      Authorization: `Bearer ${data.accessToken}`,
      ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
    };
    const { vendorId, ...rest } = data;
    const body: Record<string, string> = {};
    if (rest.displayName !== undefined) body.displayName = rest.displayName;
    if (rest.currency !== undefined) body.currency = rest.currency;
    if (rest.glAccountId !== undefined) body.glAccountId = rest.glAccountId;
    if (rest.taxCodeId !== undefined) body.taxCodeId = rest.taxCodeId;
    if (rest.email !== undefined) body.email = rest.email;
    if (rest.phone !== undefined) body.phone = rest.phone;
    if (rest.address !== undefined) body.address = rest.address;

    try {
      console.log("========== UPDATE VENDOR REQUEST ==========");
      const response = await api.patch(`/quickbooks/vendors/${vendorId}`, body, { headers });
      console.log("========== UPDATE VENDOR SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || "";

      // Same QBO error-code-6000 workaround as create — retry once without
      // the currency change if the company doesn't have Multi-Currency on.
      if (message.includes("Multi Currency should be enabled") && body.currency !== undefined) {
        const bodyWithoutCurrency = { ...body };
        delete bodyWithoutCurrency.currency;
        try {
          console.log("========== RETRYING UPDATE VENDOR WITHOUT CURRENCY ==========");
          const retryResponse = await api.patch(`/quickbooks/vendors/${vendorId}`, bodyWithoutCurrency, { headers });
          console.log("========== UPDATE VENDOR SUCCESS (no currency) ==========");
          console.log(JSON.stringify(retryResponse.data, null, 2));
          return retryResponse.data;
        } catch (retryError: any) {
          console.log("========== UPDATE VENDOR RETRY ERROR ==========");
          return thunkAPI.rejectWithValue({
            message: retryError?.response?.data?.message || retryError?.message || "Failed to update vendor",
            statusCode: retryError?.response?.data?.statusCode,
          });
        }
      }

      console.log("========== UPDATE VENDOR ERROR ==========");
      return thunkAPI.rejectWithValue({
        message: message || "Failed to update vendor",
        statusCode: error?.response?.data?.statusCode,
      });
    }
  },
);

interface DeleteVendorPayload {
  accessToken: string;
  vendorId: string;
}

export const deleteQuickBooksVendor = createAsyncThunk(
  "quickbooks/deleteVendor",
  async (data: DeleteVendorPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const headers = {
      Authorization: `Bearer ${data.accessToken}`,
      ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
    };

    try {
      console.log("========== DELETE VENDOR REQUEST ==========");
      const response = await api.delete(`/quickbooks/vendors/${data.vendorId}`, { headers });
      console.log("========== DELETE VENDOR SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return { ...response.data, vendorId: data.vendorId };
    } catch (error: any) {
      console.log("========== DELETE VENDOR ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to delete vendor";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

interface ReactivateVendorPayload {
  accessToken: string;
  vendorId: string;
}

export const reactivateQuickBooksVendor = createAsyncThunk(
  "quickbooks/reactivateVendor",
  async (data: ReactivateVendorPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const headers = {
      Authorization: `Bearer ${data.accessToken}`,
      ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
    };

    try {
      console.log("========== REACTIVATE VENDOR REQUEST ==========");
      const response = await api.post(`/quickbooks/vendors/${data.vendorId}/reactivate`, {}, { headers });
      console.log("========== REACTIVATE VENDOR SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return { ...response.data, vendorId: data.vendorId };
    } catch (error: any) {
      console.log("========== REACTIVATE VENDOR ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to reactivate vendor";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

interface FetchVendorsPayload {
  accessToken: string;
}

// Deliberately separate from fetchQuickBooksVendors below (which backs
// state.quickBooks.vendors — the shared active-vendor cache other screens
// like VendorResolutionContent rely on for invoice matching). Fetching
// inactive vendors through that same thunk/reducer would overwrite the
// shared cache with deactivated vendors. This one is read directly from its
// return value by the caller and never touches the slice.
interface FetchInactiveVendorsPayload {
  accessToken: string;
}

export const fetchInactiveQuickBooksVendors = createAsyncThunk(
  "quickbooks/fetchInactiveVendors",
  async (data: FetchInactiveVendorsPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    try {
      console.log("========== FETCH INACTIVE VENDORS REQUEST ==========");
      const response = await api.get("/quickbooks/vendors", {
        params: { status: "inactive" },
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
        },
      });
      console.log("========== FETCH INACTIVE VENDORS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data.data.vendors;
    } catch (error: any) {
      console.log("========== FETCH INACTIVE VENDORS ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to fetch inactive vendors";
      return thunkAPI.rejectWithValue(message);
    }
  },
);

export const fetchQuickBooksVendors = createAsyncThunk(
  "quickbooks/fetchVendors",
  async (data: FetchVendorsPayload, thunkAPI) => {
    try {
      console.log("========== FETCH VENDORS REQUEST ==========");
      const state = thunkAPI.getState() as RootState;
      const qbConnectionId = state.quickBooks.qbConnectionId;
      const response = await api.get("/quickbooks/vendors", {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
        },
      });
      console.log("========== FETCH VENDORS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data.data.vendors;
    } catch (error: any) {
      console.log("========== FETCH VENDORS ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to fetch vendors";
      return thunkAPI.rejectWithValue(message);
    }
  },
);

// ================================
// SYNC VENDORS (pull latest from QuickBooks)
// ================================
interface SyncVendorsPayload {
  accessToken: string;
}

export const syncQuickBooksVendors = createAsyncThunk(
  "quickbooks/syncVendors",
  async (data: SyncVendorsPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    try {
      console.log("========== SYNC VENDORS REQUEST ==========");
      const response = await api.post(
        "/quickbooks/vendors/sync",
        {},
        {
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
            ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
          },
        },
      );
      console.log("========== SYNC VENDORS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== SYNC VENDORS ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to sync vendors from QuickBooks";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

// ================================
// GL ACCOUNTS
// ================================
interface FetchAccountsPayload {
  accessToken: string;
}

export const fetchQuickBooksAccounts = createAsyncThunk(
  "quickbooks/fetchAccounts",
  async (data: FetchAccountsPayload, thunkAPI) => {
    try {
      console.log("========== FETCH GL ACCOUNTS REQUEST ==========");
      const state = thunkAPI.getState() as RootState;
      const qbConnectionId = state.quickBooks.qbConnectionId;
      const response = await api.get("/quickbooks/accounts", {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
        },
      });
      console.log("========== FETCH GL ACCOUNTS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data.data.accounts;
    } catch (error: any) {
      console.log("========== FETCH GL ACCOUNTS ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to fetch GL accounts";
      return thunkAPI.rejectWithValue(message);
    }
  },
);

interface CreateAccountPayload {
  accessToken: string;
  name: string;
  accountType: string;
  accountSubType?: string;
}

export const createQuickBooksAccount = createAsyncThunk(
  "quickbooks/createAccount",
  async (data: CreateAccountPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    const headers = {
      Authorization: `Bearer ${data.accessToken}`,
      ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
    };

    try {
      console.log("========== CREATE GL ACCOUNT REQUEST ==========");
      const response = await api.post(
        "/quickbooks/accounts",
        {
          name: data.name,
          accountType: data.accountType,
          ...(data.accountSubType ? { accountSubType: data.accountSubType } : {}),
        },
        { headers },
      );
      console.log("========== CREATE GL ACCOUNT SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== CREATE GL ACCOUNT ERROR ==========");
      const message = error?.response?.data?.message || error?.message || "Failed to create GL account";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

// ================================
// SYNC GL ACCOUNTS (pull latest from QuickBooks)
// ================================
interface SyncAccountsPayload {
  accessToken: string;
}

export const syncQuickBooksAccounts = createAsyncThunk(
  "quickbooks/syncAccounts",
  async (data: SyncAccountsPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    try {
      console.log("========== SYNC GL ACCOUNTS REQUEST ==========");
      const response = await api.post(
        "/quickbooks/accounts/sync",
        {},
        {
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
            ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
          },
        },
      );
      console.log("========== SYNC GL ACCOUNTS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== SYNC GL ACCOUNTS ERROR ==========");
      const message =
        error?.response?.data?.message || error?.message || "Failed to sync GL accounts from QuickBooks";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

// ================================
// TAX CODES
// ================================
interface FetchTaxCodesPayload {
  accessToken: string;
}

export const fetchQuickBooksTaxCodes = createAsyncThunk(
  "quickbooks/fetchTaxCodes",
  async (data: FetchTaxCodesPayload, thunkAPI) => {
    try {
      console.log("========== FETCH TAX CODES REQUEST ==========");
      const state = thunkAPI.getState() as RootState;
      const qbConnectionId = state.quickBooks.qbConnectionId;
      const response = await api.get("/quickbooks/taxcodes", {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
        },
      });
      console.log("========== FETCH TAX CODES SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      // List endpoints wrap their payload as data.<entity> (data.vendors,
      // data.accounts), but /quickbooks/taxcodes wraps it as data.items
      // (confirmed against the live backend response) — normalize through
      // all the keys we've seen.
      const payload = response.data?.data;
      return (
        payload?.items ||
        payload?.taxCodes ||
        payload?.taxcodes ||
        (Array.isArray(payload) ? payload : [])
      );
    } catch (error: any) {
      console.log("========== FETCH TAX CODES ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to fetch tax codes";
      return thunkAPI.rejectWithValue(message);
    }
  },
);

// ================================
// SYNC TAX CODES (pull latest from QuickBooks)
// ================================
interface SyncTaxCodesPayload {
  accessToken: string;
}

export const syncQuickBooksTaxCodes = createAsyncThunk(
  "quickbooks/syncTaxCodes",
  async (data: SyncTaxCodesPayload, thunkAPI) => {
    const state = thunkAPI.getState() as RootState;
    const qbConnectionId = state.quickBooks.qbConnectionId;
    try {
      console.log("========== SYNC TAX CODES REQUEST ==========");
      const response = await api.post(
        "/quickbooks/taxcodes/sync",
        {},
        {
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
            ...(qbConnectionId ? { "X-QB-Id": qbConnectionId } : {}),
          },
        },
      );
      console.log("========== SYNC TAX CODES SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== SYNC TAX CODES ERROR ==========");
      const message =
        error?.response?.data?.message || error?.message || "Failed to sync tax codes from QuickBooks";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.data?.statusCode });
    }
  },
);

// ================================
// TEAM — INVITE MEMBER
// ================================
export type QBMemberRole = "admin" | "accountant" | "contributor";

interface InviteQBMemberPayload {
  accessToken: string;
  qbId: string;
  email: string;
  role: QBMemberRole;
}

export const inviteQBMember = createAsyncThunk(
  "quickbooks/inviteMember",
  async (data: InviteQBMemberPayload, thunkAPI) => {
    try {
      console.log("========== INVITE QB MEMBER REQUEST ==========");
      console.log(`POST /qb-connections/${data.qbId}/members`, {
        email: data.email,
        role: data.role,
      });
      const response = await api.post(
        `/qb-connections/${data.qbId}/members`,
        { email: data.email, role: data.role },
        {
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
            "X-QB-Id": data.qbId,
          },
        },
      );
      console.log("========== INVITE QB MEMBER SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== INVITE QB MEMBER ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to send invite";
      return thunkAPI.rejectWithValue({
        message,
        statusCode: error?.response?.status,
      });
    }
  },
);

// ================================
// TEAM — GET MEMBERS
// ================================
interface FetchQBMembersPayload {
  qbId: string;
}

export const fetchQBMembers = createAsyncThunk(
  "quickbooks/fetchMembers",
  async (data: FetchQBMembersPayload, thunkAPI) => {
    try {
      console.log("========== FETCH QB MEMBERS REQUEST ==========");
      console.log(`GET /qb-connections/${data.qbId}/members`);
      const response = await api.get(`/qb-connections/${data.qbId}/members`, {
        headers: { "X-QB-Id": data.qbId },
      });
      console.log("========== FETCH QB MEMBERS SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== FETCH QB MEMBERS ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to fetch team members";
      return thunkAPI.rejectWithValue({
        message,
        statusCode: error?.response?.status,
      });
    }
  },
);

// ================================
// TEAM — REMOVE MEMBER
// ================================
interface RemoveQBMemberPayload {
  qbId: string;
  memberId: string;
}

export const removeQBMember = createAsyncThunk(
  "quickbooks/removeMember",
  async (data: RemoveQBMemberPayload, thunkAPI) => {
    try {
      console.log("========== REMOVE QB MEMBER REQUEST ==========");
      console.log(`DELETE /qb-connections/${data.qbId}/members/${data.memberId}`);
      const response = await api.delete(
        `/qb-connections/${data.qbId}/members/${data.memberId}`,
        { headers: { "X-QB-Id": data.qbId } },
      );
      console.log("========== REMOVE QB MEMBER SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return { ...response.data, memberId: data.memberId };
    } catch (error: any) {
      console.log("========== REMOVE QB MEMBER ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to remove member";
      return thunkAPI.rejectWithValue({
        message,
        statusCode: error?.response?.status,
      });
    }
  },
);

// ================================
// TEAM — ACCEPT INVITE
// ================================
// NOTE: the invite link's query param is named `token` (/invite/accept?token=xxx),
// but the backend body field for this endpoint is `inviteToken`. Callers pass
// whichever raw value they have (from the URL `token` param, or from the
// `inviteToken` param on the /register deep link) as `inviteToken` here.
interface AcceptQBInvitePayload {
  inviteToken: string;
}

export const acceptQBInvite = createAsyncThunk(
  "quickbooks/acceptInvite",
  async (data: AcceptQBInvitePayload, thunkAPI) => {
    try {
      console.log("========== ACCEPT QB INVITE REQUEST ==========");
      const response = await api.post("/qb-connections/invite/accept", {
        inviteToken: data.inviteToken,
      });
      console.log("========== ACCEPT QB INVITE SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== ACCEPT QB INVITE ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to accept invite";
      return thunkAPI.rejectWithValue({
        message,
        statusCode: error?.response?.status,
      });
    }
  },
);
