import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Config } from "../config.js";
import { createClientForLogin, createClientForTokens } from "../client/savetrixClient.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { decodeJwt } from "jose";
import { encryptToken, decryptToken } from "./tokens.js";

const CLIENT_TTL = 60 * 60 * 24 * 365; // 1 year
const CODE_TTL = 60 * 5; // 5 minutes
const LOGIN_REQ_TTL = 60 * 15; // 15 minutes
const ACCESS_TTL = 60 * 60 * 8; // 8 hours
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 days
const RENEW_SAVETRIX_WITHIN = 60 * 60 * 24; // renew the Savetrix pair with < 1 day left

/** `exp` of a Savetrix access token (a JWT), read without verifying it. */
const savetrixTokenExpiry = (token: string | undefined): number | undefined => {
  if (!token) return undefined;
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === "number" ? exp : undefined;
  } catch {
    return undefined;
  }
};

/** The Savetrix session we wrap inside every OAuth artifact. */
export interface SavetrixSession {
  st_at: string; // Savetrix access token
  st_rt: string; // Savetrix refresh token
  userId?: string;
  email?: string;
  user?: unknown; // full raw /auth/login response payload, for savetrix_account_info
}

interface CodePayload extends SavetrixSession {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource?: string;
}

interface AccessPayload extends SavetrixSession {
  client_id: string;
  resource?: string;
}

export interface LoginRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scopes?: string[];
  resource?: string;
}

/**
 * OAuth 2.1 authorization server for the Savetrix connector. Savetrix itself is
 * not an OAuth provider (email/password + JWT), so this provider hosts a login
 * page: /authorize redirects to /login, the user signs in with Savetrix
 * credentials, and we mint our own encrypted tokens that wrap that session.
 */
export class SavetrixOAuthProvider implements OAuthServerProvider {
  constructor(private readonly config: Config) {
    if (!config.tokenSecret || config.tokenSecret.length < 32) {
      throw new Error(
        "SAVETRIX_TOKEN_SECRET must be set to a random string of at least 32 characters for the remote connector.",
      );
    }
  }

  private get secret(): string {
    return this.config.tokenSecret as string;
  }

  private get loginUrl(): string {
    return `${this.config.publicUrl ?? ""}/login`;
  }

