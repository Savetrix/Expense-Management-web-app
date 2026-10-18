// Ported from Scantrix_v2 src/services/api.ts (branch frontend-ui-v2).
// AsyncStorage -> localStorage. Every browser storage call is guarded
// individually since Next.js App Router can execute this module server-side.
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { sessionEmitter, SESSION_EXPIRED, TOKEN_REFRESHED } from "./sessionManager";
import { getQbConnectionId } from "./qbConnection";
import { isExpiringSoon, isTokenExpiredResponse, jwtIssuedAt, skipsProactiveRefresh } from "./tokenExpiry";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.savetrix.com/api";

const readLocalStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
};

const writeLocalStorage = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

const removeLocalStorageKeys = (keys: string[]): void => {
  if (typeof window === "undefined") return;
  keys.forEach((key) => window.localStorage.removeItem(key));
};

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

// The stored "user" object also carries the tokens (user.data.accessToken),
// and it's what the in-memory auth state is restored from — fetch-based
// callers (chat, email forwarding) read the token from there, not from the
// bare "accessToken" key, so it has to follow every refresh too.
const syncStoredUserTokens = (accessToken: string, refreshToken?: string): void => {
  const raw = readLocalStorage("user");
  if (!raw) return;
  try {
    const user = JSON.parse(raw);
    if (!user?.data) return;
    user.data.accessToken = accessToken;
    if (refreshToken) user.data.refreshToken = refreshToken;
    writeLocalStorage("user", JSON.stringify(user));
  } catch {
    // Unparseable stored user — the bare token keys above still carry the session.
  }
};

// How far this device's clock runs ahead of the server's, measured from the
// iat of each token the refresh hands back (a few ms of network latency
// included, which is harmless). Shared across tabs via localStorage — see
// isExpiringSoon for why it matters.
const CLOCK_SKEW_KEY = "clockSkewMs";
const readClockSkew = (): number => Number(readLocalStorage(CLOCK_SKEW_KEY)) || 0;
const recordClockSkew = (accessToken: string): void => {
  const issuedAt = jwtIssuedAt(accessToken);
  if (issuedAt !== null) writeLocalStorage(CLOCK_SKEW_KEY, String(Date.now() - issuedAt));
};

// Single-flight: a page mount fires several requests at once, and when the
// token has expired every one of them 401s together. Each starting its own
// refresh made the 2nd..Nth present a refresh token the 1st had already
// rotated away, which failed and signed the user out.
let refreshInFlight: Promise<string> | null = null;

// The same race across TABS: they share localStorage (so one refresh token)
// but not this module, so two tabs whose tokens expired together — a laptop
// waking from sleep — both refresh with it. One rotates it; the other's
// refresh is refused and used to clear storage, signing out BOTH tabs. So a
// refresh runs under a browser-wide Web Lock, and on getting the lock first
// checks whether another tab already replaced the token it set out to
// replace. Without Web Locks (old browsers), a refused refresh is still
// forgiven when the stored token changed under it.
const REFRESH_LOCK = "scantrix-token-refresh";
const REFRESH_TIMEOUT_MS = 15_000;

const takeTokenRefreshedElsewhere = (startedWith: string | null): string | null => {
  const current = readLocalStorage("accessToken");
  if (!current || current === startedWith) return null;
  sessionEmitter.emit(TOKEN_REFRESHED, { accessToken: current, refreshToken: readLocalStorage("refreshToken") ?? undefined });
  return current;
};

