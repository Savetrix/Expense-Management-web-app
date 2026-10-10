import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SavetrixClient } from "../client/savetrixClient.js";
import { SessionStore } from "../session.js";
import {
  unwrapList,
  unwrapOne,
  getPagination,
  UpstreamPayloadError,
} from "../client/unwrap.js";
import { uploadInvoice, resolveUploadSource, getInvoice, listInvoices } from "../client/invoices.js";
import { listVendors } from "../client/vendors.js";
import { deactivateVendor } from "../client/vendors.js";
import { getStatus, listConnections } from "../client/quickbooks.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { invoiceUploadSchema } from "../tools/schemas.js";

const makeSession = async (): Promise<SessionStore> => {
  const dir = await mkdtemp(join(tmpdir(), "savetrix-client-"));
  return new SessionStore(join(dir, "session.json"));
};

/**
 * Resolve a captured request config the way axios's http adapter does —
 * combineURLs, then hand the result to WHATWG URL. That last step is the one
 * that used to collapse "../.." out of the path, so a traversal assertion is
 * only meaningful if the test reproduces it.
 */
const resolvedPath = (config: { baseURL?: string; url?: string }): string => {
  const url = String(config.url ?? "");
  if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
  const base = String(config.baseURL ?? "").replace(/\/+$/, "");
  return new URL(`${base}/${url.replace(/^\/+/, "")}`).pathname;
};

test("unwrapList normalizes data.data.invoices / data.items / plain arrays", () => {
  assert.equal(
    unwrapList({ data: { data: { invoices: [{ _id: "1" }] } } } as any, ["invoices"]).length,
    1,
  );
  assert.equal(unwrapList({ data: { data: { items: [1] } } } as any, ["invoices", "items"]).length, 1);
  assert.equal(unwrapList({ data: [1, 2] } as any, ["invoices"]).length, 2);
});

// A response that CARRIES the list is the only success case, and an empty
// array in it is a real answer — the tools that legitimately have nothing to
// show must keep working.
test("unwrapList returns an empty list when the backend really sent an empty list", () => {
  assert.deepEqual(unwrapList({ data: { data: { invoices: [] } } } as any, ["invoices"]), []);
  assert.deepEqual(unwrapList({ data: { data: { vendors: [] } } } as any, ["vendors"]), []);
  assert.deepEqual(unwrapList({ data: [] } as any, ["invoices"]), []);
});

// The bug this whole module exists to prevent: the backend answers HTTP 200
// with {success:false, message:"QuickBooks token revoked — reconnect
// required"}, and the old unwrapList turned that into [] — so the model told
// the user "you have no invoices". A revoked connection, an authorization
// failure and an empty list were indistinguishable.
test("unwrapList fails loudly on a 200 that says success:false, carrying the upstream message", () => {
  const revoked = {
    status: 200,
    data: { success: false, message: "QuickBooks token revoked — reconnect required" },
  } as any;
  assert.throws(
    () => unwrapList(revoked, ["invoices"]),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamPayloadError, "must be an UpstreamPayloadError");
      assert.equal(error.kind, "upstream_failure");
      assert.equal(error.upstreamMessage, "QuickBooks token revoked — reconnect required");
      assert.match(error.message, /QuickBooks token revoked/);
      return true;
    },
  );
  // Same for the other failure spellings, and for a message-only body.
  for (const data of [
    { ok: false, message: "nope" },
    { status: "error", message: "nope" },
    { error: "Not authorized for this company" },
    { message: "Something went wrong upstream" },
    { data: { success: false, message: "nope" } },
  ]) {
    assert.throws(() => unwrapList({ status: 200, data } as any, ["invoices"]), UpstreamPayloadError);
  }
});