  // ── Dynamic client registration (stateless: client_id IS the record) ──
  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      registerClient: async (client) => {
        const clientId = await encryptToken(
          this.secret,
          "client",
          { client },
          CLIENT_TTL,
        );
        return {
          ...client,
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
      },
      getClient: async (clientId) => {
        try {
          const { client } = await decryptToken<{
            client: Omit<OAuthClientInformationFull, "client_id">;
          }>(this.secret, "client", clientId);
          return { ...client, client_id: clientId };
        } catch {
          return undefined;
        }
      },
    };
  }

  // ── Authorization: hand off to our own login page ──
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req: LoginRequest = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      resource: params.resource?.href,
    };
    const token = await encryptToken(this.secret, "login_req", { req }, LOGIN_REQ_TTL);
    const url = new URL(this.loginUrl);
    url.searchParams.set("req", token);
    res.redirect(url.toString());
  }

  // ── /login helpers (called by the custom login routes) ──
  async readLoginRequest(token: string): Promise<LoginRequest> {
    const { req } = await decryptToken<{ req: LoginRequest }>(
      this.secret,
      "login_req",
      token,
    );
    return req;
  }

  /** Validate Savetrix credentials, then return an authorization code. */
  async issueAuthorizationCode(
    req: LoginRequest,
    email: string,
    password: string,
  ): Promise<string> {
    const client = createClientForLogin(this.config);
    const payload = await client.login(email, password);
    return this.codeForLogin(req, payload, email);
  }

  /**
   * Same as issueAuthorizationCode, for an account that signs in with Google
   * (and may have no password at all): Savetrix verifies the Google ID token.
   */
  async issueAuthorizationCodeWithGoogle(req: LoginRequest, idToken: string): Promise<string> {
    const client = createClientForLogin(this.config);
    const payload = await client.loginWithGoogle(idToken);
    return this.codeForLogin(req, payload);
  }

  private async codeForLogin(
    req: LoginRequest,
    payload: unknown,
    fallbackEmail?: string,
  ): Promise<string> {
    const data = (payload as any)?.data ?? {};
    const session: SavetrixSession = {
      st_at: data.accessToken,
      st_rt: data.refreshToken,
      userId: data.user?._id,
      email: data.user?.email ?? fallbackEmail,
      user: payload,
    };
    const code: CodePayload = {
      ...session,
      client_id: req.client_id,
      redirect_uri: req.redirect_uri,
      code_challenge: req.code_challenge,
      resource: req.resource,
    };
    return encryptToken(this.secret, "code", { code }, CODE_TTL);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const { code } = await decryptToken<{ code: CodePayload }>(
      this.secret,
      "code",
      authorizationCode,
    );
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const { code } = await decryptToken<{ code: CodePayload }>(
      this.secret,
      "code",
      authorizationCode,
    );
    if (code.client_id !== client.client_id) {
      throw new Error("Authorization code was issued to a different client.");
    }
    return this.mintTokens({
      st_at: code.st_at,
      st_rt: code.st_rt,
      userId: code.userId,
      email: code.email,
      user: code.user,
      client_id: client.client_id,
      resource: code.resource,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const { session } = await decryptToken<{ session: AccessPayload }>(
      this.secret,
      "refresh",
      refreshToken,
    );
    if (session.client_id !== client.client_id) {
      throw new Error("Refresh token was issued to a different client.");
    }
    return this.mintTokens(await this.renewSavetrixSession(session));
  }

  /**
   * Our tokens carry the Savetrix session inside them, and nothing else stores
   * it. A Savetrix access token lasts 7 days while this refresh token lasts
   * 30, so without renewal every connection stopped working after a week.
   * When Claude refreshes, renew the Savetrix pair if it has less than a day
   * left. Not more often: Savetrix rotates refresh tokens and keeps one live
   * session per account, so needless refreshes only add chances to fail.
   */
  private async renewSavetrixSession(session: AccessPayload): Promise<AccessPayload> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = savetrixTokenExpiry(session.st_at);
    if (expiresAt !== undefined && expiresAt - now > RENEW_SAVETRIX_WITHIN) return session;
    try {
      const client = createClientForTokens(this.config, {
        accessToken: session.st_at,
        refreshToken: session.st_rt,
      });
      const fresh = await client.refreshSession();
      return { ...session, st_at: fresh.accessToken, st_rt: fresh.refreshToken };
    } catch {
      // Still usable: keep it and try again at the next refresh.
      if (expiresAt !== undefined && expiresAt > now) return session;
      // Gone for good (e.g. revoked, or the account signed in elsewhere):
      // invalid_grant makes Claude ask the person to sign in again.
      throw new InvalidGrantError("Your Scantrix session has ended. Please sign in again.");
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // jose throws its own error types (JWTExpired, JWEDecryptionFailed, ...).
    // The SDK's requireBearerAuth only maps InvalidTokenError to a 401 with a
    // WWW-Authenticate challenge; anything else becomes a bare 500. Since the
    // access TTL is 8 hours, letting those escape meant every connected client
    // got an opaque server error twice a day instead of the 401 that tells it
    // to refresh — the connector simply stopped working until re-added by hand.
    let decoded: { session: AccessPayload; exp: number };
    try {
      decoded = await decryptToken<{
        session: AccessPayload;
        exp: number;
      }>(this.secret, "access", token);
    } catch (error) {
      throw new InvalidTokenError(
        error instanceof Error && /exp/i.test(error.message)
          ? "Access token has expired"
          : "Access token is invalid",
      );
    }
    const { session, exp } = decoded;
    return {
      token,
      clientId: session.client_id,
      scopes: ["mcp"],
      expiresAt: exp,
      resource: session.resource ? new URL(session.resource) : undefined,
      extra: {
        st_at: session.st_at,
        st_rt: session.st_rt,
        userId: session.userId,
        email: session.email,
        user: session.user,
      },
    };
  }

  private async mintTokens(session: AccessPayload): Promise<OAuthTokens> {
    const access_token = await encryptToken(
      this.secret,
      "access",
      { session },
      ACCESS_TTL,
    );
    const refresh_token = await encryptToken(
      this.secret,
      "refresh",
      { session },
      REFRESH_TTL,
    );
    return {
      access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      refresh_token,
      scope: "mcp",
    };
  }
}
