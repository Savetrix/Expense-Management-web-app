// Expense claims state: the claims slice, its company scoping and session
// reset, the invoice slice following receipts onto/off claims, and thunks
// passing the backend's machine-readable error code through to the UI.
//
// Run with: npm test
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configureStore } from "@reduxjs/toolkit";

import api from "../lib/api";
import { logoutUser } from "../store/auth/authApi";
import {
  approveExpenseClaim,
  createExpenseClaim,
  deleteJourney,
  fetchExpenseClaims,
  fetchExpenseSettings,
  fetchJourneys,
  publishExpenseClaim,
  removeClaimReceipt,
  reopenExpenseClaim,
  saveExpenseSettings,
  type ExpenseClaimDto,
  type ExpenseSettingsDto,
  type JourneyDto,
} from "../store/expenseClaims/expenseClaimsApi";
import expenseClaimsReducer from "../store/expenseClaims/expenseClaimsSlice";
import invoiceReducer, { type InvoiceRecord } from "../store/invoice/invoiceSlice";

const claim = (id: string, over: Partial<ExpenseClaimDto> = {}): ExpenseClaimDto => ({
  id,
  claimant: { userId: null, name: `Person ${id}` },
  month: "2026-10",
  currency: "CAD",
  status: "awaiting_review",
  receipts: [],
  total: 0,
  tax: 0,
  createdBy: "u1",
  createdAt: "2026-10-01T00:00:00Z",
  approvedAt: null,
  approvedBy: null,
  publishedAt: null,
  paidAt: null,
  paidVia: null,
  billUrl: null,
  ...over,
});

const settings = (over: Partial<ExpenseSettingsDto> = {}): ExpenseSettingsDto => ({
  allowSelfApproval: false,
  vehicles: [],
  rates: {
    Car: { Petrol: 0.5, Diesel: null, Electric: null, Hybrid: null },
    Van: { Petrol: null, Diesel: null, Electric: null, Hybrid: null },
    Motorcycle: { Petrol: null, Diesel: null, Electric: null, Hybrid: null },
  },
  passengerRate: null,
  mileageGlAccountId: null,
  ...over,
});

const receipt = (id: string) => ({
  id,
  vendor: "V",
  date: "2026-10-01",
  glAccountId: "GL",
  glAccount: null,
  taxCodeId: null,
  tax: 0,
  amount: 10,
  currency: "CAD",
  source: "Upload" as const,
  note: null,
  fileUrl: null,
});

const ec = (actions: { type: string }[]) => actions.reduce(expenseClaimsReducer, expenseClaimsReducer(undefined, { type: "@@init" }));
const loadClaims = (claims: ExpenseClaimDto[], qbConnectionId: string, requestId = "load") => [
  fetchExpenseClaims.pending(requestId),
  fetchExpenseClaims.fulfilled({ claims, qbConnectionId }, requestId),
];
const inCo = (qbConnectionId: string | null) => ({ qbConnectionId });