test("unwrapList fails loudly when the response shape cannot be interpreted", () => {
  // NOTE: `{data:{}}` and a wholly absent payload are deliberately NOT here —
  // an empty envelope with no failure signal is treated as a genuinely empty
  // list, because a brand-new account is its most likely producer and erroring
  // would break first-run onboarding. See unwrapList and the companion
  // "ambiguous empty case" tests below.
  for (const data of [
    { data: { totally: "unexpected" } },
    { totally: "unexpected" },
    "<html>502 Bad Gateway</html>",
    42,
  ]) {
    assert.throws(
      () => unwrapList({ status: 200, data } as any, ["invoices"]),
      (error: unknown) => {
        assert.ok(error instanceof UpstreamPayloadError);
        assert.equal(error.kind, "unrecognized_response");
        assert.match(error.message, /Could not interpret|Refusing/);
        return true;
      },
      JSON.stringify(data ?? null),
    );
  }
});

test("unwrapList treats an empty envelope as a genuinely empty list", () => {
  // The bug this file guards against — a 200 carrying success:false being
  // reported as "you have no invoices" — is caught by the failure-signal
  // check, not by being strict about `{}`. Being strict here would instead
  // regress first-run onboarding.
  // `{data:null}` is deliberately excluded: the `?? res.data` fallback makes
  // the whole body the payload, which is a non-empty object and so correctly
  // reads as uninterpretable rather than empty.
  for (const data of [{ data: {} }, {}]) {
    assert.deepEqual(unwrapList({ status: 200, data } as never, ["invoices"], "invoices"), []);
  }
});

test("unwrapOne returns data.data.invoice then falls back to data", () => {
  assert.deepEqual(unwrapOne({ data: { data: { invoice: { a: 1 } } } } as any, ["invoice"]), { a: 1 });
  assert.deepEqual(unwrapOne({ data: { x: 2 } } as any, ["invoice"]), { x: 2 });
});

// unwrapOne had the same defect in a different costume: it handed the failure
// envelope itself back as if it were the requested record.
test("unwrapOne fails loudly on an upstream failure or an uninterpretable body", () => {
  assert.throws(
    () =>
      unwrapOne({ status: 200, data: { success: false, message: "Invoice not found" } } as any, [
        "invoice",
      ]),
    (error: unknown) => {
      assert.ok(error instanceof UpstreamPayloadError);
      assert.equal(error.kind, "upstream_failure");
      assert.equal(error.upstreamMessage, "Invoice not found");
      return true;
    },
  );
  for (const data of [{ data: {} }, "<html>502</html>", null]) {
    assert.throws(() => unwrapOne({ status: 200, data } as any, ["invoice"]), UpstreamPayloadError);
  }
  // An endpoint that returns the record unwrapped is still a shape we know.
  assert.deepEqual(unwrapOne({ status: 200, data: { data: { _id: "i1" } } } as any, ["invoice"]), {
    _id: "i1",
  });
});

// End-to-end through the real client: the list tools must not translate a
// revoked connection into "no data".
test("listInvoices/listVendors reject a 200 failure body instead of reporting nothing", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  client.setActiveQbId("qb-1");
  mock
    .onGet("/invoices")
    .reply(200, { success: false, message: "QuickBooks token revoked — reconnect required" });
  mock.onGet("/quickbooks/vendors").reply(200, { success: false, message: "Company disconnected" });

  await assert.rejects(listInvoices(client, {}), /QuickBooks token revoked/);
  await assert.rejects(listVendors(client, "active"), /Company disconnected/);
  mock.restore();
});

test("getPagination returns pagination object or undefined", () => {
  assert.deepEqual(getPagination({ data: { data: { pagination: { page: 1 } } } } as any), { page: 1 });
  assert.equal(getPagination({ data: { data: {} } } as any), undefined);
});

test("client attaches Bearer token and X-QB-Id headers", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  client.setActiveQbId("qb-9");
  mock.onGet("/invoices").reply((config) => {
    assert.equal(config.headers?.Authorization, "Bearer at");
    assert.equal(config.headers?.["X-QB-Id"], "qb-9");
    return [200, { data: { invoices: [], pagination: {} } }];
  });
  await client.api.get("/invoices");
  mock.restore();
});

