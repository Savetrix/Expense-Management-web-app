// Tests for the access-token refresh policy: refresh ahead of expiry, re-send
// a request whose 401 the backend marked TOKEN_EXPIRED (even a write), never
// re-send any other 401'd write, and never refresh ahead of /auth/* calls.
//
// The real api.ts interceptors and authFetch run against a fake server: an
// axios adapter for the api client (and the bare axios the refresh uses), a
// fake fetch for authFetch, and an in-memory localStorage behind a fake
// window.
//
// Run with: npm test
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

import api from "../lib/api";
import { authFetch } from "../lib/authFetch";
import { SESSION_EXPIRED, sessionEmitter } from "../lib/sessionManager";
import { REFRESH_AHEAD_MS, isExpiringSoon, isTokenExpiredResponse, jwtExpiresAt, skipsProactiveRefresh } from "../lib/tokenExpiry";

// ── helpers ─────────────────────────────────────────────────────────────────

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
// A token issued at `serverNow` (default: this clock) that expires `ms` later.
const tokenExpiringIn = (ms: number, tag = "t", serverNow = Date.now()) =>
  `${b64url({ alg: "HS256" })}.${b64url({ id: tag, iat: Math.floor(serverNow / 1000), exp: Math.floor((serverNow + ms) / 1000) })}.sig`;

const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

let refreshCalls = 0;
let refreshFails = false;
let nextAccessToken = "";
let lastRefreshTimeout: number | undefined;
const refreshAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  refreshCalls++;
  lastRefreshTimeout = config.timeout;
  if (refreshFails) {
    const response = { data: { message: "Invalid refresh token" }, status: 401, statusText: "", headers: {}, config } as AxiosResponse;
    throw new AxiosError("refresh refused", "ERR_BAD_REQUEST", config, null, response);
  }
  return { data: { data: { accessToken: nextAccessToken, refreshToken: "rt-rotated" } }, status: 200, statusText: "OK", headers: {}, config };
};

type Seen = { method: string; url: string; auth: string | undefined };
let seen: Seen[] = [];
// Answers per request; default 200. `respond` can inspect the request.
let respond: (req: Seen, attempt: number) => { status: number; data: unknown } = () => ({ status: 200, data: { ok: true } });
const apiAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const req = { method: (config.method ?? "get").toUpperCase(), url: config.url ?? "", auth: config.headers?.Authorization as string | undefined };
  seen.push(req);
  const { status, data } = respond(req, seen.filter((s) => s.url === req.url && s.method === req.method).length);
  const response = { data, status, statusText: "", headers: {}, config } as AxiosResponse;
  if (status >= 400) throw new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response);
  return response;
};

const tokenExpired = { status: 401, data: { success: false, message: "Access token expired", data: { code: "TOKEN_EXPIRED" } } };

let sessionExpiredEvents = 0;
const onExpired = () => sessionExpiredEvents++;

beforeEach(() => {
  store.clear();
  seen = [];
  refreshCalls = 0;
  refreshFails = false;
  sessionExpiredEvents = 0;
  respond = () => ({ status: 200, data: { ok: true } });
  nextAccessToken = tokenExpiringIn(15 * 60_000, "new");
  axios.defaults.adapter = refreshAdapter;
  api.defaults.adapter = apiAdapter;
  sessionEmitter.on(SESSION_EXPIRED, onExpired);
});

afterEach(() => {
  sessionEmitter.off(SESSION_EXPIRED, onExpired);
});

const signIn = (accessToken: string) => {
  store.set("accessToken", accessToken);
  store.set("refreshToken", "rt-1");
};

// ── pure policy ─────────────────────────────────────────────────────────────

