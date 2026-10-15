// A connection's accounting software decides its labels, its GL account
// types and whether a new GL account needs a code. Connections cached before
// the backend sent `provider` (and any unknown value) must keep behaving as
// QuickBooks, or existing users would see blank labels / an empty type list.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROVIDERS, asProviderId, providerIdOf, providerInfoOf } from "../lib/accountingProvider";
import { selectActiveProviderId } from "../store/quickBooks/quickBooksSlice";

const xeroConnection = { _id: "x1", provider: { id: "xero" as const, name: "Xero" } };
// Cached before the backend sent `provider`.
const legacyConnection: { _id: string; provider?: undefined } = { _id: "q1" };

describe("accounting provider helpers", () => {
  it("reads the provider from a connection, defaulting to QuickBooks", () => {
    assert.equal(providerIdOf(xeroConnection), "xero");
    assert.equal(providerIdOf(legacyConnection), "quickbooks");
    assert.equal(providerIdOf(null), "quickbooks");
    assert.equal(providerInfoOf(xeroConnection).productName, "Xero");
    assert.equal(providerInfoOf(legacyConnection).productName, "QuickBooks Online");
  });

  it("never trusts an unknown or inherited-property provider id", () => {
    assert.equal(asProviderId("sage"), "quickbooks");
    assert.equal(asProviderId("toString"), "quickbooks");
    assert.equal(asProviderId(undefined), "quickbooks");
  });

  it("Xero needs an account code and its own account types; QuickBooks keeps subtype", () => {
    assert.equal(PROVIDERS.xero.accountCodeRequired, true);
    assert.equal(PROVIDERS.xero.accountSubTypeSupported, false);
    assert.equal(PROVIDERS.xero.accountTypes[0].value, "EXPENSE");
    assert.equal(PROVIDERS.quickbooks.accountCodeRequired, false);
    assert.equal(PROVIDERS.quickbooks.accountTypes[0].value, "Expense");
  });
});

describe("selectActiveProviderId", () => {
  const stateWith = (qbConnectionId: string) =>
    ({ quickBooks: { qbConnectionId, connections: [xeroConnection, legacyConnection] } }) as unknown as Parameters<
      typeof selectActiveProviderId
    >[0];

  it("follows the company selected in the header", () => {
    assert.equal(selectActiveProviderId(stateWith("x1")), "xero");
    assert.equal(selectActiveProviderId(stateWith("q1")), "quickbooks");
  });

  it("falls back to QuickBooks when nothing is selected", () => {
    assert.equal(selectActiveProviderId(stateWith("")), "quickbooks");
  });
});

// A reload restores qbConnectionId but not the connection list, so until
// GET /connections returns the label must come from the persisted provider —
// otherwise a Xero company is briefly called "QuickBooks".
describe("active provider across a reload", () => {
  it("uses the persisted provider while the connection list is still empty", () => {
    const state = { quickBooks: { qbConnectionId: "x1", connections: [], activeProviderId: "xero" } } as unknown as Parameters<
      typeof selectActiveProviderId
    >[0];
    assert.equal(selectActiveProviderId(state), "xero");
  });

  it("re-derives and persists the provider when the list arrives", async () => {
    const { default: reducer } = await import("../store/quickBooks/quickBooksSlice");
    const { getMyQBConnections } = await import("../store/quickBooks/quickBooksApi");
    const prev = { ...reducer(undefined, { type: "@@init" }), qbConnectionId: "x1", hasExplicitSelection: true };
    const next = reducer(
      prev,
      getMyQBConnections.fulfilled({ data: { connections: [xeroConnection, legacyConnection] } }, "req", { accessToken: "t" }),
    );
    assert.equal(next.activeProviderId, "xero");
  });
});

describe("chatbot system prompt", () => {
  it("tells the model the company uses Xero and how GL accounts differ", async () => {
    const { buildSystemPrompt } = await import("../lib/chatbot/systemPrompt");
    const xero = buildSystemPrompt("Demo Co", "Xero");
    assert.ok(xero.includes('"Demo Co", in Xero'));
    assert.ok(/Xero account types/.test(xero) && /account code/.test(xero));
    const qb = buildSystemPrompt("Acme", "QuickBooks");
    assert.ok(qb.includes("in QuickBooks") && !/Xero account types/.test(qb));
  });
});
