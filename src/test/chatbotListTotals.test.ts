// The assistant's list tools return at most 20 rows to keep the model's input
// small. Without the full count alongside, "how many vendors do I have?" was
// answered with the cap: a company with 36 active vendors was told it had 20
// (found while testing the Android app, which shares this assistant).
//
// Run with: npm test
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import axios from "axios";

import { listGLAccounts, listTaxCodes, listVendors } from "../lib/chatbot/tools";

const originalGet = axios.get;
afterEach(() => {
  axios.get = originalGet;
});

function serve(data: unknown) {
  axios.get = (async () => ({ data: { data } })) as typeof axios.get;
}

const many = (n: number, make: (i: number) => object) => Array.from({ length: n }, (_, i) => make(i));

describe("assistant list tools report the full count", () => {
  it("vendors: 36 active, 20 returned, totalMatched 36", async () => {
    serve({ vendors: many(36, (i) => ({ _id: `v${i}`, displayName: `Vendor ${i}`, active: true })) });
    const result = await listVendors("token", "qb", {});
    assert.equal(result.vendors.length, 20);
    assert.equal(result.totalMatched, 36);
  });

  it("GL accounts and tax codes", async () => {
    serve({ accounts: many(64, (i) => ({ _id: `a${i}`, name: `Account ${i}` })) });
    const accounts = await listGLAccounts("token", "qb");
    assert.equal(accounts.accounts.length, 20);
    assert.equal(accounts.totalMatched, 64);

    serve({ items: many(4, (i) => ({ _id: `t${i}`, name: `Tax ${i}` })) });
    const taxCodes = await listTaxCodes("token", "qb");
    assert.equal(taxCodes.taxCodes.length, 4);
    assert.equal(taxCodes.totalMatched, 4);
  });
});