describe("tokenExpiry", () => {
  it("reads a JWT's exp and tolerates anything that isn't one", () => {
    const token = tokenExpiringIn(10 * 60_000);
    assert.ok(Math.abs((jwtExpiresAt(token) ?? 0) - (Date.now() + 10 * 60_000)) < 2000);
    for (const bad of [null, undefined, "", "not-a-jwt", "a.b.c", `${b64url({})}.${b64url({ exp: "soon" })}.s`]) {
      assert.equal(jwtExpiresAt(bad as string), null, String(bad));
    }
  });

  it("is 'expiring soon' inside the refresh-ahead window, not before, and never for unreadable tokens", () => {
    assert.equal(isExpiringSoon(tokenExpiringIn(REFRESH_AHEAD_MS - 5000)), true);
    assert.equal(isExpiringSoon(tokenExpiringIn(-5000)), true);
    assert.equal(isExpiringSoon(tokenExpiringIn(REFRESH_AHEAD_MS + 60_000)), false);
    assert.equal(isExpiringSoon("opaque"), false);
  });

  it("only the backend's TOKEN_EXPIRED 401 counts as safe to re-send", () => {
    assert.equal(isTokenExpiredResponse(401, tokenExpired.data), true);
    assert.equal(isTokenExpiredResponse(401, { message: "Current password is incorrect", data: null }), false);
    assert.equal(isTokenExpiredResponse(401, null), false);
    assert.equal(isTokenExpiredResponse(403, tokenExpired.data), false);
  });

  it("leaves /auth/* calls out of the ahead-of-time refresh", () => {
    for (const url of ["/auth/logout", "auth/refresh", "/auth/login"]) assert.equal(skipsProactiveRefresh(url), true, url);
    for (const url of ["/users/me", "/invoices", undefined]) assert.equal(skipsProactiveRefresh(url), false, String(url));
  });
});

// ── api.ts interceptors ─────────────────────────────────────────────────────

describe("api client", () => {
  it("refreshes a token about to expire BEFORE sending — once, however many requests are waiting", async () => {
    signIn(tokenExpiringIn(30_000, "old"));
    await Promise.all([api.get("/a"), api.get("/b"), api.post("/c", { x: 1 })]);

    assert.equal(refreshCalls, 1);
    assert.equal(seen.length, 3);
    for (const req of seen) assert.equal(req.auth, `Bearer ${nextAccessToken}`);
    assert.equal(store.get("accessToken"), nextAccessToken);
    assert.equal(store.get("refreshToken"), "rt-rotated");
    // Bounded, since it runs under the cross-tab lock
    assert.equal(lastRefreshTimeout, 15_000);
  });

  it("leaves a token with time left alone", async () => {
    const token = tokenExpiringIn(10 * 60_000);
    signIn(token);
    await api.get("/a");
    assert.equal(refreshCalls, 0);
    assert.equal(seen[0].auth, `Bearer ${token}`);
  });

  it("re-sends a WRITE whose 401 is TOKEN_EXPIRED (e.g. clock skew made the token look fresh)", async () => {
    signIn(tokenExpiringIn(10 * 60_000, "old"));
    respond = (_req, attempt) => (attempt === 1 ? tokenExpired : { status: 200, data: { posted: true } });

    const res = await api.patch("/invoices/1", { postedStatus: "manual" });
    assert.deepEqual(res.data, { posted: true });
    assert.equal(seen.length, 2);
    assert.equal(seen[1].auth, `Bearer ${nextAccessToken}`);
    assert.equal(sessionExpiredEvents, 0);
  });

  it("never re-sends a write whose 401 is anything else", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    respond = () => ({ status: 401, data: { message: "Current password is incorrect", data: null } });

    await assert.rejects(api.post("/auth/change-password", { currentPassword: "x", newPassword: "y" }), (err: AxiosError) => {
      assert.equal(err.response?.status, 401);
      return true;
    });
    assert.equal(seen.filter((s) => s.url === "/auth/change-password").length, 1);
  });

  it("re-sends a GET after a 401 as before", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    respond = (_req, attempt) => (attempt === 1 ? { status: 401, data: { message: "Invalid access token" } } : { status: 200, data: { ok: true } });
    await api.get("/connections");
    assert.equal(seen.length, 2);
  });

  it("does not refresh ahead of a logout, so the logout presents the refresh token that is still live", async () => {
    signIn(tokenExpiringIn(30_000));
    await api.post("/auth/logout", { refreshToken: "rt-1" });
    assert.equal(refreshCalls, 0);
  });

  it("a refresh that fails signs the user out", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    respond = () => tokenExpired;
    refreshFails = true;

    await assert.rejects(api.post("/invoices", {}));
    assert.equal(sessionExpiredEvents, 1);
    assert.equal(store.get("accessToken"), undefined);
  });
});

// ── several tabs, one refresh token ─────────────────────────────────────────