// Regression test for a real client-reported confusion: a stale Intuit
// access token (normal — they live 1 hour and get refreshed transparently)
// was being summarized by the model as "Access token expired... may fail
// until reauthorized", which a non-technical user reads as a real error.
// getStatus/listConnections must allowlist their output rather than pass the
// backend's raw response straight through, so token/expiry fields never
// reach the model in the first place, regardless of what shape the backend
// actually returns them in.
test("getStatus strips token/expiry fields, keeping only connected + realmId", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  mock.onGet("/quickbooks/status").reply(200, {
    data: {
      connected: true,
      realmId: "9341457544400313",
      accessTokenExpiresAt: "2026-08-02T00:00:00Z",
      refreshTokenExpiresAt: "2026-11-10T00:00:00Z",
      accessToken: "super-secret-intuit-token",
    },
  });
  const status = await getStatus(client, "qb-1");
  assert.deepEqual(status, { connected: true, realmId: "9341457544400313" });
  mock.restore();
});

test("listConnections strips token/expiry fields from each connection", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  mock.onGet("/qb-connections").reply(200, {
    data: {
      connections: [
        {
          _id: "conn-1",
          name: "Ontario Inc.",
          realmId: "9341457544400313",
          role: "admin",
          status: "active",
          createdAt: "2026-01-01T00:00:00Z",
          accessTokenExpiresAt: "2026-08-02T00:00:00Z",
          refreshToken: "super-secret-intuit-refresh-token",
        },
      ],
    },
  });
  const connections = (await listConnections(client)) as unknown[];
  assert.deepEqual(connections, [
    { id: "conn-1", name: "Ontario Inc.", realmId: "9341457544400313", role: "admin", status: "active" },
  ]);
  mock.restore();
});

// Regression test for a proven path traversal: model-supplied ids were
// interpolated raw into the request path, and because the final URL goes
// through WHATWG URL normalization, an invoiceId of "../../users/me" escaped
// both /invoices/ and the /api base — arbitrary GET/PATCH/DELETE against the
// whole backend under the signed-in user's credentials. encodeURIComponent at
// every interpolation site is what keeps the segment a segment.
test("a traversal-shaped id stays inside its own path segment", async () => {
  const instance = axios.create({ baseURL: "https://api.test/api" });
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test/api",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  client.setActiveQbId("qb-1");

  const paths: string[] = [];
  mock.onAny().reply((config) => {
    paths.push(resolvedPath(config));
    // Has to be a body getInvoice can actually interpret — unwrapOne now
    // refuses an empty envelope rather than passing it off as the record.
    return [200, { data: { invoice: {} } }];
  });

  await getInvoice(client, "../../users/me");
  await deactivateVendor(client, "../../../admin/users");

  assert.deepEqual(paths, [
    "/api/invoices/..%2F..%2Fusers%2Fme",
    "/api/quickbooks/vendors/..%2F..%2F..%2Fadmin%2Fusers",
  ]);
  for (const path of paths) {
    assert.ok(!/\/users\/me$|\/admin\//.test(path), `escaped its base: ${path}`);
  }
  mock.restore();
});

test("client refreshes access token once on 401 and retries", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("expired", "rt-1");
  // The real route and shape (verified against api.savetrix.com): /auth/refresh,
  // answering { data: { accessToken, refreshToken } } with a NEW refresh token.
  mock.onPost("/auth/refresh").reply(200, { data: { accessToken: "fresh", refreshToken: "rt-2" } });
  mock.onGet("/invoices").replyOnce(401, { message: "expired" });
  mock.onGet("/invoices").replyOnce((config) => {
    assert.equal(config.headers?.Authorization, "Bearer fresh");
    return [200, { data: { invoices: [], pagination: {} } }];
  });
  await client.api.get("/invoices");
  assert.equal(client.getAccessToken(), "fresh");
  // The rotated refresh token is kept; the old one is dead after this call.
  assert.equal(client.getRefreshToken(), "rt-2");
  assert.equal(mock.history.post.filter((r) => r.url === "/auth/refresh-token").length, 0);
  mock.restore();
});

