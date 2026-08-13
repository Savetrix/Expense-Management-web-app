// Tests for the duplicate-invoice fixes:
//   1. getInvoices dedupes page-fetched results by _id (a record can appear
//      on two pages when list ordering shifts mid-fetch, or the backend can
//      return a duplicate outright — both caused the same invoice/bill to
//      show up twice and look like a duplicate in QuickBooks).
//   2. postInvoiceToQuickBooks (thunk) refuses to re-post an invoice that
//      already carries a billId or a terminal posted status, so a scan that
//      errored client-side but was actually posted server-side can never be
//      posted a second time into QuickBooks.
//
// Run with: npm test   (node --import tsx --test src/test/*.test.ts)
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";

import api from "../lib/api";
import invoiceReducer from "../store/invoice/invoiceSlice";
import {
  getInvoices,
  postInvoiceToQuickBooks,
} from "../store/invoice/invoiceApi";
import type { InvoiceRecord } from "../store/invoice/invoiceSlice";

// Save originals so we never leak mocks between tests.
const originalGet = api.get;
const originalPatch = api.patch;

afterEach(() => {
  api.get = originalGet;
  api.patch = originalPatch;
});

const makeInvoice = (overrides: Partial<InvoiceRecord>): InvoiceRecord => ({
  _id: "inv-1",
  postedStatus: "pending",
  extractedData: { vendorName: "Acme Corp", invoiceNumber: "INV-100", totalAmount: 500 },
  ...overrides,
});

const makeStore = () =>
  configureStore({
    reducer: { invoice: invoiceReducer },
  });

const listResponse = (invoices: InvoiceRecord[], totalPages = 1) => ({
  data: {
    data: {
      invoices,
      pagination: { totalPages },
    },
  },
});

describe("getInvoices dedupes by _id", () => {
  it("keeps a single copy when the same invoice appears on two pages", async () => {
    api.get = (async (...args: unknown[]) => {
      const url = args[0] as string;
      if (url === "/invoices?page=1&limit=100") {
        return listResponse(
          [makeInvoice({ _id: "inv-a", postedStatus: "pending", extractedData: { vendorName: "Alpha" } })],
          2,
        );
      }
      // Page 2 repeats the same invoice (ordering shifted between fetches).
      return listResponse(
        [makeInvoice({ _id: "inv-a", postedStatus: "pending", extractedData: { vendorName: "Alpha" } })],
      );
    }) as typeof api.get;

    const store = makeStore();
    await store.dispatch(getInvoices() as unknown as UnknownAction);

    const { invoices } = store.getState().invoice;
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]._id, "inv-a");
  });

  it("drops an exact duplicate returned by the backend on a single page", async () => {
    api.get = (async (...args: unknown[]) => {
      const url = args[0] as string;
      if (url === "/invoices?page=1&limit=100") {
        // Page 1 itself contains the same invoice twice.
        return listResponse([
          makeInvoice({ _id: "inv-b", postedStatus: "manual", extractedData: { vendorName: "Beta" } }),
          makeInvoice({ _id: "inv-c", postedStatus: "pending", extractedData: { vendorName: "Gamma" } }),
          makeInvoice({ _id: "inv-b", postedStatus: "manual", extractedData: { vendorName: "Beta" } }),
        ]);
      }
      return listResponse([]);
    }) as typeof api.get;

    const store = makeStore();
    await store.dispatch(getInvoices() as unknown as UnknownAction);

    const { invoices } = store.getState().invoice;
    assert.equal(invoices.length, 2);
    assert.deepEqual(
      invoices.map((i) => i._id).sort(),
      ["inv-b", "inv-c"],
    );
  });

  it("keeps distinct invoices intact across pages", async () => {
    api.get = (async (...args: unknown[]) => {
      const url = args[0] as string;
      if (url === "/invoices?page=1&limit=100") {
        return listResponse(
          [makeInvoice({ _id: "inv-1", postedStatus: "pending", extractedData: { vendorName: "One" } })],
          2,
        );
      }
      return listResponse(
        [makeInvoice({ _id: "inv-2", postedStatus: "pending", extractedData: { vendorName: "Two" } })],
      );
    }) as typeof api.get;

    const store = makeStore();
    await store.dispatch(getInvoices() as unknown as UnknownAction);

    const { invoices } = store.getState().invoice;
    assert.equal(invoices.length, 2);
    assert.deepEqual(
      invoices.map((i) => i._id).sort(),
      ["inv-1", "inv-2"],
    );
  });
});