describe("refresh across tabs", () => {
  it("waits for another tab's refresh and uses its token instead of spending the same refresh token again", async () => {
    signIn(tokenExpiringIn(30_000, "old"));
    const otherTabsToken = tokenExpiringIn(15 * 60_000, "other-tab");

    // Another tab is mid-refresh: it holds the lock, then stores its result
    let releaseOtherTab!: () => void;
    const otherTab = navigator.locks.request("scantrix-token-refresh", async () => {
      await new Promise<void>((r) => (releaseOtherTab = r));
      store.set("accessToken", otherTabsToken);
      store.set("refreshToken", "rt-from-other-tab");
    });

    const request = api.get("/a");
    await new Promise((r) => setTimeout(r, 20)); // our refresh is now queued on the lock
    releaseOtherTab();
    await Promise.all([request, otherTab]);

    assert.equal(refreshCalls, 0);
    assert.equal(seen[0].auth, `Bearer ${otherTabsToken}`);
    assert.equal(store.get("refreshToken"), "rt-from-other-tab");
    assert.equal(sessionExpiredEvents, 0);
  });

  it("without Web Locks: a refresh refused because another tab rotated first doesn't sign anyone out", async () => {
    // Shadow the prototype's getter for this test; deleting the shadow restores it
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    try {
      signIn(tokenExpiringIn(10 * 60_000, "old"));
      const otherTabsToken = tokenExpiringIn(15 * 60_000, "other-tab");
      respond = (_req, attempt) => (attempt === 1 ? tokenExpired : { status: 200, data: { ok: true } });
      // The other tab's rotation lands while our refresh is in flight
      refreshFails = true;
      axios.defaults.adapter = async (config) => {
        store.set("accessToken", otherTabsToken);
        store.set("refreshToken", "rt-from-other-tab");
        return refreshAdapter(config);
      };

      await api.post("/invoices", {});
      assert.equal(seen.at(-1)!.auth, `Bearer ${otherTabsToken}`);
      assert.equal(store.get("refreshToken"), "rt-from-other-tab");
      assert.equal(sessionExpiredEvents, 0);
    } finally {
      delete (navigator as any).locks;
    }
  });
});

describe("device clock ahead of the server", () => {
  it("refreshes once, then trusts the measured skew instead of refreshing before every request", async () => {
    const serverNow = Date.now() - 20 * 60_000; // this device runs 20 min fast
    signIn(tokenExpiringIn(15 * 60_000, "old", serverNow));
    nextAccessToken = tokenExpiringIn(15 * 60_000, "new", serverNow);

    await api.get("/a");
    await api.get("/b");
    await api.get("/c");
    assert.equal(refreshCalls, 1);
    assert.equal(seen.every((r) => r.auth === `Bearer ${nextAccessToken}`), true);
  });
});

// ── authFetch ───────────────────────────────────────────────────────────────

describe("authFetch", () => {
  let fetchCalls: { url: string; auth: string | null }[] = [];
  let fetchAnswer: (attempt: number) => number = () => 200;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    fetchAnswer = () => 200;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
      return new Response("{}", { status: fetchAnswer(fetchCalls.length) });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("sends a refreshed token when the stored one is about to expire, keeping the caller's headers", async () => {
    signIn(tokenExpiringIn(30_000));
    const res = await authFetch("/api/chat", { method: "POST", headers: { "X-QB-Id": "qb1" }, body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(refreshCalls, 1);
    assert.equal(fetchCalls[0].auth, `Bearer ${nextAccessToken}`);
  });

  it("on a 401, refreshes once and re-sends — the user sees no error", async () => {
    signIn(tokenExpiringIn(10 * 60_000, "old"));
    fetchAnswer = (n) => (n === 1 ? 401 : 200);

    const res = await authFetch("/api/chat/history");
    assert.equal(res.status, 200);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[1].auth, `Bearer ${nextAccessToken}`);
    assert.equal(sessionExpiredEvents, 0);
  });

  it("ends the session when the refresh fails", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    fetchAnswer = () => 401;
    refreshFails = true;

    const res = await authFetch("/api/inbound/aliases");
    assert.equal(res.status, 401);
    assert.equal(fetchCalls.length, 1);
    assert.equal(sessionExpiredEvents, 1);
  });

  it("ends the session when even the re-sent request is refused (e.g. the account was deleted)", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    fetchAnswer = () => 401;

    const res = await authFetch("/api/chat");
    assert.equal(res.status, 401);
    assert.equal(fetchCalls.length, 2);
    assert.equal(sessionExpiredEvents, 1);
  });

  it("leaves non-401 failures to the caller", async () => {
    signIn(tokenExpiringIn(10 * 60_000));
    fetchAnswer = () => 503;
    const res = await authFetch("/api/chat");
    assert.equal(res.status, 503);
    assert.equal(refreshCalls, 0);
    assert.equal(sessionExpiredEvents, 0);
  });
});
