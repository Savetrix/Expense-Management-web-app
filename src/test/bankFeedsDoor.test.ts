// The bank door: the caller's own token must be vouched for by the backend,
// the company in X-QB-Id must be in the caller's own list, and the caller's
// role there decides what they may do.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { __resetBankDoorForTests, authorizeBank, can, readConnections } from "../lib/bankFeeds/door";

const realFetch = globalThis.fetch;

const tokenFor = (id: string) => {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ id, isActive: true })}.sig`;
};

let calls = 0;
function stubBackend(status: number, connections: unknown[] = []) {
  calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.match(String(input), /\/qb-connections$/);
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer /);
    return new Response(JSON.stringify({ data: { connections } }), { status });
  }) as typeof fetch;
}

const req = (token: string | null, qbId: string | null) =>
  new Request("http://localhost/api/bank-accounts", {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(qbId ? { "X-QB-Id": qbId } : {}),
    },
  });

const COMPANIES = [
  { _id: "qb-1", name: "Acme Ltd", status: "active", role: "owner", provider: { id: "quickbooks", name: "QuickBooks" } },
  { _id: "qb-2", name: "Beta LLC", status: "active", role: "accountant", provider: { id: "xero", name: "Xero" } },
  { _id: "qb-3", name: "Gamma Inc", status: "active", role: "contributor" },
  { _id: "qb-4", name: "Delta Co", status: "reconnect_required", role: "owner" },
];

describe("bank door", () => {
  beforeEach(() => __resetBankDoorForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("refuses a request with no token or no company", async () => {
    stubBackend(200, COMPANIES);
    assert.deepEqual(await authorizeBank(req(null, "qb-1"), "view").then((r) => !r.ok && r.status), 401);
    assert.deepEqual(await authorizeBank(req(tokenFor("u1"), null), "view").then((r) => !r.ok && r.status), 403);
    assert.equal(calls, 0, "no backend call without both");
  });

  it("maps a refused token to 401 and an unreachable backend to 503", async () => {
    stubBackend(401);
    assert.equal(await authorizeBank(req(tokenFor("u1"), "qb-1"), "view").then((r) => !r.ok && r.status), 401);
    stubBackend(502);
    assert.equal(await authorizeBank(req(tokenFor("u1"), "qb-1"), "view").then((r) => !r.ok && r.status), 503);
    assert.equal(calls, 2, "a backend error is asked once more before giving up");
  });

  it("asks once more when the backend is busy, after the pause it asks for", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      return n === 1
        ? new Response("{}", { status: 429, headers: { "RateLimit-Reset": "1" } })
        : new Response(JSON.stringify({ data: { connections: COMPANIES } }), { status: 200 });
    }) as typeof fetch;
    const started = Date.now();
    assert.ok((await authorizeBank(req(tokenFor("u5"), "qb-1"), "connect")).ok);
    assert.equal(n, 2);
    assert.ok(Date.now() - started >= 900, "waited for the limit to reset");
  });

  it("asks once more when the backend can't be reached", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ data: { connections: COMPANIES } }), { status: 200 });
    }) as typeof fetch;
    assert.ok((await authorizeBank(req(tokenFor("u6"), "qb-1"), "view")).ok);
    assert.equal(n, 2);
  });

  it("requests that arrive together share one backend call", async () => {
    stubBackend(200, COMPANIES);
    const results = await Promise.all(Array.from({ length: 8 }, () => authorizeBank(req(tokenFor("u7"), "qb-1"), "view")));
    assert.ok(results.every((r) => r.ok));
    assert.equal(calls, 1);
  });

  it("only lets a caller into companies in their own list", async () => {
    stubBackend(200, COMPANIES);
    const ok = await authorizeBank(req(tokenFor("u1"), "qb-1"), "connect");
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.caller.userId, "u1");
      assert.equal(ok.connection.name, "Acme Ltd");
    }
    const other = await authorizeBank(req(tokenFor("u1"), "qb-999"), "view");
    assert.equal(!other.ok && other.status, 403);
  });

  it("applies the backend's roles", async () => {
    stubBackend(200, COMPANIES);
    const accountantConnect = await authorizeBank(req(tokenFor("u1"), "qb-2"), "connect");
    assert.equal(!accountantConnect.ok && accountantConnect.status, 403);
    assert.ok((await authorizeBank(req(tokenFor("u1"), "qb-2"), "post")).ok);
    const contributorView = await authorizeBank(req(tokenFor("u1"), "qb-3"), "view");
    assert.equal(!contributorView.ok && contributorView.status, 403);
    assert.equal(can("accountant", "code"), true);
    assert.equal(can("contributor", "view"), false);
  });

  it("refuses posting to a company whose accounting link is broken, but still shows its feed", async () => {
    stubBackend(200, COMPANIES);
    assert.ok((await authorizeBank(req(tokenFor("u1"), "qb-4"), "view")).ok);
    const post = await authorizeBank(req(tokenFor("u1"), "qb-4"), "post", { requireLiveConnection: true });
    assert.equal(!post.ok && post.status, 409);
  });

  it("caches a vouched token for a minute, but never an outage", async () => {
    stubBackend(502);
    await authorizeBank(req(tokenFor("u2"), "qb-1"), "view");
    stubBackend(200, COMPANIES);
    assert.ok((await authorizeBank(req(tokenFor("u2"), "qb-1"), "view")).ok);
    assert.ok((await authorizeBank(req(tokenFor("u2"), "qb-1"), "view")).ok);
    assert.equal(calls, 1, "second call served from cache");
  });

  it("reads provider and role, defaulting old rows to QuickBooks", () => {
    const [a, , c] = readConnections({ data: { connections: COMPANIES } });
    assert.equal(a.providerId, "quickbooks");
    assert.equal(c.providerName, "QuickBooks");
    assert.equal(readConnections({ data: { connections: [COMPANIES[1]] } })[0].providerName, "Xero");
  });
});