describe("postInvoiceToQuickBooks idempotency guard", () => {
  const postPayload = {
    invoiceId: "inv-1",
    vendorId: "v-1",
    extractedData: {
      vendorName: "Acme Corp",
      currency: "USD",
      invoiceNumber: "INV-100",
      amountBeforeTax: 500,
      taxAmount: 0,
      totalAmount: 500,
      lineItems: [],
    },
  };

  it("does not call the PATCH when the invoice already has a billId", async () => {
    let patchCalled = false;
    api.patch = (async () => {
      patchCalled = true;
      return { data: { data: { invoice: {} } } };
    }) as typeof api.patch;

    const store = makeStore();
    store.dispatch({
      type: "invoice/getInvoices/fulfilled",
      payload: [
        makeInvoice({
          _id: "inv-1",
          postedStatus: "pending",
          quickbooks: { billId: "QB-777" },
        }),
      ],
    } as never);

    const result = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.match(String(result.payload), /already posted/i);
    assert.match(String(result.payload), /QB-777/);
    assert.equal(patchCalled, false, "PATCH must not fire when the bill already exists");
  });

  it("does not call the PATCH when postedStatus is already manual", async () => {
    let patchCalled = false;
    api.patch = (async () => {
      patchCalled = true;
      return { data: { data: { invoice: {} } } };
    }) as typeof api.patch;

    const store = makeStore();
    store.dispatch({
      type: "invoice/getInvoices/fulfilled",
      payload: [makeInvoice({ _id: "inv-1", postedStatus: "manual" })],
    } as never);

    const result = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.match(String(result.payload), /already posted/i);
    assert.equal(patchCalled, false);
  });

  it("calls the PATCH when nothing in state indicates the invoice is posted", async () => {
    const patchBody: Record<string, unknown>[] = [];
    api.patch = (async (_path: unknown, body: unknown) => {
      patchBody.push(body as Record<string, unknown>);
      return { data: { data: { invoice: { _id: "inv-1", postedStatus: "manual" } } } };
    }) as typeof api.patch;

    const store = makeStore();
    store.dispatch({
      type: "invoice/getInvoices/fulfilled",
      payload: [makeInvoice({ _id: "inv-1", postedStatus: "pending" })],
    } as never);

    const result = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    const returned = result as { type: string; payload?: unknown };
    assert.equal(returned.type, "invoice/postInvoiceToQuickBooks/fulfilled");
    assert.equal(patchBody.length, 1);
    assert.equal((patchBody[0] as { postedStatus: string }).postedStatus, "manual");
  });
});

describe("postInvoiceToQuickBooks — server-side freshness check", () => {
  // The Redux guard above only catches what THIS tab already knows. The
  // failure that actually produced duplicate bills is the opposite: the
  // backend committed the bill and the client never found out (timeout, or a
  // 401 on a write that is deliberately no longer re-sent), so Redux still
  // says "pending" and the user clicks Post again. These cover that.
  const posted = makeInvoice({ _id: "inv-9", postedStatus: "manual", quickbooks: { billId: "QB-77" } });

  const postPayload = {
    invoiceId: "inv-9",
    vendorId: "v-1",
    extractedData: {
      vendorName: "Acme Corp",
      currency: "USD",
      invoiceNumber: "INV-100",
      amountBeforeTax: 500,
      taxAmount: 0,
      totalAmount: 500,
      lineItems: [],
    },
  };

  it("refuses to post when the SERVER says it is already posted, even though local state says pending", async () => {
    const store = makeStore();
    // Local state deliberately stale: still pending.
    store.dispatch({ type: "invoice/setInvoices", payload: [makeInvoice({ _id: "inv-9" })] } as UnknownAction);

    const patchCalls: unknown[][] = [];
    api.get = (async () => ({ data: { data: { invoice: posted } } })) as unknown as typeof api.get;
    api.patch = (async (...args: unknown[]) => {
      patchCalls.push(args);
      return { data: { data: { invoice: posted } } };
    }) as unknown as typeof api.patch;

    const result = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.equal(patchCalls.length, 0, "must not PATCH — the bill already exists in QuickBooks");
    assert.match(String((result as { payload?: unknown }).payload ?? ""), /already posted/i);
    assert.match(String((result as { payload?: unknown }).payload ?? ""), /QB-77/);
  });

  it("proceeds when the server also says it is unposted", async () => {
    const store = makeStore();
    const patchCalls: unknown[][] = [];
    api.get = (async () => ({ data: { data: { invoice: makeInvoice({ _id: "inv-9" }) } } })) as unknown as typeof api.get;
    api.patch = (async (...args: unknown[]) => {
      patchCalls.push(args);
      return { data: { data: { invoice: makeInvoice({ _id: "inv-9", postedStatus: "manual" }) } } };
    }) as unknown as typeof api.patch;

    await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.equal(patchCalls.length, 1, "a legitimate first post must still go through");
  });

  it("still posts when the freshness check itself fails — a read error must not block a real first post", async () => {
    const store = makeStore();
    const patchCalls: unknown[][] = [];
    api.get = (async () => {
      throw new Error("network down");
    }) as unknown as typeof api.get;
    api.patch = (async (...args: unknown[]) => {
      patchCalls.push(args);
      return { data: { data: { invoice: makeInvoice({ _id: "inv-9", postedStatus: "manual" }) } } };
    }) as unknown as typeof api.patch;

    await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.equal(patchCalls.length, 1, "preflight failure must fail open, not lock posting out");
  });
});

