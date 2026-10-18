// Tests for the account-deletion dialog's decisions: when the typed
// confirmation counts, and what the user is told will happen. The network
// half (fetchDeletionPreview / deleteAccount thunks) is a thin axios wrapper;
// the backend's own integration tests cover the contract end to end.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DELETION_CONFIRM_TEXT,
  DeletionPreview,
  describeDeletionImpact,
  isDeletionConfirmTextValid,
  storeCancellationWarning,
} from "../lib/accountDeletion";

const preview = (overrides: Partial<DeletionPreview> = {}): DeletionPreview => ({
  confirmText: DELETION_CONFIRM_TEXT,
  ownedConnections: [],
  membershipCount: 0,
  subscription: null,
  ...overrides,
});

const sub = (overrides: Partial<NonNullable<DeletionPreview["subscription"]>> = {}) => ({
  plan: "standard",
  status: "active",
  provider: "stripe",
  willBeCancelled: false,
  mustCancelInStore: false,
  ...overrides,
});

describe("isDeletionConfirmTextValid", () => {
  it("matches the backend's phrase, ignoring case and surrounding spaces", () => {
    assert.equal(DELETION_CONFIRM_TEXT, "delete my account");
    for (const typed of ["delete my account", "Delete my account", "DELETE MY ACCOUNT", "  delete my account  "]) {
      assert.equal(isDeletionConfirmTextValid(typed), true, typed);
    }
  });

  it("rejects anything else, including partial phrases", () => {
    for (const typed of ["", "delete", "delete my", "delete my account!", "delete  my account", "yes"]) {
      assert.equal(isDeletionConfirmTextValid(typed), false, typed);
    }
  });

  it("checks against the phrase the server sent when given one", () => {
    assert.equal(isDeletionConfirmTextValid("remove me", "remove me"), true);
    assert.equal(isDeletionConfirmTextValid("delete my account", "remove me"), false);
  });
});

describe("describeDeletionImpact", () => {
  it("a user with nothing connected is still told they'll be signed out", () => {
    const lines = describeDeletionImpact(preview());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /signed out/);
    assert.match(lines[0], /fresh account/);
  });

  it("names each owned company, its software, and how many members lose access", () => {
    const lines = describeDeletionImpact(
      preview({
        ownedConnections: [
          { _id: "1", name: "ABC Traders", provider: { id: "quickbooks", name: "QuickBooks" }, memberCount: 3 },
          { _id: "2", name: "XYZ Ltd", provider: { id: "xero", name: "Xero" }, memberCount: 1 },
          { _id: "3", name: "Solo Co", memberCount: 0 },
        ],
      }),
    );
    assert.equal(lines[0], "ABC Traders (QuickBooks) will be disconnected, and 3 team members will lose access to it.");
    assert.equal(lines[1], "XYZ Ltd (Xero) will be disconnected, and 1 team member will lose access to it.");
    assert.equal(lines[2], "Solo Co will be disconnected.");
  });

  it("mentions teams the user will be removed from", () => {
    assert.ok(describeDeletionImpact(preview({ membershipCount: 1 })).includes("You will be removed from 1 team you were invited to."));
    assert.ok(describeDeletionImpact(preview({ membershipCount: 2 })).includes("You will be removed from 2 teams you were invited to."));
  });

  it("says the subscription is cancelled only when the backend will cancel it", () => {
    const cancels = describeDeletionImpact(preview({ subscription: sub({ willBeCancelled: true }) }));
    assert.ok(cancels.some((l) => /subscription will be cancelled/.test(l)));

    const doesNot = describeDeletionImpact(preview({ subscription: sub({ provider: "apple", mustCancelInStore: true }) }));
    assert.ok(!doesNot.some((l) => /subscription will be cancelled/.test(l)));
  });
});

describe("storeCancellationWarning", () => {
  it("warns App Store and Google Play subscribers to cancel in the store themselves", () => {
    assert.match(storeCancellationWarning(preview({ subscription: sub({ provider: "apple", mustCancelInStore: true }) }))!, /the App Store/);
    assert.match(storeCancellationWarning(preview({ subscription: sub({ provider: "google", mustCancelInStore: true }) }))!, /Google Play/);
  });

  it("stays quiet when there's nothing to cancel in a store", () => {
    assert.equal(storeCancellationWarning(preview()), null);
    assert.equal(storeCancellationWarning(preview({ subscription: sub({ willBeCancelled: true }) })), null);
  });
});