describe("expenseClaims slice", () => {
  it("remembers which company a list was loaded for, and clears it when a load fails", () => {
    const loaded = ec(loadClaims([claim("a")], "co-1"));
    assert.equal(loaded.claimsConnectionId, "co-1");
    assert.deepEqual(loaded.claims.map((c) => c.id), ["a"]);

    let failed = expenseClaimsReducer(loaded, fetchExpenseClaims.pending("r2"));
    failed = expenseClaimsReducer(failed, fetchExpenseClaims.rejected(null, "r2", undefined, { message: "boom" }));
    assert.deepEqual(failed.claims, []);
    assert.equal(failed.claimsConnectionId, null);
    assert.equal(failed.claimsError, "boom");
  });

  it("puts a new or changed claim in place, and drops one whose last receipt was removed", () => {
    let s = ec(loadClaims([claim("a"), claim("b")], "co"));
    s = expenseClaimsReducer(s, createExpenseClaim.fulfilled(claim("c"), "r", { claimant: { name: "C" }, receiptIds: ["x"] }, inCo("co")));
    assert.deepEqual(s.claims.map((c) => c.id), ["c", "a", "b"]);

    s = expenseClaimsReducer(s, approveExpenseClaim.fulfilled(claim("a", { status: "awaiting_reimbursement" }), "r", { id: "a" }, inCo("co")));
    assert.equal(s.claims.find((c) => c.id === "a")?.status, "awaiting_reimbursement");
    s = expenseClaimsReducer(s, reopenExpenseClaim.fulfilled(claim("a", { status: "awaiting_review" }), "r", "a", inCo("co")));
    assert.equal(s.claims.find((c) => c.id === "a")?.status, "awaiting_review");
    assert.equal(s.claims.length, 3);

    s = expenseClaimsReducer(
      s,
      removeClaimReceipt.fulfilled({ claimId: "b", receiptId: "x", claim: null }, "r", { claimId: "b", receiptId: "x" }, inCo("co")),
    );
    assert.deepEqual(s.claims.map((c) => c.id), ["c", "a"]);
  });

  it("a late answer for the company you just left never lands in the new one", () => {
    // Company A's list is loading when the user switches to B, whose list loads first.
    let s = ec([fetchExpenseClaims.pending("for-A"), fetchExpenseClaims.pending("for-B")]);
    s = expenseClaimsReducer(s, fetchExpenseClaims.fulfilled({ claims: [claim("b1")], qbConnectionId: "B" }, "for-B"));
    s = expenseClaimsReducer(s, fetchExpenseClaims.fulfilled({ claims: [claim("a1")], qbConnectionId: "A" }, "for-A"));
    assert.equal(s.claimsConnectionId, "B");
    assert.deepEqual(s.claims.map((c) => c.id), ["b1"]);

    // An approval made in A, finishing after the switch.
    s = expenseClaimsReducer(s, approveExpenseClaim.fulfilled(claim("a1", { status: "awaiting_reimbursement" }), "r", { id: "a1" }, inCo("A")));
    assert.deepEqual(s.claims.map((c) => c.id), ["b1"]);
  });

  it("settings saved in another company don't overwrite this one's", () => {
    let s = ec([
      fetchExpenseSettings.pending("s"),
      fetchExpenseSettings.fulfilled({ settings: settings({ allowSelfApproval: false }), qbConnectionId: "B" }, "s"),
    ]);
    s = expenseClaimsReducer(s, saveExpenseSettings.fulfilled(settings({ allowSelfApproval: true }), "r", {}, inCo("A")));
    assert.equal(s.settings?.allowSelfApproval, false);
    s = expenseClaimsReducer(s, saveExpenseSettings.fulfilled(settings({ allowSelfApproval: true }), "r", {}, inCo("B")));
    assert.equal(s.settings?.allowSelfApproval, true);
  });

  it("removes a deleted journey of the loaded company only", () => {
    let s = ec([fetchJourneys.pending("j"), fetchJourneys.fulfilled({ journeys: [{ id: "j1" } as JourneyDto], qbConnectionId: "co" }, "j")]);
    s = expenseClaimsReducer(s, deleteJourney.fulfilled("j1", "r", "j1", inCo("other")));
    assert.equal(s.journeys.length, 1);
    s = expenseClaimsReducer(s, deleteJourney.fulfilled("j1", "r", "j1", inCo("co")));
    assert.deepEqual(s.journeys, []);
  });

  it("forgets everything on a session boundary", () => {
    const s = ec([...loadClaims([claim("a")], "co"), logoutUser.fulfilled(undefined, "r", undefined as never)]);
    assert.deepEqual(s.claims, []);
    assert.equal(s.claimsConnectionId, null);
  });
});

describe("invoice slice follows receipts onto and off claims", () => {
  const inv = (id: string): InvoiceRecord => ({ _id: id, postedStatus: "pending", expenseClaimId: null });

  it("marks claimed receipts, and frees a removed one", () => {
    const init = invoiceReducer(undefined, { type: "@@init" });
    let s = { ...init, invoices: [inv("r1"), inv("r2"), inv("r3")], pendingInvoices: [inv("r1"), inv("r2"), inv("r3")] };

    s = invoiceReducer(
      s,
      createExpenseClaim.fulfilled(
        claim("c1", { receipts: [receipt("r1"), receipt("r2")] }),
        "r",
        { claimant: { name: "A" }, receiptIds: ["r1", "r2"] },
        inCo("co"),
      ),
    );
    assert.deepEqual(s.pendingInvoices.map((i) => i.expenseClaimId), ["c1", "c1", null]);
    assert.deepEqual(s.invoices.map((i) => i.expenseClaimId), ["c1", "c1", null]);

    s = invoiceReducer(
      s,
      removeClaimReceipt.fulfilled({ claimId: "c1", receiptId: "r1", claim: null }, "r", { claimId: "c1", receiptId: "r1" }, inCo("co")),
    );
    assert.deepEqual(s.pendingInvoices.map((i) => i.expenseClaimId), [null, "c1", null]);
  });
});

