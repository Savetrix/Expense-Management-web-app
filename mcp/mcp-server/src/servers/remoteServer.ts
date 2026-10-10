import express, { type Request, type Response, type NextFunction } from "express";
import { isAxiosError } from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Config } from "../config.js";
import { createClientForTokens } from "../client/savetrixClient.js";
import { registerSavetrixTools } from "../tools/index.js";
import { SavetrixOAuthProvider, type LoginRequest } from "../auth/provider.js";
import { loginPage } from "../auth/loginPage.js";
import { uploadPage } from "../auth/uploadPage.js";
import { encryptToken, decryptToken } from "../auth/tokens.js";
import { uploadInvoiceBytes, MAX_UPLOAD_BYTES } from "../client/invoices.js";

/** How long a browser upload link stays valid — long enough to find the file. */
const UPLOAD_TICKET_TTL = 60 * 30;

/**
 * Vercel caps a serverless function's request body at ~4.5 MB, so promising
 * the API's full 20 MB there would just turn into an opaque 413. Advertise
 * whichever ceiling actually applies.
 */
const maxBrowserUploadBytes = (): number =>
  process.env.VERCEL ? 4 * 1024 * 1024 : MAX_UPLOAD_BYTES;

/** The Savetrix session carried inside an upload ticket. */
interface UploadTicket {
  st_at: string;
  st_rt: string;
  email?: string;
  user?: unknown;
  /** The company active when the link was minted — see createUploadLink below. */
  qbConnectionId?: string;
}

/**
 * Builds the remote connector Express app: an OAuth 2.1 authorization server
 * (so Claude's "Add custom connector" browser flow works) plus the MCP
 * Streamable HTTP endpoint, protected by bearer tokens.
 */