const refreshAcrossTabs = async (): Promise<string> => {
  const startedWith = readLocalStorage("accessToken");
  const run = async () => {
    const refreshedElsewhere = takeTokenRefreshedElsewhere(startedWith);
    if (refreshedElsewhere) return refreshedElsewhere;
    try {
      return await refreshNow();
    } catch (error) {
      const raced = takeTokenRefreshedElsewhere(startedWith);
      if (raced) return raced;
      throw error;
    }
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(REFRESH_LOCK, run) : run();
};

export const refreshAccessToken = (): Promise<string> => {
  if (!refreshInFlight) {
    refreshInFlight = refreshAcrossTabs().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

const refreshNow = async (): Promise<string> => {
  const refreshToken = readLocalStorage("refreshToken");
  if (!refreshToken) throw new Error("no refresh token");

  // `/auth/refresh`, NOT `/auth/refresh-token`. The latter returns
  // 404 "Route not found" on the live API — verified directly — which
  // meant this whole branch could only ever throw, so every expired
  // access token fell through to the catch below and signed the user out
  // instead of silently refreshing.
  //
  // Bounded: this runs under the cross-tab Web Lock, so a refresh hanging on a
  // dead connection would otherwise hold every tab's requests forever (bare
  // axios has no timeout by default).
  const response = await axios.post(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
    { timeout: REFRESH_TIMEOUT_MS },
  );

  // The API wraps payloads as {success, message, data}, but this endpoint
  // was previously read as a bare {accessToken}. Probe both rather than
  // betting on one — an undefined token here would be written to storage
  // and break every subsequent request.
  const newAccessToken: string | undefined =
    response.data?.data?.accessToken ?? response.data?.accessToken;

  if (!newAccessToken) {
    throw new Error("refresh returned no access token");
  }

  writeLocalStorage("accessToken", newAccessToken);
  recordClockSkew(newAccessToken);

  // If the backend ROTATES refresh tokens, the one we just spent is now
  // dead and this response carries its replacement. Failing to store it
  // means the next refresh presents a spent token, gets a 401, and signs
  // the user out — the session then survives exactly one refresh. Proven
  // against the live API: an inbound-email delegation died this way after
  // a single use.
  const rotatedRefreshToken: string | undefined =
    response.data?.data?.refreshToken ?? response.data?.refreshToken;
  const changedRefreshToken =
    rotatedRefreshToken && rotatedRefreshToken !== refreshToken ? rotatedRefreshToken : undefined;
  if (changedRefreshToken) {
    writeLocalStorage("refreshToken", changedRefreshToken);
  }

  syncStoredUserTokens(newAccessToken, changedRefreshToken);
  sessionEmitter.emit(TOKEN_REFRESHED, { accessToken: newAccessToken, refreshToken: changedRefreshToken });

  return newAccessToken;
};

// The stored access token — refreshed first when it's about to expire, so
// the request it goes on never 401s just for having aged out (which, for a
// write, used to mean a failed action the user had to repeat). A failed
// refresh here isn't final: the stale token is sent and the server's answer
// decides (the 401 path below then signs the user out if the refresh token
// is really dead). Also used by fetch-based callers (authFetch.ts).
export const getFreshAccessToken = async (): Promise<string | null> => {
  const token = readLocalStorage("accessToken");
  if (!token || !isExpiringSoon(token, Date.now(), readClockSkew()) || !readLocalStorage("refreshToken")) return token;
  try {
    return await refreshAccessToken();
  } catch {
    return token;
  }
};

// ==============================
// REQUEST INTERCEPTOR
// ==============================

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = skipsProactiveRefresh(config.url) ? readLocalStorage("accessToken") : await getFreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Every QB-scoped endpoint (invoices, vendors, accounts, status, etc.)
      // requires X-QB-Id. Attach it here so individual API calls don't each
      // need to remember to pass it. Read via qbConnection.ts rather than
      // importing the store directly — see that file for why.
      if (!config.headers["X-QB-Id"]) {
        const qbConnectionId = getQbConnectionId();
        if (qbConnectionId) {
          config.headers["X-QB-Id"] = qbConnectionId;
        }
      }

      console.log("========== API REQUEST ==========");
      console.log(`${config.method?.toUpperCase()} ${BASE_URL}${config.url}`);
    } catch (error) {
      console.log("Error getting access token:", error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ==============================
// RESPONSE INTERCEPTOR
// ==============================

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError | any) => {
    const originalRequest = error.config;

    console.log("========== API RESPONSE ERROR ==========");
    console.log(error);
    console.log(JSON.stringify(error?.response?.data, null, 2));

    // ==============================
    // ACCESS TOKEN EXPIRED
    // ==============================

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // A write that 401s is re-sent only when the backend marked the 401
      // TOKEN_EXPIRED: that one comes from its auth middleware, before any
      // handler ran, so the write was never processed and re-sending can't
      // duplicate anything (two bills in QuickBooks from one scan). Any other
      // 401 on a write is not re-sent. Every 401 still goes through the
      // refresh below, though: bailing out before it left the access token
      // expired and never emitted SESSION_EXPIRED, so every subsequent write
      // failed with a generic error and the user was never told to sign in
      // again.
      const method = (originalRequest.method || "get").toLowerCase();
      const isIdempotent = method === "get" || method === "head";
      const canResend = isIdempotent || isTokenExpiredResponse(error.response?.status, error.response?.data);

      // No refresh token means nobody is signed in (e.g. a wrong-password
      // 401 from the login endpoint) — surface the original error as-is.
      if (!readLocalStorage("refreshToken")) {
        return Promise.reject(error);
      }

      try {
        // A request sent before a concurrent refresh finished carries the old
        // token — just retry it with the current one instead of refreshing
        // again.
        const sentAuth: string | undefined = originalRequest.headers?.Authorization;
        const currentToken = readLocalStorage("accessToken");
        const newAccessToken =
          currentToken && sentAuth && sentAuth !== `Bearer ${currentToken}`
            ? currentToken
            : await refreshAccessToken();

        // Session is healthy again — but for a write the backend may have
        // processed, surface the original error and let the caller decide.
        if (!canResend) {
          return Promise.reject(error);
        }

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

        return api(originalRequest);
      } catch (refreshError) {
        console.log("Refresh token failed:", refreshError);

        removeLocalStorageKeys(["accessToken", "refreshToken", "user"]);

        sessionEmitter.emit(SESSION_EXPIRED);

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
