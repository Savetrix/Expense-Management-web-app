import { createAsyncThunk } from "@reduxjs/toolkit";

import api from "../../lib/api";
import { RootState } from "..";
import type { InvoiceRecord } from "./invoiceSlice";

// ======================================
// TYPES
// ======================================

interface ScanInvoicePayload {
  files: File[];
  qbId: string;
}

// ======================================
// COMMON ERROR HANDLER
// ======================================

const getErrorMessage = (error: any) => {
  const status = error?.response?.status;

  if (status === 401) {
    return "Your session has expired. Please login again.";
  }

  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Something went wrong"
  );
};

// ======================================
// SCAN INVOICE
// ======================================

export const scanInvoice = createAsyncThunk(
  "invoice/scanInvoice",
  async (data: ScanInvoicePayload, thunkAPI) => {
    try {
      // NOTE(web-port fix): the version of this thunk inherited from the
      // logic-layer port appended a React-Native-style {uri, name, type}
      // object to FormData, which only works with RN's FormData polyfill.
      // In a real browser, FormData.append requires an actual File/Blob —
      // anything else gets silently coerced via toString() and the upload
      // parses as garbage server-side. Fixed to take a browser File directly.
      // All files share the "files" field name — that's how multer's
      // upload.array("files", 10) collects them into req.files server-side.
      const formData = new FormData();
      data.files.forEach((file) => formData.append("files", file, file.name));

      const response = await api.post("/invoices", formData, {
        headers: {
          // Don't set Content-Type manually — the browser (and axios) needs
          // to generate its own multipart boundary for FormData. Setting
          // "multipart/form-data" without a boundary here breaks upload
          // parsing on the server.
          "X-QB-Id": data.qbId,
        },
      });

      return response.data;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);

// ======================================
// GET INVOICE DETAILS
// ======================================

export const getInvoiceDetails = createAsyncThunk(
  "invoice/getInvoiceDetails",

  async (invoiceId: string, thunkAPI) => {
    try {
      console.log("========== GET INVOICE DETAILS ==========");

      const response = await api.get(`/invoices/${invoiceId}`);

      console.log("========== GET DETAILS SUCCESS ==========");

      // API wraps invoice under data.invoice — unwrap it so the rest of the
      // app can treat the payload as the invoice object directly.
      const payload = response.data;
      return payload?.data?.invoice ?? payload?.data ?? payload;
    } catch (error: any) {
      console.log("========== GET DETAILS ERROR ==========");
      console.log(error);
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);

// ======================================
// GET ALL INVOICES
// ======================================

export const getInvoices = createAsyncThunk(
  "invoice/getInvoices",

  async (_, thunkAPI) => {
    try {
      console.log("========== GET ALL INVOICES ==========");

      const firstResponse = await api.get("/invoices?page=1&limit=100");
      const firstData = firstResponse.data?.data;
      const totalPages = firstData?.pagination?.totalPages || 1;
      const allInvoices: InvoiceRecord[] = [...(firstData?.invoices || [])];

      if (totalPages > 1) {
        const pageRequests = [];

        for (let page = 2; page <= totalPages; page++) {
          pageRequests.push(api.get(`/invoices?page=${page}&limit=100`));
        }

        const remainingResponses = await Promise.all(pageRequests);

        remainingResponses.forEach((res) => {
          allInvoices.push(...(res.data?.data?.invoices || []));
        });
      }

      // Dedupe by _id. Invoices are fetched page-by-page with no server-side
      // ordering guarantee, so a record created/updated mid-fetch can appear
      // on two pages (or the backend can simply return a duplicate). Keeping
      // them all would render the same invoice twice in every list screen and
      // make a single scan look like two identical bills in QuickBooks.
      // First occurrence wins; later ones are dropped.
      const seen = new Set<string>();
      const uniqueInvoices = allInvoices.filter((inv) => {
        if (!inv?._id) return true;
        if (seen.has(inv._id)) return false;
        seen.add(inv._id);
        return true;
      });

      console.log("========== GET INVOICES SUCCESS ==========");
      console.log(`Total invoices fetched: ${allInvoices.length}, unique: ${uniqueInvoices.length}`);

      return uniqueInvoices;
    } catch (error: any) {
      console.log("========== GET INVOICES ERROR ==========");
      console.log(error);
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);

// ======================================
// POST INVOICE TO QUICKBOOKS
// ======================================

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** GL account ID assigned by the LLM / user */
  glAccountId?: string;
}

export interface PostInvoiceExtractedData {
  vendorName: string;
  currency: string;
  invoiceNumber: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  /** Top-level GL account ID */
  glAccountId?: string | null;
  taxCodeId?: string | null;
  lineItems: LineItem[];
  description?: string | null;
  vendorAddress?: string | null;
  /** Matches API field name `bankingDetails` (not vendorBankDetails) */
  bankingDetails?: string | null;
}

interface PostInvoicePayload {
  invoiceId: string;
  vendorId: string;
  extractedData: PostInvoiceExtractedData;
}

// Concurrent-post lock: an invoice must never have two posts in flight at
// once. The idempotency checks below both read state, so two posts that start
// together (double-click, or the review page and the chatbot posting at the
// same time) can both pass those reads before either one commits — the second
// PATCH then creates a duplicate bill in QuickBooks. The second post is
// refused outright while the first is still running.
const postingInFlight = new Set<string>();

export const postInvoiceToQuickBooks = createAsyncThunk(
  "invoice/postInvoiceToQuickBooks",

  async (data: PostInvoicePayload, thunkAPI) => {
    // A post with no resolved vendor is exactly the "invoice for a new vendor
    // threw an error but was still posted" failure mode: an empty vendorId
    // must never be sent, regardless of which caller reaches this thunk.
    // The review page guards this already; this is defense in depth at the
    // choke point every posting path funnels through.
    if (!data.vendorId || !String(data.vendorId).trim()) {
      return thunkAPI.rejectWithValue(
        "Cannot post to QuickBooks: no vendor is resolved for this invoice. Resolve the vendor first.",
      );
    }

    if (postingInFlight.has(data.invoiceId)) {
      return thunkAPI.rejectWithValue(
        "This invoice is already being posted to QuickBooks. Wait for the current post to finish.",
      );
    }
    postingInFlight.add(data.invoiceId);

    try {
      try {
        // Idempotency guard. The scan pipeline is not transactional: an
        // upload/auto-post can fail (or error on a 401 that retries) AFTER the
        // backend has already created the bill in QuickBooks. Re-running this
        // post in that state creates a second, identical bill. So before
        // touching the API, look the invoice up in Redux and refuse to post if
        // it already carries a billId or a terminal posted status.
        const state = thunkAPI.getState() as RootState;
        const knownInvoices: InvoiceRecord[] = [
          ...state.invoice.invoices,
          state.invoice.selectedInvoice,
          state.invoice.invoiceDetails,
        ].filter((inv): inv is InvoiceRecord => Boolean(inv));

        const existing = knownInvoices.find((inv) => inv._id === data.invoiceId);

        if (existing) {
          const alreadyPosted =
            existing.postedStatus === "auto" ||
            existing.postedStatus === "manual" ||
            Boolean(existing.quickbooks?.billId);

          if (alreadyPosted) {
            return thunkAPI.rejectWithValue(
              `Invoice is already posted to QuickBooks${existing.quickbooks?.billId ? ` (bill #${existing.quickbooks.billId})` : ""}. It was not re-posted to avoid creating a duplicate bill.`,
            );
          }
        }

        // The Redux check above only catches what this tab already knows. The
        // dangerous case is the opposite one: the backend committed the bill and
        // the client never found out (timeout, or a 401 on a write that is no
        // longer re-sent), so Redux still says "pending". Ask the server for the
        // invoice's current state before posting. This mirrors the guard the
        // chatbot path performs in src/lib/chatbot/tools.ts.
        //
        // A failed preflight deliberately does NOT block the post — refusing on
        // a transient read error would make posting impossible while the real
        // first post is still legitimate.
        try {
          const fresh = await api.get(`/invoices/${data.invoiceId}`);
          const body = fresh.data?.data ?? fresh.data;
          const serverInvoice: InvoiceRecord | undefined =
            body && typeof body === "object" && "invoice" in body ? body.invoice : body;

          if (serverInvoice) {
            const serverSaysPosted =
              serverInvoice.postedStatus === "auto" ||
              serverInvoice.postedStatus === "manual" ||
              Boolean(serverInvoice.quickbooks?.billId);

            if (serverSaysPosted) {
              return thunkAPI.rejectWithValue(
                `Invoice is already posted to QuickBooks${serverInvoice.quickbooks?.billId ? ` (bill #${serverInvoice.quickbooks.billId})` : ""}. It was not re-posted to avoid creating a duplicate bill.`,
              );
            }
          }
        } catch {
          // Preflight unavailable — fall through to the post itself.
        }

        console.log("========== POST TO QB ==========");

        const response = await api.patch(`/invoices/${data.invoiceId}`, {
          vendorId: data.vendorId,
          postedStatus: "manual",
          extractedData: data.extractedData,
        });

        console.log("========== POST QB SUCCESS ==========");

        return response.data;
      } catch (error: any) {
        console.log("========== POST QB ERROR ==========");
        console.log(error);
        return thunkAPI.rejectWithValue(getErrorMessage(error));
      }
    } finally {
      postingInFlight.delete(data.invoiceId);
    }
  },
);

// ======================================
// UPDATE INVOICE EXTRACTED DATA (e.g. GL account)
// ======================================
// Deliberately separate from postInvoiceToQuickBooks — that thunk always
// forces postedStatus to "manual", which would be wrong here since this is
// used to patch a single field (like glAccountId) on an invoice regardless
// of its current status (auto/pending/failed).

interface UpdateInvoiceExtractedDataPayload {
  invoiceId: string;
  extractedData: Partial<PostInvoiceExtractedData>;
}

export const updateInvoiceExtractedData = createAsyncThunk(
  "invoice/updateInvoiceExtractedData",

  async (data: UpdateInvoiceExtractedDataPayload, thunkAPI) => {
    try {
      console.log("========== UPDATE INVOICE EXTRACTED DATA ==========");

      const response = await api.patch(`/invoices/${data.invoiceId}`, {
        extractedData: data.extractedData,
      });

      console.log("========== UPDATE INVOICE EXTRACTED DATA SUCCESS ==========");

      return response.data;
    } catch (error: any) {
      console.log("========== UPDATE INVOICE EXTRACTED DATA ERROR ==========");
      console.log(error);
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);

// ======================================
// REJECT INVOICE
// ======================================

interface RejectInvoicePayload {
  invoiceId: string;
  reason?: string;
}

export const rejectInvoice = createAsyncThunk(
  "invoice/rejectInvoice",

  async (data: RejectInvoicePayload, thunkAPI) => {
    try {
      console.log("========== REJECT INVOICE ==========");

      const response = await api.patch(`/invoices/${data.invoiceId}`, {
        postedStatus: "failed",
        ...(data.reason ? { reason: data.reason } : {}),
      });

      console.log("========== REJECT INVOICE SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error: any) {
      console.log("========== REJECT INVOICE ERROR ==========");
      console.log(error);
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);

// ======================================
// DELETE INVOICE
// ======================================
// Backend only allows deleting invoices with postedStatus "auto", "manual"
// or "failed" (soft delete + QB bill void) — "pending" is rejected with a
// 400. The delete response has no invoice payload, so the invoiceId is
// carried through manually for the slice to know what to remove.

interface DeleteInvoicePayload {
  invoiceId: string;
}

export const deleteInvoice = createAsyncThunk(
  "invoice/deleteInvoice",

  async (data: DeleteInvoicePayload, thunkAPI) => {
    try {
      console.log("========== DELETE INVOICE ==========");

      await api.delete(`/invoices/${data.invoiceId}`);

      console.log("========== DELETE INVOICE SUCCESS ==========");

      return { invoiceId: data.invoiceId };
    } catch (error: any) {
      console.log("========== DELETE INVOICE ERROR ==========");
      console.log(error);
      return thunkAPI.rejectWithValue(getErrorMessage(error));
    }
  },
);