test("concurrent 401s share one refresh, so a rotated token isn't spent twice", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const session = await makeSession();
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session,
    axiosInstance: instance as never,
  });
  client.setTokens("expired", "rt-1");
  let refreshes = 0;
  mock.onPost("/auth/refresh").reply((config) => {
    refreshes += 1;
    // Savetrix accepts each refresh token once.
    if (JSON.parse(config.data).refreshToken !== "rt-1") return [401, { message: "Invalid refresh token" }];
    return [200, { data: { accessToken: "fresh", refreshToken: "rt-2" } }];
  });
  mock.onGet("/vendors").reply((config) =>
    config.headers?.Authorization === "Bearer fresh" ? [200, { data: { vendors: [] } }] : [401, {}],
  );
  await Promise.all([client.api.get("/vendors"), client.api.get("/vendors"), client.api.get("/vendors")]);
  assert.equal(refreshes, 1);
  assert.equal(session.load().refreshToken, "rt-2", "the rotated token is saved for next time");
  mock.restore();
});

test("client surfaces a clear error when refresh fails", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("expired", "rt-dead");
  mock.onPost("/auth/refresh").reply(401, {});
  mock.onGet("/invoices").replyOnce(401, {});
  await assert.rejects(client.api.get("/invoices"), /session has expired.*Reconnect/i);
  mock.restore();
});

test("client login saves tokens and returns unwrapped payload", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  mock.onPost("/auth/login").reply(200, {
    data: { accessToken: "at1", refreshToken: "rt1", user: { _id: "u1" } },
  });
  const result = await client.login("a@b.test", "pw");
  assert.equal(result.data.accessToken, "at1");
  assert.equal(client.getAccessToken(), "at1");
  assert.equal(client.getRefreshToken(), "rt1");
  mock.restore();
});

test("client logout calls the backend and clears tokens", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  mock.onPost("/auth/logout").reply(200, { success: true });
  await client.logout();
  assert.equal(client.getAccessToken(), undefined);
  mock.restore();
});

test("invoice upload accepts inline base64 when the MCP server cannot access the client path", async () => {
  const instance = axios.create();
  const mock = new MockAdapter(instance as never);
  const client = new SavetrixClient({
    baseURL: "https://api.test",
    session: await makeSession(),
    axiosInstance: instance as never,
  });
  client.setTokens("at", "rt");
  mock.onPost("/invoices").reply((config) => {
    assert.match(String(config.headers?.["Content-Type"]), /^multipart\/form-data; boundary=/);
    assert.match(config.data.getBuffer().toString("utf8"), /invoice\.pdf/);
    return [200, { success: true }];
  });

  const result = await uploadInvoice(client, {
    fileBase64: Buffer.from("test pdf bytes").toString("base64"),
    fileName: "invoice.pdf",
  });

  assert.deepEqual(result, { success: true });
  mock.restore();
});

// Regression guard for the bug that broke remote uploads: a z.union here
// serializes to a top-level `anyOf`, which the MCP SDK silently degrades to
// `{"type":"object","properties":{}}` — a tool Claude sees as taking no
// arguments at all. Anthropic's API also rejects top-level anyOf outright.
test("invoice upload tool schema is a flat object with real properties", async () => {
  const json = toJsonSchemaCompat(invoiceUploadSchema, { strictUnions: true }) as {
    type?: string;
    anyOf?: unknown;
    oneOf?: unknown;
    allOf?: unknown;
    properties?: Record<string, unknown>;
  };
  assert.equal(json.type, "object", "input_schema must be type=object at the root");
  assert.equal(json.anyOf, undefined, "top-level anyOf is rejected by the Anthropic API");
  assert.equal(json.oneOf, undefined);
  assert.equal(json.allOf, undefined);
  const props = Object.keys(json.properties ?? {}).sort();
  assert.deepEqual(props, ["fileBase64", "fileName", "filePath", "fileUrl", "mimeType", "qbConnectionId"]);
});

