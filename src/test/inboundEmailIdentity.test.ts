// Who the alias routes think is asking, and what their account email is.
//
// Two things matter here. First, the same security property chat history rests
// on: the user id comes from a token the BACKEND vouched for, never from an
// unverified payload. Second — and specific to this feature — the EMAIL, because
// an alias's ownerEmail is the sender allow-list. A browser-supplied email would
// let any signed-in user nominate an arbitrary address as authorized to create
// invoices in their books.
//
// Run with: npm test
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  __resetInboundIdentityForTests,
  resolveInboundIdentity,
} from "../lib/inboundEmail/identity";

const realFetch = globalThis.fetch;

/** A JWT-shaped token (unsigned — nothing here verifies signatures). */
function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature-not-checked-here`;
}

interface StubbedCall {
  path: string;
  authorization: string | null;
}

/** Route stub keyed by the trailing path of the upstream URL. */
function stubUpstream(routes: Record<string, { status: number; body?: unknown }>): StubbedCall[] {
  const calls: StubbedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = Object.keys(routes).find((candidate) => url.endsWith(candidate));
    calls.push({
      path: path ?? url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const route = path ? routes[path] : undefined;
    if (!route) return new Response("not stubbed", { status: 500 });
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return calls;
}

const profile = (id: string, email: string) => ({
  status: 200,
  body: { success: true, data: { user: { _id: id, email } } },
});

describe("resolveInboundIdentity", () => {
  beforeEach(() => __resetInboundIdentityForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
    __resetInboundIdentityForTests();
  });

  it("resolves id and email in a single upstream call", async () => {
    const calls = stubUpstream({ "/users/me": profile("user-alice", "alice@corp.com") });

    const outcome = await resolveInboundIdentity(jwtWith({ sub: "user-alice" }));

    assert.deepEqual(outcome, {
      kind: "authenticated",
      userId: "user-alice",
      email: "alice@corp.com",
    });
    assert.equal(calls.length, 1);
  });

  it("prefers the token's own claims over the response body", async () => {
    // The token is per-user by construction — the backend minted it for this one
    // user and has just vouched for it. A response body is only as trustworthy
    // as our guess about its shape.
    const calls = stubUpstream({ "/users/me": profile("body-id", "body@corp.com") });

    const outcome = await resolveInboundIdentity(
      jwtWith({ _id: "token-id", email: "token@corp.com" }),
    );

    assert.equal(calls.length, 1);
    if (outcome.kind !== "authenticated") throw new Error("expected authenticated");
    assert.equal(outcome.userId, "token-id");
    assert.equal(outcome.email, "token@corp.com");
  });

  it("rejects a token the backend will not vouch for", async () => {
    stubUpstream({ "/users/me": { status: 401 } });
    const outcome = await resolveInboundIdentity(jwtWith({ sub: "user-alice" }));
    assert.deepEqual(outcome, { kind: "unauthenticated" });
  });

  it("falls back to /qb-connections when the profile endpoint is absent", async () => {
    const calls = stubUpstream({
      "/users/me": { status: 404 },
      "/qb-connections": { status: 200, body: { data: { connections: [] } } },
    });

    const outcome = await resolveInboundIdentity(
      jwtWith({ sub: "user-bob", email: "bob@corp.com" }),
    );

    assert.equal(outcome.kind, "authenticated");
    assert.deepEqual(calls.map((c) => c.path), ["/users/me", "/qb-connections"]);
  });

  it("FAILS CLOSED when no email can be established", async () => {
    // The email is the sender allow-list. Guessing one, or accepting one from
    // the client, would let a user authorize an arbitrary address.
    stubUpstream({ "/users/me": { status: 200, body: { data: { user: { _id: "u1" } } } } });

    const outcome = await resolveInboundIdentity(jwtWith({ sub: "u1" }));

    assert.equal(outcome.kind, "unavailable");
    if (outcome.kind === "unavailable") assert.equal(outcome.reason, "no-email");
  });

  it("fails closed when upstream is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof globalThis.fetch;

    const outcome = await resolveInboundIdentity(jwtWith({ sub: "u1", email: "a@b.com" }));
    assert.equal(outcome.kind, "unavailable");
  });

  // ── CACHING ───────────────────────────────────────────────────────────────
  // The invoice list calls /api/inbound/sources on every mount, so without this
  // every visit costs an upstream round trip for every user.

  it("serves a repeat lookup from cache instead of calling upstream again", async () => {
    const calls = stubUpstream({ "/users/me": profile("user-alice", "alice@corp.com") });
    const token = jwtWith({ sub: "user-alice" });

    const first = await resolveInboundIdentity(token);
    const second = await resolveInboundIdentity(token);

    assert.deepEqual(first, second);
    assert.equal(calls.length, 1, "second lookup should not hit upstream");
  });

  it("keys the cache per token, so one user's identity never serves another", async () => {
    stubUpstream({ "/users/me": profile("user-alice", "alice@corp.com") });
    const alice = await resolveInboundIdentity(jwtWith({ sub: "user-alice" }));

    // Same instance, different token: must resolve on its own merits.
    stubUpstream({ "/users/me": profile("user-bob", "bob@corp.com") });
    const bob = await resolveInboundIdentity(jwtWith({ sub: "user-bob" }));

    assert.notDeepEqual(alice, bob);
    if (bob.kind !== "authenticated") throw new Error("expected authenticated");
    assert.equal(bob.userId, "user-bob");
  });

  it("does NOT cache an unavailable outcome", async () => {
    // Caching a transient upstream failure would keep the feature down for a
    // full TTL after upstream recovered.
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof globalThis.fetch;
    const token = jwtWith({ sub: "u1", email: "a@b.com" });
    assert.equal((await resolveInboundIdentity(token)).kind, "unavailable");

    const calls = stubUpstream({ "/users/me": profile("u1", "a@b.com") });
    assert.equal((await resolveInboundIdentity(token)).kind, "authenticated");
    assert.equal(calls.length, 1, "recovery must not be blocked by a cached failure");
  });

  it("caches a rejection, so a bad token cannot be used to hammer upstream", async () => {
    const calls = stubUpstream({ "/users/me": { status: 401 } });
    const token = jwtWith({ sub: "nobody" });

    await resolveInboundIdentity(token);
    await resolveInboundIdentity(token);

    assert.equal(calls.length, 1);
  });
});
