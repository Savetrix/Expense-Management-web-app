// SERVER-ONLY. Who is asking to manage a receiving address — and what their
// account email is.
//
// Same two-step discipline as src/lib/chatHistory/identity.ts, and for the same
// reason: the Savetrix backend owns identity and this repo holds no signing
// secret for its tokens, so we cannot verify a signature locally.
//
//   1. VOUCHING — call a backend endpoint that 401s on a bad token. A forged or
//      expired token cannot survive this, because we are not the ones judging it.
//   2. SUBJECT  — only then read the user id, and the email, out of the vouched
//      token's payload or the profile response.
//
// Decoding a JWT payload without checking its signature is safe ONLY because of
// step 1. Never reorder them.
//
// ABOUT THE EMAIL. The alias's `ownerEmail` is the sender allow-list, so we
// prefer to learn it from the backend rather than from the browser, and we try
// three server-side sources in order: /users/me, the token's own claims, and
// /users/{id}.
//
// But a null result is NOT fatal, and an earlier version of this file was wrong
// to make it so. This backend has no /users/me (the ported client only ever
// calls PATCH /users/:id) and its tokens carry no email claim, so EVERY alias
// creation failed with "we couldn't read your account email".
//
// The strictness was also inconsistent with the rest of the feature: the owner
// can already add arbitrary `additionalSenders` through the settings panel, so
// letting them state their own address is the same power they already have. It
// is not a privilege escalation — an owner who nominates an address they do not
// control has only widened access to their OWN books. The boundaries that
// actually matter are all still enforced server-side and unchanged:
//   * who the caller is (vouched by the backend, never from the request body),
//   * that they own the QuickBooks company (connections.ts),
//   * that the delegated refresh token is genuinely theirs (the create route).
// So the route accepts a client-supplied address only as a LAST resort, and
// records whether it was server-verified.
import { createHash } from "node:crypto";

import { SAVETRIX_API_BASE_URL } from "./config";

const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Verified identities are cached briefly, keyed by a hash of the token — the
 * same device chatHistory/identity.ts uses, and for a sharper reason here: the
 * invoice list calls /api/inbound/sources on every mount to decide which rows
 * get an "Email" badge. Without this, every visit to the invoice list would cost
 * an upstream round trip for every user, whether or not they use forwarding.
 *
 * Short by design: it must not outlive a logout or a token revocation by long.
 * Per-instance and in-memory, exactly like the rate-limit map in
 * src/app/api/chat/route.ts.
 */
const IDENTITY_CACHE_TTL_MS = 60_000;
const IDENTITY_CACHE_MAX_ENTRIES = 500;

export type InboundIdentity =
  /**
   * `email` is null when the backend would not tell us. That is NOT fatal — see
   * ABOUT THE EMAIL above. The caller decides what to do about it.
   */
  | { kind: "authenticated"; userId: string; email: string | null }
  | { kind: "unauthenticated" }
  /** Fail closed: never fall back to a guessed id. */
  | { kind: "unavailable"; reason: string };

function pickString(source: unknown, keys: readonly string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Probe the shapes the API is known to use: {data:{user}}, {data}, or the root. */
function candidateRecords(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const nested = data?.user as Record<string, unknown> | undefined;
  return [nested, data, root].filter(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) && typeof candidate === "object",
  );
}

/**
 * `sub` is in this list because a JWT names its subject there by convention,
 * while a REST profile body names it `_id`/`id`. Both shapes pass through here,
 * and leaving `sub` out silently broke the JWT case: a perfectly good
 * `{sub, email}` token matched the id-and-email pair below on neither key, so
 * the email came back null and alias creation failed with "no-email" on any
 * deployment where `/users/me` does not exist.
 */
const ID_KEYS = ["_id", "id", "userId", "uid", "sub"] as const;

function readIdAndEmail(payload: unknown): { userId: string | null; email: string | null } {
  for (const record of candidateRecords(payload)) {
    const email = pickString(record, ["email"]);
    const userId = pickString(record, ID_KEYS);
    // Require the pair together. An unexpected 200 (a catch-all handler, a
    // collection response) must not contribute an id from one shape and an
    // email from another.
    if (email && userId) return { userId, email };
  }
  for (const record of candidateRecords(payload)) {
    const userId = pickString(record, ID_KEYS);
    if (userId) return { userId, email: null };
  }
  return { userId: null, email: null };
}