test("resolveUploadSource requires exactly one source", async () => {
  await assert.rejects(resolveUploadSource({}), /No file provided/);
  await assert.rejects(
    resolveUploadSource({ fileUrl: "https://x.test/a.pdf", filePath: "/tmp/a.pdf" }),
    /only one of/,
  );
});

test("resolveUploadSource rejects oversized inline base64 with actionable guidance", async () => {
  await assert.rejects(
    resolveUploadSource({
      fileBase64: Buffer.alloc(9 * 1024, 1).toString("base64"),
      fileName: "big.pdf",
    }),
    /savetrix_invoice_upload_link/,
  );
});

test("resolveUploadSource refuses fileUrl aimed at internal hosts", async () => {
  for (const url of [
    "http://localhost:8000/x.pdf",
    "http://127.0.0.1/x.pdf",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x.pdf",
    "file:///etc/passwd",
    // IPv4-mapped IPv6. Same address to the network stack, but it matches
    // none of the dotted-quad patterns until it is folded back to IPv4 —
    // and the URL parser rewrites the readable form into the hex one, so
    // both spellings have to be covered.
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://[0:0:0:0:0:ffff:127.0.0.1]/x.pdf",
  ]) {
    await assert.rejects(resolveUploadSource({ fileUrl: url }), /public host|http\(s\) URL/, url);
  }
});

// assertFetchableUrl only ever sees the FIRST url, so following redirects
// meant a public host answering 302 -> http://169.254.169.254/ walked past
// the entire deny-list above. Proven end-to-end before the fix.
test("resolveUploadSource does not follow a redirect toward an internal address", async () => {
  const scope = new MockAdapter(axios as never);
  let sawMaxRedirects: number | undefined;
  scope.onGet("https://files.test/share-link.pdf").reply((config) => {
    sawMaxRedirects = config.maxRedirects;
    return [302, "", { location: "http://169.254.169.254/latest/meta-data/iam/" }];
  });
  await assert.rejects(
    resolveUploadSource({ fileUrl: "https://files.test/share-link.pdf" }),
    /redirected \(HTTP 302\)/,
  );
  assert.equal(sawMaxRedirects, 0, "axios must be told not to follow redirects at all");
  scope.restore();
});

// On the remote connector the only filesystem in reach is the connector's own
// container, so a filePath read is an arbitrary read of the deployment —
// /proc/self/environ carries SAVETRIX_TOKEN_SECRET, the key that encrypts
// every OAuth artifact this server issues.
test("resolveUploadSource refuses filePath when the caller disallows it", async () => {
  await assert.rejects(
    resolveUploadSource({ filePath: "/proc/self/environ" }, { allowFilePath: false }),
    /not accepted by this connector/,
  );
  // Local/stdio installs still read real files, and a missing one still fails
  // as a plain filesystem error rather than a policy error.
  await assert.rejects(
    resolveUploadSource({ filePath: "/definitely/not/here.pdf" }),
    /ENOENT|no such file/i,
  );
});

test("resolveUploadSource downloads fileUrl and infers name and type", async () => {
  const scope = new MockAdapter(axios as never);
  scope.onGet("https://files.test/bill-42.pdf").reply(200, Buffer.from("%PDF-1.7 bytes"), {
    "content-type": "application/pdf",
  });
  const resolved = await resolveUploadSource({ fileUrl: "https://files.test/bill-42.pdf" });
  assert.equal(resolved.fileName, "bill-42.pdf");
  assert.equal(resolved.mimeType, "application/pdf");
  assert.ok(resolved.bytes.length > 0);
  scope.restore();
});
