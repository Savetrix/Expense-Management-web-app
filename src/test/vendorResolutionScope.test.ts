// A vendor resolution belongs to ONE invoice.
//
// Before this, the selection was global. Resolving a vendor on invoice A left
// it selected for whatever invoice you opened next, and the review screen used
// it as the vendorId posted to QuickBooks — so a bill could be filed against
// the wrong vendor. Only the Pending list cleared it, so arriving at the next
// invoice from the Invoices list inherited it silently.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import reducer, {
  clearCreatedVendor,
  clearSelectedVendor,
  clearVendorResolutionForOtherInvoice,
  setCreatedVendor,
  setSelectedVendor,
} from "../store/vendor/vendorSlice";

const vendorA = {
  _id: "ven-a",
  displayName: "Acme Corp",
  qbVendorId: "qb-a",
  email: null,
  phone: null,
  address: null,
};

const initial = reducer(undefined, { type: "@@INIT" });

describe("vendor resolution is scoped to the invoice it was made for", () => {
  it("records which invoice a selection belongs to", () => {
    const state = reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" }));
    assert.equal(state.selectedVendor?._id, "ven-a");
    assert.equal(state.forInvoiceId, "inv-A");
  });

  it("drops the selection when a DIFFERENT invoice is opened", () => {
    let state = reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" }));
    state = reducer(state, clearVendorResolutionForOtherInvoice("inv-B"));
    assert.equal(state.selectedVendor, null, "invoice B must not inherit invoice A's vendor");
    assert.equal(state.createdVendor, null);
    assert.equal(state.forInvoiceId, null);
  });

  it("keeps the selection when the SAME invoice is re-opened", () => {
    // The resolve screen navigates back to the review screen, which re-mounts.
    // Clearing indiscriminately there would throw away the resolution the user
    // just made.
    let state = reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" }));
    state = reducer(state, clearVendorResolutionForOtherInvoice("inv-A"));
    assert.equal(state.selectedVendor?._id, "ven-a", "the just-resolved vendor must survive the round trip");
    assert.equal(state.forInvoiceId, "inv-A");
  });

  it("is a no-op when nothing is resolved", () => {
    const state = reducer(initial, clearVendorResolutionForOtherInvoice("inv-B"));
    assert.deepEqual(state, initial);
  });

  it("re-scopes when a second invoice resolves its own vendor", () => {
    let state = reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" }));
    state = reducer(state, setSelectedVendor({ ...vendorA, _id: "ven-b", forInvoiceId: "inv-B" }));
    assert.equal(state.selectedVendor?._id, "ven-b");
    assert.equal(state.forInvoiceId, "inv-B");
  });

  it("tracks the invoice for a created vendor too", () => {
    let state = reducer(
      initial,
      setCreatedVendor({ name: "New Co", currency: "USD", forInvoiceId: "inv-A" }),
    );
    assert.equal(state.createdVendor?.name, "New Co");
    assert.equal(state.forInvoiceId, "inv-A");

    state = reducer(state, clearVendorResolutionForOtherInvoice("inv-B"));
    assert.equal(state.createdVendor, null);
  });

  it("only releases the invoice binding once BOTH halves are cleared", () => {
    // createdVendor and selectedVendor share one binding; dropping one must not
    // orphan the other by unbinding it from its invoice.
    let state = reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" }));
    state = reducer(state, setCreatedVendor({ name: "New Co", currency: "USD", forInvoiceId: "inv-A" }));

    state = reducer(state, clearSelectedVendor());
    assert.equal(state.forInvoiceId, "inv-A", "createdVendor still belongs to inv-A");

    state = reducer(state, clearCreatedVendor());
    assert.equal(state.forInvoiceId, null, "nothing left, so the binding is released");
  });

  it("clears everything on a session boundary", () => {
    const state = reducer(
      reducer(initial, setSelectedVendor({ ...vendorA, forInvoiceId: "inv-A" })),
      { type: "auth/logoutUser/fulfilled" },
    );
    assert.equal(state.selectedVendor, null);
    assert.equal(state.forInvoiceId, null);
  });
});
