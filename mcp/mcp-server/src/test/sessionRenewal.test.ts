// Keeping a Claude connection alive past the Savetrix access token's 7 days.
//
// The connector's OAuth tokens carry the Savetrix session inside them. Before
// this, a refresh re-wrapped the same Savetrix tokens, and the client's own
// refresh called /auth/refresh-token, a route that doesn't exist, so every
// connection broke within a week. These tests drive /token's refresh_token
// grant against a fake Savetrix that rotates refresh tokens like the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createRemoteApp } from "../servers/remoteServer.js";
import { encryptToken, decryptToken } from "../auth/tokens.js";
import type { Config } from "../config.js";

const TOKEN_SECRET = "test-secret-that-is-at-least-32-chars-long";
const HOUR = 60 * 60;

/** A JWT-shaped Savetrix access token expiring `inSeconds` from now. */
const savetrixToken = (name: string, inSeconds: number): string => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ id: name, iat: now, exp: now + inSeconds })}.sig`;
};

const listen = (app: express.Express): Promise<{ url: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });

/** Fake Savetrix /auth/refresh: accepts each refresh token once, rotates it. */
const startFakeSavetrix = async (opts: { accept: boolean }) => {
  const used: string[] = [];
  const app = express();
  app.post("/auth/refresh", express.json(), (req, res) => {
    const rt = req.body?.refreshToken;
    used.push(rt);
    if (!opts.accept || rt !== "rt-1") {
      res.status(401).json({ success: false, message: "Invalid refresh token", data: null });
      return;
    }
    res.json({ success: true, data: { accessToken: savetrixToken("renewed", 7 * 24 * HOUR), refreshToken: "rt-2" } });
  });
  return { ...(await listen(app)), used };
};

const makeConfig = (apiUrl: string): Config => ({
  apiUrl,
  webUrl: "https://web.test",
  port: 0,
  http: true,
  remote: true,
  configFilePath: "does/not/matter.json",
  publicUrl: "https://connector.test",
  allowedHosts: [],
  tokenSecret: TOKEN_SECRET,
});

/** Register a client, then refresh an MCP session wrapping `st_at` / "rt-1". */
const refreshWith = async (connector: string, stAt: string) => {
  const reg = await fetch(`${connector}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: ["https://claude.test/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const { client_id: clientId } = (await reg.json()) as { client_id: string };
  const refreshToken = await encryptToken(
    TOKEN_SECRET,
    "refresh",
    { session: { st_at: stAt, st_rt: "rt-1", client_id: clientId, email: "a@scantrix.ai" } },
    30 * 24 * HOUR,
  );
  const res = await fetch(`${connector}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  const session = body.access_token
    ? (await decryptToken<{ session: { st_at: string; st_rt: string } }>(TOKEN_SECRET, "access", body.access_token))
        .session
    : undefined;
  return { status: res.status, body, session };
};

test("plenty of time left: the Savetrix session is passed through untouched", async () => {
  const backend = await startFakeSavetrix({ accept: true });
  const connector = await listen(createRemoteApp(makeConfig(backend.url)));
  try {
    const stAt = savetrixToken("current", 5 * 24 * HOUR);
    const { status, session } = await refreshWith(connector.url, stAt);
    assert.equal(status, 200);
    assert.equal(session?.st_at, stAt);
    assert.equal(session?.st_rt, "rt-1");
    assert.deepEqual(backend.used, [], "no needless refresh: Savetrix rotates tokens");
  } finally {
    await connector.close();
    await backend.close();
  }
});

test("under a day left: the Savetrix pair is renewed and the rotated token kept", async () => {
  const backend = await startFakeSavetrix({ accept: true });
  const connector = await listen(createRemoteApp(makeConfig(backend.url)));
  try {
    const { status, session } = await refreshWith(connector.url, savetrixToken("current", 2 * HOUR));
    assert.equal(status, 200);
    assert.deepEqual(backend.used, ["rt-1"]);
    assert.equal(session?.st_rt, "rt-2");
    assert.match(session?.st_at ?? "", /\./);
    assert.notEqual(session?.st_at, savetrixToken("current", 2 * HOUR));
  } finally {
    await connector.close();
    await backend.close();
  }
});

test("renewal failing while the token still works keeps the connection", async () => {
  const backend = await startFakeSavetrix({ accept: false });
  const connector = await listen(createRemoteApp(makeConfig(backend.url)));
  try {
    const stAt = savetrixToken("current", 2 * HOUR);
    const { status, session } = await refreshWith(connector.url, stAt);
    assert.equal(status, 200);
    assert.equal(session?.st_at, stAt, "kept; renewal is retried at the next refresh");
  } finally {
    await connector.close();
    await backend.close();
  }
});

test("expired and not renewable: invalid_grant, so Claude asks to sign in again", async () => {
  const backend = await startFakeSavetrix({ accept: false });
  const connector = await listen(createRemoteApp(makeConfig(backend.url)));
  try {
    const { status, body } = await refreshWith(connector.url, savetrixToken("current", -HOUR));
    assert.equal(status, 400);
    assert.equal(body.error, "invalid_grant");
  } finally {
    await connector.close();
    await backend.close();
  }
});