/** JWT payload WITHOUT signature verification — safe only post-vouching. */
function decodeJwtPayload(accessToken: string): unknown {
  const segments = accessToken.split(".");
  if (segments.length !== 3) return null;
  try {
    const json = Buffer.from(
      segments[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function callUpstream(path: string, accessToken: string): Promise<Response | null> {
  try {
    return await fetch(`${SAVETRIX_API_BASE_URL}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Network error / timeout. Structural only — never log the token.
    return null;
  }
}

/**
 * `/users/me` is the ideal answer: it vouches for the token AND names the user
 * with their email in one call. It is not in this repo's ported client, so we
 * cannot assume it exists — module-scoped so one 404/405 stops us paying for the
 * probe on this instance.
 */
let profileEndpointUsable = true;

const identityCache = new Map<string, { expiresAt: number; outcome: InboundIdentity }>();

const tokenKey = (accessToken: string): string =>
  createHash("sha256").update(accessToken).digest("hex");

function readCache(key: string): InboundIdentity | null {
  const hit = identityCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    identityCache.delete(key);
    return null;
  }
  return hit.outcome;
}

function writeCache(key: string, outcome: InboundIdentity): void {
  // Never cache "unavailable" — it is a transient upstream condition, and
  // caching it would keep the feature down after upstream recovers.
  if (outcome.kind === "unavailable") return;
  if (identityCache.size >= IDENTITY_CACHE_MAX_ENTRIES) {
    // Coarse eviction: drop the oldest insertion. Map preserves insertion
    // order, and this map only ever holds short-lived entries.
    const oldest = identityCache.keys().next();
    if (!oldest.done) identityCache.delete(oldest.value);
  }
  identityCache.set(key, { expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS, outcome });
}

/**
 * Test-only. Drops the identity cache AND re-arms the `/users/me` probe, both of
 * which are module-scoped on purpose and would otherwise leak between cases.
 */
export function __resetInboundIdentityForTests(): void {
  profileEndpointUsable = true;
  identityCache.clear();
}

export async function resolveInboundIdentity(accessToken: string): Promise<InboundIdentity> {
  const key = tokenKey(accessToken);
  const cached = readCache(key);
  if (cached) return cached;

  const outcome = await resolveUncached(accessToken);
  writeCache(key, outcome);
  return outcome;
}

async function resolveUncached(accessToken: string): Promise<InboundIdentity> {
  let vouched = false;
  let reportedUserId: string | null = null;
  let reportedEmail: string | null = null;

  // ── Step 1: vouching ─────────────────────────────────────────────────────
  if (profileEndpointUsable) {
    const response = await callUpstream("/users/me", accessToken);
    if (response) {
      if (response.status === 401 || response.status === 403) return { kind: "unauthenticated" };
      if (response.ok) {
        vouched = true;
        const parsed = readIdAndEmail(await response.json().catch(() => null));
        reportedUserId = parsed.userId;
        reportedEmail = parsed.email;
      } else if (response.status === 404 || response.status === 405) {
        profileEndpointUsable = false;
      }
    }
  }

  if (!vouched) {
    // /qb-connections is the app's own "am I signed in" call — every page load
    // hits it, and it 401s for a missing or invalid token. A user with no
    // QuickBooks company still gets a 2xx, so this vouches for the session
    // rather than for having connected QuickBooks.
    const response = await callUpstream("/qb-connections", accessToken);
    if (!response) return { kind: "unavailable", reason: "upstream-unreachable" };
    if (response.status === 401 || response.status === 403) return { kind: "unauthenticated" };
    if (!response.ok) return { kind: "unavailable", reason: `upstream-${response.status}` };
    vouched = true;
  }

  // ── Step 2: subject and email ────────────────────────────────────────────
  // The token's own claims are preferred: they are per-user by construction,
  // because the backend minted this credential for this one user and has just
  // vouched for it.
  const claims = decodeJwtPayload(accessToken);
  const fromToken = readIdAndEmail(claims);

  const userId = fromToken.userId ?? reportedUserId;
  let email = fromToken.email ?? reportedEmail;

  if (!userId) return { kind: "unavailable", reason: "no-subject" };

  // Last server-side source: the by-id profile. The ported client only ever
  // PATCHes this path, so a GET may well 404 — best-effort, never fatal.
  if (!email) {
    const response = await callUpstream(`/users/${encodeURIComponent(userId)}`, accessToken);
    if (response?.ok) {
      email = readIdAndEmail(await response.json().catch(() => null)).email;
    }
  }

  return { kind: "authenticated", userId, email: email ?? null };
}
