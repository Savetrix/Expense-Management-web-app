import axios from "axios";
import { SessionStore, MemorySessionStore } from "../session.js";
// Read by both people (stdio users run savetrix_login) and Claude (remote
// users reconnect the connector).
const SESSION_EXPIRED = "Your Scantrix session has expired. Reconnect the Scantrix connector in Claude, or run the savetrix_login tool.";
export class SavetrixClient {
    api;
    session;
    baseURL;
    webUrl;
    accessToken;
    refreshToken;
    qbOverride;
    activeQbId;
    resolvingQb = false;
    refreshing;
    constructor(opts) {
        this.baseURL = opts.baseURL;
        this.webUrl = (opts.webUrl ?? "https://scantrix.ai").replace(/\/$/, "");
        this.session = opts.session;
        this.qbOverride = opts.qbOverride;
        const initial = opts.session.load();
        this.accessToken = initial.accessToken;
        this.refreshToken = initial.refreshToken;
        this.api = opts.axiosInstance ?? axios.create({ baseURL: this.baseURL, timeout: 30000 });
        this.api.interceptors.request.use(async (config) => {
            if (this.accessToken) {
                config.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            // Auth calls are company-independent, and resolving a company here with
            // an expired token would 401 and re-enter the refresh below.
            if (!config.headers["X-QB-Id"] && !String(config.url ?? "").startsWith("/auth/")) {
                const qbId = await this.resolveQbId();
                if (qbId)
                    config.headers["X-QB-Id"] = qbId;
            }
            return config;
        });
        this.api.interceptors.response.use((response) => response, async (error) => {
            const original = error.config;
            if (error.response?.status === 401 && original && !original._retry) {
                original._retry = true;
                try {
                    const { accessToken } = await this.refreshSession();
                    original.headers.Authorization = `Bearer ${accessToken}`;
                    return this.api(original);
                }
                catch (refreshError) {
                    if (refreshError instanceof Error && /login/i.test(refreshError.message)) {
                        return Promise.reject(refreshError);
                    }
                    return Promise.reject(new Error(SESSION_EXPIRED));
                }
            }
            return Promise.reject(error);
        });
    }
    /**
     * Trade the refresh token for a new pair via POST /auth/refresh. Savetrix
     * ROTATES the refresh token on every call, so the new one is kept and the
     * old one is dead; and a refresh already in flight is shared rather than
     * repeated, or two concurrent 401s would spend the same token twice and the
     * second would fail. (This used /auth/refresh-token, a route that doesn't
     * exist, so every session ended when its access token expired.)
     */
    async refreshSession() {
        if (!this.refreshToken) {
            throw new Error("Not logged in. Run the savetrix_login tool or set SAVETRIX_EMAIL/SAVETRIX_PASSWORD.");
        }
        this.refreshing ??= (async () => {
            try {
                // _retry: a 401 from the refresh call itself must not recurse here.
                const { data } = await this.api.post("/auth/refresh", { refreshToken: this.refreshToken }, { _retry: true });
                const body = data?.data ?? data;
                const accessToken = body?.accessToken;
                const refreshToken = body?.refreshToken ?? this.refreshToken;
                if (!accessToken)
                    throw new Error(SESSION_EXPIRED);
                this.setTokens(accessToken, refreshToken);
                await this.session.save({ accessToken, refreshToken });
                return { accessToken, refreshToken };
            }
            finally {
                this.refreshing = undefined;
            }
        })();
        return this.refreshing;
    }
    setTokens(accessToken, refreshToken) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
    }
    getAccessToken() {
        return this.accessToken;
    }
    getRefreshToken() {
        return this.refreshToken;
    }
    setActiveQbId(id) {
        this.activeQbId = id;
    }
    getActiveQbId() {
        return this.activeQbId ?? this.qbOverride;
    }
    async resolveQbId() {
        if (this.activeQbId)
            return this.activeQbId;
        if (this.qbOverride)
            return this.qbOverride;
        if (!this.accessToken)
            return undefined;
        // Prevent re-entrancy: the /qb-connections request below re-runs the
        // request interceptor, which would call resolveQbId again and recurse.
        if (this.resolvingQb)
            return undefined;
        this.resolvingQb = true;
        try {
            const res = await this.api.get("/qb-connections");
            const connections = res.data?.data?.connections;
            const list = Array.isArray(connections) ? connections : [];
            // Accounts can carry multiple QB connections (e.g. reconnected several
            // times); only one has status "active" at a time. Fall back to the
            // first entry only if none is marked active, so behavior degrades
            // gracefully instead of breaking on an unexpected response shape.
            const chosen = list.find((c) => c?.status === "active") ?? list[0];
            if (chosen?._id) {
                this.activeQbId = chosen._id;
                return this.activeQbId;
            }
        }
        catch {
            // no connection yet — QB-scoped calls will fail with a clear backend error
        }
        finally {
            this.resolvingQb = false;
        }
        return undefined;
    }
    async login(email, password) {
        const res = await this.api.post("/auth/login", { email, password });
        return this.adoptLogin(res.data, email);
    }
    /**
     * Sign in with a Google ID token (from Google Identity Services), the same
     * call the website's "Continue with Google" makes. Savetrix verifies the
     * token and answers with the same payload as /auth/login.
     */
    async loginWithGoogle(idToken) {
        // _retry: a 401 here means Google's token was rejected, not that a session
        // expired, so the refresh interceptor must not turn it into "Not logged in".
        const res = await this.api.post("/auth/google", { idToken }, { _retry: true });
        const payload = res.data;
        const email = payload?.data?.user?.email;
        return this.adoptLogin(payload, email);
    }
    async adoptLogin(payload, email) {
        const d = payload?.data;
        if (!d?.accessToken || !d?.refreshToken) {
            throw new Error("Login response missing accessToken/refreshToken.");
        }
        this.setTokens(d.accessToken, d.refreshToken);
        await this.session.save({
            accessToken: d.accessToken,
            refreshToken: d.refreshToken,
            user: payload,
            email,
        });
        return payload;
    }
    async logout() {
        try {
            if (this.refreshToken) {
                await this.api.post("/auth/logout", { refreshToken: this.refreshToken });
            }
        }
        finally {
            this.accessToken = undefined;
            this.refreshToken = undefined;
            this.activeQbId = undefined;
            await this.session.clear();
        }
    }
}
export const createClient = (config) => new SavetrixClient({
    baseURL: config.apiUrl,
    webUrl: config.webUrl,
    session: new SessionStore(config.configFilePath),
    qbOverride: config.qbConnectionId,
});
/**
 * Build a client for a one-off login that must not touch disk (e.g. the
 * remote/OAuth /login handler, which runs on serverless with a read-only
 * filesystem outside /tmp). The returned tokens are captured by the caller
 * directly; nothing needs to be persisted here.
 */
export const createClientForLogin = (config) => new SavetrixClient({
    baseURL: config.apiUrl,
    webUrl: config.webUrl,
    session: new MemorySessionStore(),
    qbOverride: config.qbConnectionId,
});
/**
 * Build a client for a single remote request, seeded with the Savetrix tokens
 * carried inside the caller's verified OAuth access token. Uses an in-memory
 * session so nothing touches disk (safe for serverless / multi-user).
 */
export const createClientForTokens = (config, tokens) => {
    const client = new SavetrixClient({
        baseURL: config.apiUrl,
        webUrl: config.webUrl,
        session: new MemorySessionStore(tokens),
        qbOverride: config.qbConnectionId,
    });
    client.setTokens(tokens.accessToken, tokens.refreshToken);
    return client;
};