export const createRemoteApp = (config: Config): express.Express => {
  if (!config.publicUrl) {
    throw new Error("SAVETRIX_PUBLIC_URL must be set for the remote connector.");
  }
  const issuerUrl = new URL(config.publicUrl);
  // The actual protected resource is /mcp, not the site root. Without this,
  // mcpAuthRouter defaults resourceServerUrl to the issuer (site root), so
  // the advertised protected-resource metadata says "resource: <root>" while
  // clients are actually connecting to ".../mcp" — a mismatch that a
  // resource-validating client (per RFC 9728 / the MCP authorization spec)
  // can reject as "no MCP server found at the provided URL", even though
  // the OAuth login itself succeeded. Confirmed against
  // @modelcontextprotocol/sdk's own router.js: getOAuthProtectedResourceMetadataUrl's
  // doc example is literally `.../mcp` -> `.../.well-known/oauth-protected-resource/mcp`.
  const resourceUrl = new URL("/mcp", issuerUrl);
  const provider = new SavetrixOAuthProvider(config);

  // ── Host-aware identity (domain migrations) ──
  // The canonical issuer is SAVETRIX_PUBLIC_URL, but a deployment can keep
  // answering on an older alias while clients migrate. Serving the canonical
  // host's metadata to a request that arrived on the alias means telling a
  // client "the resource is <other origin>" — the RFC 9728 mismatch that a
  // validating client rejects as "no MCP server found at the provided URL".
  // So each allowlisted host advertises itself.
  const allowed = new Set(
    [issuerUrl.hostname.toLowerCase(), ...config.allowedHosts].filter(Boolean),
  );

  const baseUrlFor = (req: Request): URL => {
    const host = (req.hostname ?? "").toLowerCase();
    if (!host || !allowed.has(host) || host === issuerUrl.hostname.toLowerCase()) {
      return issuerUrl;
    }
    const url = new URL(issuerUrl.toString());
    // Deliberately built from the ALLOWLISTED hostname, not from req.get("host").
    // Those are different values behind a proxy: req.hostname derives from
    // X-Forwarded-Host while req.get("host") is the raw Host header, so reading
    // one and trusting the other let a request pass the allowlist on the
    // forwarded name and still publish an attacker's Host in the discovery
    // documents — pointing the victim's OAuth flow, and their Savetrix
    // password, at another origin. Using only the checked value also drops any
    // smuggled port.
    url.hostname = host;
    url.port = "";
    return url;
  };

  const resourceUrlFor = (req: Request): URL => new URL("/mcp", baseUrlFor(req));

  const app = express();
  // One proxy hop (Vercel / most PaaS). Avoids the permissive-trust-proxy
  // error from the rate limiter that a bare `true` triggers.
  app.set("trust proxy", 1);

  // Alias-host discovery. Registered ahead of mcpAuthRouter so it wins for a
  // request on an allowlisted alias; on the canonical host these call next()
  // and the SDK router serves the documents byte-for-byte as before.
  const onAlias = (req: Request): boolean =>
    baseUrlFor(req).hostname !== issuerUrl.hostname;

  app.get("/.well-known/oauth-protected-resource/mcp", (req, res, next) => {
    if (!onAlias(req)) return next();
    const base = baseUrlFor(req);
    res.status(200).json({
      resource: new URL("/mcp", base).toString(),
      authorization_servers: [base.toString()],
      scopes_supported: ["mcp"],
      resource_name: "Savetrix",
    });
  });

  app.get("/.well-known/oauth-authorization-server", (req, res, next) => {
    if (!onAlias(req)) return next();
    const base = baseUrlFor(req).toString();
    res.status(200).json({
      issuer: base,
      authorization_endpoint: new URL("/authorize", base).toString(),
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint: new URL("/token", base).toString(),
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: ["mcp"],
      registration_endpoint: new URL("/register", base).toString(),
    });
  });

  // Standard OAuth endpoints: /authorize, /token, /register, and the
  // .well-known metadata documents clients use for discovery.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: resourceUrl,
      scopesSupported: ["mcp"],
      resourceName: "Savetrix",
    }),
  );

  // ── Login page (the /authorize step redirects here) ──
  const sendLoginPage = async (
    res: Response,
    status: number,
    reqToken: string,
    clientId: string,
    error?: string,
  ): Promise<void> => {
    const client = await provider.clientsStore.getClient(clientId);
    res
      .status(status)
      .type("html")
      .send(
        loginPage({
          reqToken,
          webUrl: config.webUrl,
          clientName: client?.client_name,
          googleClientId: config.googleClientId,
          error,
        }),
      );
  };

  /** Send the browser back to the OAuth client (Claude) with its code. */
  const redirectWithCode = (res: Response, loginReq: LoginRequest, code: string): void => {
    const redirect = new URL(loginReq.redirect_uri);
    redirect.searchParams.set("code", code);
    if (loginReq.state) redirect.searchParams.set("state", loginReq.state);
    res.redirect(redirect.toString());
  };

  app.get("/login", async (req: Request, res: Response) => {
    const token = String(req.query.req ?? "");
    if (!token) {
      res.status(400).send("Missing authorization request.");
      return;
    }
    let loginReq: LoginRequest;
    try {
      loginReq = await provider.readLoginRequest(token);
    } catch {
      res.status(400).send("This sign-in link has expired. Please start again.");
      return;
    }
    await sendLoginPage(res, 200, token, loginReq.client_id);
  });

  // "Continue with Google": the page posts the ID token Google Identity
  // Services gave it. Accounts created with Google often have no password,
  // so this is the only way they can connect.
  app.post(
    "/login/google",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const token = String(req.body.req ?? "");
      const credential = String(req.body.credential ?? "");
      let loginReq: LoginRequest;
      try {
        loginReq = await provider.readLoginRequest(token);
      } catch {
        res.status(400).send("This sign-in link has expired. Please start again.");
        return;
      }
      try {
        if (!credential) throw new Error("No Google credential was posted.");
        const code = await provider.issueAuthorizationCodeWithGoogle(loginReq, credential);
        redirectWithCode(res, loginReq, code);
      } catch (error) {
        // Status and backend message only; never the token itself.
        const status = isAxiosError(error) ? error.response?.status : undefined;
        const backendMessage = isAxiosError(error)
          ? (error.response?.data as { message?: string } | undefined)?.message
          : error instanceof Error
            ? error.message
            : String(error);
        console.error("[savetrix-mcp] /login/google error:", status ?? "", backendMessage);

        let userError: string;
        if (isAxiosError(error) && !error.response) {
          userError = "Could not reach Scantrix servers. Please check your connection and try again.";
        } else if (status && status >= 400 && status < 500) {
          userError =
            "Google sign-in didn't go through. Please try again, or sign in with your email and password.";
        } else {
          userError = "Sign-in failed. Please try again in a moment.";
        }
        await sendLoginPage(res, 401, token, loginReq.client_id, userError);
      }
    },
  );

  app.post(
    "/login",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const token = String(req.body.req ?? "");
      const email = String(req.body.email ?? "");
      const password = String(req.body.password ?? "");
      let loginReq;
      try {
        loginReq = await provider.readLoginRequest(token);
      } catch {
        res.status(400).send("This sign-in link has expired. Please start again.");
        return;
      }
      try {
        const code = await provider.issueAuthorizationCode(loginReq, email, password);
        redirectWithCode(res, loginReq, code);
      } catch (error) {
        // Structural only (no credentials) — helps distinguish real backend
        // failures from bad-password attempts when debugging via Vercel logs.
        console.error("[savetrix-mcp] /login POST error:", error instanceof Error ? error.message : error);
        const msg = error instanceof Error ? error.message : String(error);

        let userError: string;
        if (/credential|login|password|401|incorrect|invalid|unauthorized|wrong/i.test(msg)) {
          userError = "Incorrect email or password. Please try again.";
        } else if (/social|google|apple|microsoft|oauth|provider|no.*password|password.*not.*set/i.test(msg)) {
          userError =
            "This account uses social login. If it's Google, use Continue with Google above. For Apple or Microsoft, set a password at scantrix.ai/forgot-password, then try again.";
        } else if (/timeout|ETIMEDOUT|ECONNRESET|network|ENOTFOUND/i.test(msg)) {
          userError = "Could not reach Scantrix servers. Please check your connection and try again.";
        } else {
          userError = "Sign-in failed. Please try again. If this persists, reset your password at scantrix.ai.";
        }

        await sendLoginPage(res, 401, token, loginReq.client_id, userError);
      }
    },
  );

  // ── MCP endpoint (bearer-protected, one server per request = stateless) ──
  // Built per request so the 401's resource_metadata points at the host the
  // client actually called, matching the documents served above.
  const bearer = (req: Request, res: Response, next: NextFunction): void => {
    requireBearerAuth({
      verifier: provider,
      requiredScopes: ["mcp"],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrlFor(req)),
    })(req, res, next);
  };

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const extra = (req.auth?.extra ?? {}) as {
      st_at?: string;
      st_rt?: string;
      email?: string;
      user?: unknown;
    };
    const { st_at: accessToken, st_rt: refreshToken } = extra;
    if (!accessToken || !refreshToken) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const client = createClientForTokens(config, {
      accessToken,
      refreshToken,
      user: extra.user,
    });
    const server = new McpServer({ name: "savetrix-mcp-server", version: "1.0.0" });
    registerSavetrixTools(server, client, {
      // Claude reaches this server from Anthropic's cloud and can never read a
      // file off the user's device, so the only reliable transport for a local
      // file is a browser upload. Mint a ticket that carries this request's
      // already-verified Savetrix session — the link needs no second login.
      createUploadLink: async () => {
        // Snapshot whichever company this request resolved to (reflects an
        // explicit qbConnectionId override from THIS call, if any — see
        // applyQbOverride in tools/index.ts) so the eventual /upload POST,
        // which happens on a totally separate request/client instance later,
        // still lands in the right company instead of falling back to
        // resolveQbId()'s "whichever the backend flags active" default.
        const qbConnectionId = await client.resolveQbId();
        const ticket = await encryptToken(
          config.tokenSecret as string,
          "upload",
          {
            st_at: accessToken,
            st_rt: refreshToken,
            email: extra.email,
            user: extra.user,
            qbConnectionId,
          } satisfies UploadTicket,
          UPLOAD_TICKET_TTL,
        );
        // Keep the link on whichever host this session is connected to, so a
        // client still on an alias isn't bounced to a different origin.
        return new URL(
          `/upload?t=${encodeURIComponent(ticket)}`,
          baseUrlFor(req),
        ).toString();
      },
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", bearer, express.json(), handleMcp);
  // GET/DELETE are answered directly rather than handed to the transport. In
  // stateless mode a GET opens a keep-alive SSE stream that this server can
  // never write to (each request builds its own McpServer, so there are no
  // out-of-band notifications to deliver) — on a serverless host that just
  // pins a function invocation until it times out, billed the whole way. 405
  // is also what the current spec tells a session-less server to return.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "This MCP endpoint is stateless; use POST." },
      id: null,
    });
  };
  app.get("/mcp", bearer, methodNotAllowed);
  app.delete("/mcp", bearer, methodNotAllowed);

  // ── Browser invoice upload (ticketed; no OAuth round-trip) ──
  const readTicket = (raw: unknown): Promise<UploadTicket> =>
    decryptToken<UploadTicket>(config.tokenSecret as string, "upload", String(raw ?? ""));

  app.get("/upload", async (req: Request, res: Response) => {
    const raw = String(req.query.t ?? "");
    if (!raw) {
      res.status(400).send("Missing upload ticket.");
      return;
    }
    try {
      const ticket = await readTicket(raw);
      res.status(200).type("html").send(
        uploadPage({
          ticket: raw,
          webUrl: config.webUrl,
          maxBytes: maxBrowserUploadBytes(),
          email: ticket.email,
        }),
      );
    } catch {
      res
        .status(400)
        .send("This upload link has expired. Ask Claude for a new upload link.");
    }
  });

  // The page sends the file as the raw request body (not multipart) so no
  // multipart parser dependency is needed here.
  app.post(
    "/upload",
    express.raw({ type: "*/*", limit: maxBrowserUploadBytes() }),
    async (req: Request, res: Response) => {
      let ticket: UploadTicket;
      try {
        ticket = await readTicket(req.query.t);
      } catch {
        res.status(401).json({ message: "This upload link has expired. Ask Claude for a new one." });
        return;
      }
      // Normally express.raw() leaves a Buffer here. Some platforms (Vercel
      // among them) may pre-read the request body before the Express app sees
      // it, in which case req.body arrives already decoded — accept that too
      // rather than reporting an empty upload.
      let bytes: Buffer;
      if (Buffer.isBuffer(req.body)) {
        bytes = req.body;
      } else if (typeof req.body === "string") {
        bytes = Buffer.from(req.body, "binary");
      } else {
        bytes = Buffer.alloc(0);
      }
      if (bytes.length === 0) {
        res.status(400).json({ message: "No file data received." });
        return;
      }
      let fileName = "invoice.pdf";
      const headerName = req.get("x-file-name");
      if (headerName) {
        try {
          fileName = decodeURIComponent(headerName);
        } catch {
          fileName = headerName;
        }
      }
      // Never let a client-supplied name escape into a path.
      fileName = fileName.replace(/[/\\]/g, "_").slice(0, 200) || "invoice.pdf";
      const contentType = (req.get("content-type") ?? "").split(";")[0].trim();
      try {
        const client = createClientForTokens(config, {
          accessToken: ticket.st_at,
          refreshToken: ticket.st_rt,
          user: ticket.user,
        });
        // Restore the company that was active when the link was minted,
        // rather than letting resolveQbId() re-derive a possibly different
        // one on this separate request — see createUploadLink above.
        if (ticket.qbConnectionId) client.setActiveQbId(ticket.qbConnectionId);
        const result = await uploadInvoiceBytes(client, {
          bytes,
          fileName,
          mimeType: contentType || "application/octet-stream",
        });
        res.status(200).json({ ok: true, result });
      } catch (error) {
        console.error(
          "[savetrix-mcp] /upload error:",
          error instanceof Error ? error.message : error,
        );
        const status = (error as { response?: { status?: number } })?.response?.status;
        res.status(status === 401 ? 401 : 502).json({
          message:
            status === 401
              ? "Your Scantrix session expired. Ask Claude for a new upload link."
              : "Scantrix could not accept that file. Please try again.",
        });
      }
    },
  );

  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return app;
};

export const startRemote = (config: Config): void => {
  const app = createRemoteApp(config);
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.error(
      `Savetrix MCP connector (remote/OAuth) listening on :${config.port} — public URL ${config.publicUrl}`,
    );
  });
};
