// "Continue with Google" on the connector's /login page.
//
// Accounts created with Google often have no password, so before this the
// only way they could connect Claude was to set one first. These tests run the
// whole OAuth flow (register -> authorize -> login -> token) against a fake
// Savetrix backend that answers /auth/google the way the real one does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { createRemoteApp } from "../servers/remoteServer.js";
import { decryptToken } from "../auth/tokens.js";
const TOKEN_SECRET = "test-secret-that-is-at-least-32-chars-long";
const GOOGLE_CLIENT_ID = "1234-test.apps.googleusercontent.com";
const GOOD_TOKEN = "good-google-id-token";
const REDIRECT_URI = "https://claude.test/callback";
const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        resolve({
            url: `http://127.0.0.1:${port}`,
            close: () => new Promise((r) => server.close(() => r())),
        });
    });
});
/** A stand-in for api.savetrix.com: same responses as the real /auth/google. */
const startFakeSavetrix = async () => {
    const received = [];
    const app = express();
    app.post("/auth/google", express.json(), (req, res) => {
        const idToken = req.body?.idToken;
        if (!idToken) {
            res.status(400).json({ success: false, message: "idToken is required", data: null, statusCode: 400 });
            return;
        }
        received.push(idToken);
        if (idToken !== GOOD_TOKEN) {
            res.status(401).json({ success: false, message: "Invalid Google token", data: null, statusCode: 401 });
            return;
        }
        res.json({
            success: true,
            message: "Login successful",
            data: {
                accessToken: "st-access",
                refreshToken: "st-refresh",
                user: { _id: "user-1", email: "google.user@scantrix.ai" },
            },
        });
    });
    const server = await listen(app);
    return { ...server, received };
};
const makeConfig = (apiUrl, overrides = {}) => ({
    apiUrl,
    webUrl: "https://web.test",
    port: 0,
    http: true,
    remote: true,
    configFilePath: "does/not/matter.json",
    publicUrl: "https://connector.test",
    allowedHosts: [],
    tokenSecret: TOKEN_SECRET,
    googleClientId: GOOGLE_CLIENT_ID,
    ...overrides,
});
/** Register a client and run /authorize; returns what the login page needs. */
const beginAuthorization = async (connector) => {
    const reg = await fetch(`${connector}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_name: "Claude",
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
        }),
    });
    assert.equal(reg.status, 201);
    const { client_id: clientId } = (await reg.json());
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(`${connector}/authorize`);
    authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "state-123",
    }).toString();
    const auth = await fetch(authorize, { redirect: "manual" });
    assert.equal(auth.status, 302);
    const loginUrl = new URL(auth.headers.get("location"));
    const reqToken = loginUrl.searchParams.get("req");
    assert.ok(reqToken, "authorize should redirect to /login with a req token");
    return { clientId, verifier, reqToken };
};
const postForm = (url, fields) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
});
test("the login page offers Continue with Google, wired to /login/google", async () => {
    const backend = await startFakeSavetrix();
    const connector = await listen(createRemoteApp(makeConfig(backend.url)));
    try {
        const { reqToken } = await beginAuthorization(connector.url);
        const page = await (await fetch(`${connector.url}/login?req=${encodeURIComponent(reqToken)}`)).text();
        assert.match(page, /accounts\.google\.com\/gsi\/client/);
        assert.ok(page.includes(`client_id: "${GOOGLE_CLIENT_ID}"`), "the page initialises Google with the client ID");
        assert.match(page, /<form method="POST" action="\/login\/google" id="googleForm">/);
        assert.ok(page.includes(`name="req" value="${reqToken}"`), "the Google form carries the login request");
        // The password form is still there.
        assert.match(page, /<form method="POST" action="\/login" id="loginForm">/);
    }
    finally {
        await connector.close();
        await backend.close();
    }
});
test("without a Google client ID the page has no Google button", async () => {
    const backend = await startFakeSavetrix();
    const connector = await listen(createRemoteApp(makeConfig(backend.url, { googleClientId: undefined })));
    try {
        const { reqToken } = await beginAuthorization(connector.url);
        const page = await (await fetch(`${connector.url}/login?req=${encodeURIComponent(reqToken)}`)).text();
        assert.doesNotMatch(page, /gsi\/client|googleForm/);
        assert.match(page, /If you signed up with Google, Microsoft, or Apple/);
    }
    finally {
        await connector.close();
        await backend.close();
    }
});
test("a Google sign-in completes the OAuth flow with the Savetrix session inside", async () => {
    const backend = await startFakeSavetrix();
    const connector = await listen(createRemoteApp(makeConfig(backend.url)));
    try {
        const { clientId, verifier, reqToken } = await beginAuthorization(connector.url);
        const login = await postForm(`${connector.url}/login/google`, { req: reqToken, credential: GOOD_TOKEN });
        assert.equal(login.status, 302);
        const back = new URL(login.headers.get("location"));
        assert.equal(`${back.origin}${back.pathname}`, REDIRECT_URI);
        assert.equal(back.searchParams.get("state"), "state-123");
        const code = back.searchParams.get("code");
        assert.ok(code);
        assert.deepEqual(backend.received, [GOOD_TOKEN], "the ID token went to Savetrix's /auth/google");
        const token = await postForm(`${connector.url}/token`, {
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
        });
        assert.equal(token.status, 200);
        const tokens = (await token.json());
        const { session } = await decryptToken(TOKEN_SECRET, "access", tokens.access_token);
        assert.equal(session.st_at, "st-access");
        assert.equal(session.st_rt, "st-refresh");
        assert.equal(session.userId, "user-1");
        assert.equal(session.email, "google.user@scantrix.ai");
    }
    finally {
        await connector.close();
        await backend.close();
    }
});
test("a token Savetrix rejects shows the login page again with a clear error", async () => {
    const backend = await startFakeSavetrix();
    const connector = await listen(createRemoteApp(makeConfig(backend.url)));
    try {
        const { reqToken } = await beginAuthorization(connector.url);
        const res = await postForm(`${connector.url}/login/google`, { req: reqToken, credential: "forged" });
        assert.equal(res.status, 401);
        const page = await res.text();
        assert.match(page, /Google sign-in didn&#39;t go through/);
        // Not mistaken for an expired session (the client's refresh interceptor
        // would otherwise turn Savetrix's 401 into "Not logged in").
        assert.doesNotMatch(page, /savetrix_login|Not logged in/);
        // The user can try again from the same page.
        assert.ok(page.includes(`name="req" value="${reqToken}"`));
    }
    finally {
        await connector.close();
        await backend.close();
    }
});
test("a missing credential or expired request never reaches Savetrix", async () => {
    const backend = await startFakeSavetrix();
    const connector = await listen(createRemoteApp(makeConfig(backend.url)));
    try {
        const { reqToken } = await beginAuthorization(connector.url);
        const empty = await postForm(`${connector.url}/login/google`, { req: reqToken, credential: "" });
        assert.equal(empty.status, 401);
        const expired = await postForm(`${connector.url}/login/google`, { req: "not-a-real-request", credential: GOOD_TOKEN });
        assert.equal(expired.status, 400);
        assert.deepEqual(backend.received, []);
    }
    finally {
        await connector.close();
        await backend.close();
    }
});
test("Savetrix being unreachable is reported as a connection problem", async () => {
    // Start and stop a server so its port is known to be closed.
    const gone = await startFakeSavetrix();
    await gone.close();
    const connector = await listen(createRemoteApp(makeConfig(gone.url)));
    try {
        const { reqToken } = await beginAuthorization(connector.url);
        const res = await postForm(`${connector.url}/login/google`, { req: reqToken, credential: GOOD_TOKEN });
        assert.equal(res.status, 401);
        assert.match(await res.text(), /Could not reach Scantrix servers/);
    }
    finally {
        await connector.close();
    }
});
