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
  deleteExpenseClaim,
  deleteJourney,
  fetchExpenseClaims,
  fetchExpenseSettings,
  fetchJourneys,
  rejectExpenseClaim,
  removeClaimReceipt,
  saveExpenseSettings,
  uploadClaimReceipts,
  type ExpenseClaimDto,
  type ExpenseSettingsDto,
  type JourneyDto,
} from "../store/expenseClaims/expenseClaimsApi";
import expenseClaimsReducer from "../store/expenseClaims/expenseClaimsSlice";
import invoiceReducer, { type InvoiceRecord } from "../store/invoice/invoiceSlice";

const claim = (id: string, over: Partial<ExpenseClaimDto> = {}): ExpenseClaimDto => ({
  id,
  claimant: { userId: null, name: `Person ${id}` },
  approver: { userId: "u2", name: "Andy Approver" },
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
  rejectedAt: null,
  rejectionReason: null,
  billUrl: null,
  ...over,
});

const settings = (over: Partial<ExpenseSettingsDto> = {}): ExpenseSettingsDto => ({
  allowSelfApproval: false,
  mileageRate: 0.5,
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
    s = expenseClaimsReducer(
      s,
      rejectExpenseClaim.fulfilled(claim("b", { status: "rejected", rejectionReason: "Personal" }), "r", { id: "b", reason: "Personal" }, inCo("co")),
    );
    assert.equal(s.claims.find((c) => c.id === "b")?.rejectionReason, "Personal");
    assert.equal(s.claims.length, 3);
    s = expenseClaimsReducer(s, deleteExpenseClaim.fulfilled("c", "r", "c", inCo("co")));
    assert.deepEqual(s.claims.map((c) => c.id), ["a", "b"]);
    s = expenseClaimsReducer(s, createExpenseClaim.fulfilled(claim("c"), "r", { claimant: { name: "C" }, receiptIds: ["x"] }, inCo("co")));

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
    const uncoded = await store.dispatch(approveExpenseClaim({ id: "c1" }));
    assert.ok(approveExpenseClaim.rejected.match(uncoded));
    assert.equal(uncoded.payload?.code, "MISSING_GL_ACCOUNT");
    assert.match(uncoded.payload?.message ?? "", /Cafe/);
  });

  it("a successful change is tagged with the company it was made in", async () => {
    const store = storeWithCompany();
    let sent: unknown;
    api.post = (async (_url: string, body: unknown) => {
      sent = body;
      return { data: { data: { claim: claim("c1", { status: "rejected" }) } } };
    }) as unknown as typeof api.post;
    const res = await store.dispatch(rejectExpenseClaim({ id: "c1", reason: "Personal" }));
    assert.ok(rejectExpenseClaim.fulfilled.match(res));
    assert.equal(res.meta.qbConnectionId, "co");
    assert.deepEqual(sent, { reason: "Personal" });
  });

  it("claims-page receipts upload through the scanner flagged as claim receipts", async () => {
    const store = storeWithCompany();
    let url = "";
    let form: FormData | undefined;
    api.post = (async (u: string, body: FormData) => {
      url = u;
      form = body;
      return { data: { data: { invoices: [{ _id: "i1" }, { _id: "i2" }], failed: [{ fileName: "blurry.jpg" }] } } };
    }) as unknown as typeof api.post;
    const files = [new File(["a"], "lunch.jpg", { type: "image/jpeg" }), new File(["b"], "taxi.pdf", { type: "application/pdf" })];
    const res = await store.dispatch(uploadClaimReceipts(files));
    assert.ok(uploadClaimReceipts.fulfilled.match(res));
    assert.deepEqual(res.payload, { ids: ["i1", "i2"], failed: ["blurry.jpg"] });
    assert.equal(url, "/invoices");
    assert.equal(form?.get("claimReceipt"), "true");
    assert.deepEqual(form?.getAll("files").map((f) => (f as File).name), ["lunch.jpg", "taxi.pdf"]);
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

describe("contacts, notes and paying", () => {
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
});

describe("claims waiting on you (sidebar count)", () => {
  it("keeps the latest count with the company it was read for, and resets on logout", async () => {
    const { fetchClaimSummary } = await import("../store/expenseClaims/expenseClaimsApi");
    let s = ec([fetchClaimSummary.pending("s-A"), fetchClaimSummary.pending("s-B")]);
    // The older request for company A answers last — ignored.
    s = expenseClaimsReducer(s, fetchClaimSummary.fulfilled({ assignedToMe: 3, qbConnectionId: "B" }, "s-B"));
    s = expenseClaimsReducer(s, fetchClaimSummary.fulfilled({ assignedToMe: 9, qbConnectionId: "A" }, "s-A"));
    assert.equal(s.assignedToMe, 3);
    assert.equal(s.summaryConnectionId, "B");
    s = expenseClaimsReducer(s, logoutUser.fulfilled(undefined, "r", undefined as never));
    assert.equal(s.assignedToMe, 0);
    assert.equal(s.summaryConnectionId, null);
  });
});

describe("mileage trips go through approval like claims", () => {
  const trip = (id: string, over: Partial<JourneyDto> = {}) => ({ id, status: "awaiting_review", ...over }) as JourneyDto;

  it("approve, reject, mark-paid and pay land in the trips list for the company they were made in", async () => {
    const { approveJourney, rejectJourney, markJourneyPaid, payJourney } = await import("../store/expenseClaims/expenseClaimsApi");
    let s = ec([fetchJourneys.pending("j"), fetchJourneys.fulfilled({ journeys: [trip("a"), trip("b")], qbConnectionId: "co" }, "j")]);
    s = expenseClaimsReducer(s, approveJourney.fulfilled(trip("a", { status: "awaiting_reimbursement" }), "r", { id: "a" }, inCo("other")));
    assert.equal(s.journeys[0].status, "awaiting_review");
    s = expenseClaimsReducer(s, approveJourney.fulfilled(trip("a", { status: "awaiting_reimbursement" }), "r", { id: "a" }, inCo("co")));
    s = expenseClaimsReducer(s, rejectJourney.fulfilled(trip("b", { status: "rejected", rejectionReason: "Personal" }), "r", { id: "b", reason: "Personal" }, inCo("co")));
    assert.deepEqual(s.journeys.map((j) => [j.id, j.status]), [["a", "awaiting_reimbursement"], ["b", "rejected"]]);
    s = expenseClaimsReducer(s, markJourneyPaid.fulfilled(trip("a", { status: "paid", paidVia: "manual" }), "r", "a", inCo("co")));
    assert.equal(s.journeys[0].paidVia, "manual");
    s = expenseClaimsReducer(s, payJourney.fulfilled(trip("a", { status: "paid", paidVia: "accounting" }), "r", { id: "a", bankAccountId: "35", date: "2026-11-03" }, inCo("co")));
    assert.equal(s.journeys[0].paidVia, "accounting");
  });

  it("a trip is sent without an approver (the backend routes it to the manager), and approve-and-pay asks for ?pay=true", async () => {
    const { createJourney, approveJourney } = await import("../store/expenseClaims/expenseClaimsApi");
    const store = configureStore({ reducer: { expenseClaims: expenseClaimsReducer, quickBooks: () => ({ qbConnectionId: "co" }) } });
    const originalPost = api.post;
    const calls: Array<[string, unknown]> = [];
    try {
      api.post = (async (url: string, body: unknown) => {
        calls.push([url, body]);
        return { data: { data: { journey: trip("t1") } } };
      }) as unknown as typeof api.post;
      await store.dispatch(createJourney({ driver: { userId: "u1" }, date: "2026-11-01", km: 42, purpose: "Client" }));
      await store.dispatch(approveJourney({ id: "t1", pay: true }));
    } finally {
      api.post = originalPost;
    }
    assert.deepEqual(calls[0], ["/mileage/journeys", { driver: { userId: "u1" }, date: "2026-11-01", km: 42, purpose: "Client" }]);
    assert.equal(calls[1][0], "/mileage/journeys/t1/approve?pay=true");
  });
});

describe("approver is the manager, worked out by the backend", () => {
  it("the preview asks about the claimant only when it isn't you", async () => {
    const { fetchApproverPreview } = await import("../store/expenseClaims/expenseClaimsApi");
    const store = configureStore({ reducer: { quickBooks: () => ({ qbConnectionId: "co" }) } });
    const originalGet = api.get;
    const params: unknown[] = [];
    try {
      api.get = (async (_url: string, config: { params: unknown }) => {
        params.push(config.params);
        return { data: { data: { approver: { userId: "m1", name: "Maya" }, autoApprove: false, code: null, message: null } } };
      }) as unknown as typeof api.get;
      const mine = await store.dispatch(fetchApproverPreview({ forUserId: null }));
      await store.dispatch(fetchApproverPreview({ forUserId: "u9" }));
      assert.ok(fetchApproverPreview.fulfilled.match(mine));
      assert.equal(mine.payload.approver?.name, "Maya");
    } finally {
      api.get = originalGet;
    }
    assert.deepEqual(params, [{}, { for: "u9" }]);
  });

  it("an owner's claim that couldn't be posted on send carries the reason in meta", async () => {
    const store = configureStore({ reducer: { expenseClaims: expenseClaimsReducer, quickBooks: () => ({ qbConnectionId: "co" }) } });
    const originalPost = api.post;
    try {
      api.post = (async () => ({ data: { data: { claim: claim("c1"), autoApproveError: "Pick a GL account for these receipts first: Cafe" } } })) as unknown as typeof api.post;
      const res = await store.dispatch(createExpenseClaim({ claimant: { name: "Kim" }, receiptIds: ["r1"] }));
      assert.ok(createExpenseClaim.fulfilled.match(res));
      assert.equal(res.meta.autoApproveError, "Pick a GL account for these receipts first: Cafe");
    } finally {
      api.post = originalPost;
    }
  });
});

describe("contributor page access", () => {
  it("maps a path to its sidebar page and restricts only contributors with a list", async () => {
    const { pageKeyOf, canOpenPage, ALL_PAGE_KEYS } = await import("../lib/pageAccess");
    assert.equal(pageKeyOf("/invoices/123/review"), "invoices");
    assert.equal(pageKeyOf("/expense-claims"), "expense-claims");
    assert.equal(pageKeyOf("/quickbooks"), "accounting-software");
    assert.equal(pageKeyOf("/plans"), "subscription");
    assert.equal(pageKeyOf("/profile"), null);
    assert.equal(pageKeyOf("/"), null);

    assert.equal(canOpenPage("contributor", ["expense-claims"], "invoices"), false);
    assert.equal(canOpenPage("contributor", ["expense-claims"], "expense-claims"), true);
    // Always-open pages, no list (every page), and other roles are never blocked.
    assert.equal(canOpenPage("contributor", ["expense-claims"], null), true);
    assert.equal(canOpenPage("contributor", null, "invoices"), true);
    assert.equal(canOpenPage("accountant", ["expense-claims"], "invoices"), true);
    assert.equal(canOpenPage("owner", undefined, "subscription"), true);
    assert.equal(ALL_PAGE_KEYS.length, 9);
  });
});