describe("postInvoiceToQuickBooks — empty vendorId guard", () => {
  // A post with no resolved vendor is the "new vendor threw an error but the
  // invoice still got posted to QuickBooks" failure mode: an empty vendorId
  // must never reach the PATCH, no matter which caller reaches the thunk.
  const postPayload = {
    invoiceId: "inv-empty",
    vendorId: "",
    extractedData: {
      vendorName: "Acme Corp",
      currency: "USD",
      invoiceNumber: "INV-100",
      amountBeforeTax: 500,
      taxAmount: 0,
      totalAmount: 500,
      lineItems: [],
    },
  };

  it("refuses to post an empty vendorId — nothing is fetched or patched", async () => {
    let getCalled = false;
    let patchCalled = false;
    api.get = (async () => {
      getCalled = true;
      return { data: { data: { invoice: makeInvoice({ _id: "inv-empty" }) } } };
    }) as unknown as typeof api.get;
    api.patch = (async () => {
      patchCalled = true;
      return { data: { data: { invoice: {} } } };
    }) as unknown as typeof api.patch;

    const store = makeStore();
    const result = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );

    assert.match(String((result as { payload?: unknown }).payload ?? ""), /no vendor is resolved/i);
    assert.equal(getCalled, false, "no freshness check should run for an empty vendor");
    assert.equal(patchCalled, false, "no PATCH should fire for an empty vendor");
  });

  it("refuses a whitespace-only vendorId the same way", async () => {
    let patchCalled = false;
    api.patch = (async () => {
      patchCalled = true;
      return { data: { data: { invoice: {} } } };
    }) as unknown as typeof api.patch;

    const store = makeStore();
    const result = await store.dispatch(
      postInvoiceToQuickBooks({ ...postPayload, vendorId: "   " }) as unknown as UnknownAction,
    );

    assert.match(String((result as { payload?: unknown }).payload ?? ""), /no vendor is resolved/i);
    assert.equal(patchCalled, false);
  });
});

describe("postInvoiceToQuickBooks — concurrent in-flight lock", () => {
  // Two posts of the same invoice can both pass the idempotency preflight if
  // they start before either commits (double-click, or the review page and the
  // chatbot posting together) — the second PATCH then creates a duplicate
  // bill. The second post must be refused outright while the first is still
  // in flight, and the lock must release when the first completes.
  const postPayload = {
    invoiceId: "inv-conc",
    vendorId: "v-1",
    extractedData: {
      vendorName: "Acme Corp",
      currency: "USD",
      invoiceNumber: "INV-100",
      amountBeforeTax: 500,
      taxAmount: 0,
      totalAmount: 500,
      lineItems: [],
    },
  };

  it("refuses a second post while the first is still in flight, then releases the lock", async () => {
    const patchCalls: unknown[][] = [];
    let releasePatch: (value: unknown) => void = () => {};
    const patchGate = new Promise((resolve) => {
      releasePatch = resolve;
    });

    api.get = (async () => ({
      data: { data: { invoice: makeInvoice({ _id: "inv-conc" }) } },
    })) as unknown as typeof api.get;
    api.patch = (async (...args: unknown[]) => {
      patchCalls.push(args);
      await patchGate;
      return { data: { data: { invoice: makeInvoice({ _id: "inv-conc", postedStatus: "manual" }) } } };
    }) as unknown as typeof api.patch;

    const store = makeStore();

    let firstResult: unknown;
    try {
      const first = store.dispatch(
        postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
      );
      // The lock is registered synchronously when the thunk starts, so a
      // second dispatch immediately after must already be refused.
      const second = await store.dispatch(
        postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
      );

      assert.match(String((second as { payload?: unknown }).payload ?? ""), /already being posted/i);
      assert.equal(patchCalls.length, 1, "only the first post may reach the PATCH");

      // Let the first post finish.
      releasePatch({});
      firstResult = await first;
    } finally {
      releasePatch({});
    }

    assert.equal((firstResult as { type?: string }).type, "invoice/postInvoiceToQuickBooks/fulfilled");

    // The lock must now be released: a fresh post of the same invoice is no
    // longer refused by the in-flight lock. To prove WHICH guard is doing the
    // rejecting, make the server report the bill exists — the retry must then
    // be refused by the idempotency guard ("already posted"), not the lock
    // ("already being posted").
    api.get = (async () => ({
      data: { data: { invoice: makeInvoice({ _id: "inv-conc", postedStatus: "manual", quickbooks: { billId: "QB-CONC" } }) } },
    })) as unknown as typeof api.get;

    const retryPatchCalls = patchCalls.length;
    const retry = await store.dispatch(
      postInvoiceToQuickBooks(postPayload) as unknown as UnknownAction,
    );
    assert.equal(patchCalls.length, retryPatchCalls, "no duplicate PATCH on retry");
    assert.match(String((retry as { payload?: unknown }).payload ?? ""), /already posted/i);
    assert.doesNotMatch(String((retry as { payload?: unknown }).payload ?? ""), /already being posted/i);
  });
});