describe("thunk errors carry the backend's code", () => {
  const original = { post: api.post };
  afterEach(() => {
    api.post = original.post;
  });

  const storeWithCompany = () =>
    configureStore({
      reducer: { expenseClaims: expenseClaimsReducer, quickBooks: () => ({ qbConnectionId: "co" }) },
    });

  it("SELF_APPROVAL_BLOCKED and MISSING_GL_ACCOUNT reach the caller with their message", async () => {
    const store = storeWithCompany();
    api.post = (async () => {
      throw { response: { status: 403, data: { message: "You can't approve a claim you created", data: { code: "SELF_APPROVAL_BLOCKED" } } } };
    }) as typeof api.post;
    const approve = await store.dispatch(approveExpenseClaim({ id: "c1" }));
    assert.ok(approveExpenseClaim.rejected.match(approve));
    assert.deepEqual(approve.payload, { message: "You can't approve a claim you created", statusCode: 403, code: "SELF_APPROVAL_BLOCKED" });

    api.post = (async () => {
      throw {
        response: { status: 400, data: { message: "Pick a GL account for these receipts first: Cafe", data: { code: "MISSING_GL_ACCOUNT", receipts: ["Cafe"] } } },
      };
    }) as typeof api.post;
    const publish = await store.dispatch(publishExpenseClaim("c1"));
    assert.ok(publishExpenseClaim.rejected.match(publish));
    assert.equal(publish.payload?.code, "MISSING_GL_ACCOUNT");
    assert.match(publish.payload?.message ?? "", /Cafe/);
  });

  it("a successful change is tagged with the company it was made in", async () => {
    const store = storeWithCompany();
    api.post = (async () => ({ data: { data: { claim: claim("c1", { status: "awaiting_review" }) } } })) as unknown as typeof api.post;
    const res = await store.dispatch(reopenExpenseClaim("c1"));
    assert.ok(reopenExpenseClaim.fulfilled.match(res));
    assert.equal(res.meta.qbConnectionId, "co");
  });

  it("a network failure without a response still gives a readable message", async () => {
    const store = storeWithCompany();
    api.post = (async () => {
      throw new Error("Network Error");
    }) as typeof api.post;
    const res = await store.dispatch(approveExpenseClaim({ id: "c1" }));
    assert.ok(approveExpenseClaim.rejected.match(res));
    assert.equal(res.payload?.message, "Network Error");
    assert.equal(res.payload?.code, undefined);
  });
});

describe("contacts, notes, paying and distance", () => {
  it("contacts land only for the company they were loaded for, and reset on logout", async () => {
    const { fetchClaimContacts } = await import("../store/expenseClaims/expenseClaimsApi");
    let s = ec([fetchClaimContacts.pending("c-A"), fetchClaimContacts.pending("c-B")]);
    s = expenseClaimsReducer(s, fetchClaimContacts.fulfilled({ contacts: [{ id: "k1", name: "Casey", email: null }], qbConnectionId: "B" }, "c-B"));
    s = expenseClaimsReducer(s, fetchClaimContacts.fulfilled({ contacts: [{ id: "k9", name: "Other", email: null }], qbConnectionId: "A" }, "c-A"));
    assert.equal(s.contactsConnectionId, "B");
    assert.deepEqual(s.contacts.map((c) => c.id), ["k1"]);
    s = expenseClaimsReducer(s, logoutUser.fulfilled(undefined, "r", undefined as never));
    assert.deepEqual(s.contacts, []);
  });

  it("a saved note and a recorded payment update the claim in place", async () => {
    const { updateReceiptNote, payExpenseClaim } = await import("../store/expenseClaims/expenseClaimsApi");
    let s = ec(loadClaims([claim("a", { status: "awaiting_reimbursement" })], "co"));
    s = expenseClaimsReducer(
      s,
      updateReceiptNote.fulfilled(claim("a", { status: "awaiting_reimbursement", receipts: [{ ...receipt("r1"), note: "Client lunch" }] }), "r", { claimId: "a", receiptId: "r1", note: "Client lunch" }, inCo("co")),
    );
    assert.equal(s.claims[0].receipts[0].note, "Client lunch");
    s = expenseClaimsReducer(
      s,
      payExpenseClaim.fulfilled(claim("a", { status: "paid", paidVia: "accounting", paidAt: "2026-11-03" }), "r", { id: "a", bankAccountId: "35", date: "2026-11-03" }, inCo("co")),
    );
    assert.equal(s.claims[0].status, "paid");
    assert.equal(s.claims[0].paidVia, "accounting");
  });

  it("distance lookup passes the backend's 'not set up' code through, so the form can fall back to typed km", async () => {
    const { lookupDistance } = await import("../store/expenseClaims/expenseClaimsApi");
    const originalGet = api.get;
    try {
      api.get = (async () => {
        throw { response: { status: 503, data: { message: "Distance lookup isn't set up", data: { code: "DISTANCE_NOT_CONFIGURED" } } } };
      }) as typeof api.get;
      const store = configureStore({ reducer: { quickBooks: () => ({ qbConnectionId: "co" }) } });
      const res = await store.dispatch(lookupDistance({ from: "A", to: "B" }));
      assert.ok(lookupDistance.rejected.match(res));
      assert.equal(res.payload?.code, "DISTANCE_NOT_CONFIGURED");

      api.get = (async () => ({ data: { data: { km: 27.3, from: "Toronto", to: "Mississauga" } } })) as unknown as typeof api.get;
      const ok = await store.dispatch(lookupDistance({ from: "A", to: "B" }));
      assert.ok(lookupDistance.fulfilled.match(ok));
      assert.equal(ok.payload.km, 27.3);
    } finally {
      api.get = originalGet;
    }
  });
});
