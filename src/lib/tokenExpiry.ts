// The pure half of the access-token refresh policy used by api.ts and
// authFetch.ts — kept free of storage/axios so it can be unit-tested.

// Refresh this long before the token's exp, so a request never leaves with a
// token that dies in flight — and a little client/server clock skew is
// covered too.
export const REFRESH_AHEAD_MS = 60_000;

// A numeric JWT claim (seconds) as ms. null when the token isn't a readable
// JWT (the server is then left to decide — never block a request on parsing).
const jwtTimeClaim = (token: string | null | undefined, claim: "exp" | "iat"): number | null => {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("utf8");
    const value = JSON.parse(json)?.[claim];
    return typeof value === "number" ? value * 1000 : null;
  } catch {
    return null;
  }
};

export const jwtExpiresAt = (token: string | null | undefined): number | null => jwtTimeClaim(token, "exp");
export const jwtIssuedAt = (token: string | null | undefined): number | null => jwtTimeClaim(token, "iat");

// exp is server time; Date.now() is this device's clock. skewMs is how far
// the device runs ahead of the server (measured when a token arrives, see
// api.ts) — without it a clock a whole token-lifetime fast makes every token
// look expired and every request refresh first.
export const isExpiringSoon = (token: string | null | undefined, now: number = Date.now(), skewMs: number = 0): boolean => {
  const expiresAt = jwtExpiresAt(token);
  return expiresAt !== null && expiresAt - (now - skewMs) < REFRESH_AHEAD_MS;
};

// The backend marks the 401 its auth middleware raises for an expired token
// with data.code TOKEN_EXPIRED. That one is raised before any handler runs,
// so the request was not processed and re-sending it — even a write — can't
// duplicate anything. Any other 401 (bad credentials, a wrong current
// password, ...) is the request's real answer.
export const isTokenExpiredResponse = (status: number | undefined, body: unknown): boolean =>
  status === 401 && (body as { data?: { code?: unknown } } | null)?.data?.code === "TOKEN_EXPIRED";

// /auth/* endpoints carry their own credentials (login, register, OTPs) or a
// refresh token in the body (refresh, logout). Refreshing ahead of those
// would rotate the refresh token a logout is about to present — the logout
// would then match nothing and leave the new session alive.
export const skipsProactiveRefresh = (url: string | undefined): boolean => !!url && /^\/?auth\//.test(url);
