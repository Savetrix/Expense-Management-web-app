// selectConnectedAccounts decides, for the Team / Vendors / GL pages, whether
// there is a company to work in — it must agree with the header's company
// switcher, or a page can say "pick one from the switcher" while the
// switcher has nothing to pick (or open a company that was disconnected).
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectConnectedAccounts } from "../store/quickBooks/quickBooksSlice";

const stateWith = (connections: { _id: string; status?: string }[]) =>
  ({ quickBooks: { connections } }) as unknown as Parameters<typeof selectConnectedAccounts>[0];

describe("selectConnectedAccounts", () => {
  it("drops disconnected companies, keeps ones that only need a reconnect", () => {
    const state = stateWith([
      { _id: "a", status: "active" },
      { _id: "b", status: "disconnected" },
      { _id: "c", status: "reconnect_required" },
      { _id: "d" }, // older rows without a status
    ]);
    assert.deepEqual(
      selectConnectedAccounts(state).map((c: { _id: string }) => c._id),
      ["a", "c", "d"],
    );
  });

  it("a user whose only company was disconnected has none — so the page offers to connect one", () => {
    assert.equal(selectConnectedAccounts(stateWith([{ _id: "old", status: "disconnected" }])).length, 0);
  });

  it("returns the same array while the connection list is unchanged", () => {
    const state = stateWith([{ _id: "a", status: "active" }]);
    assert.equal(selectConnectedAccounts(state), selectConnectedAccounts(state));
  });
});
