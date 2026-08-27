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
// WHY THE EMAIL MATTERS SO MUCH HERE. The alias's `ownerEmail` is the sender
// allow-list — it decides whose forwarded mail can create invoices in this
// company. If the browser could supply it, any signed-in user could nominate an
// arbitrary address (including an attacker's) as an authorized sender for their
// own books, and worse, the value would be trusted forever afterwards. So it is
// read here, server-side, from the backend's own view of the account, and the
// route refuses to create an alias when it cannot be established.
import { SAVETRIX_API_BASE_URL } from "./config";

const UPSTREAM_TIMEOUT_MS = 10_000;

export type InboundIdentity =
  | { kind: "authenticated"; userId: string; email: string }
  | { kind: "unauthenticated" }
  /** Fail closed: never fall back to a guessed id or a browser-supplied email. */
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

function readIdAndEmail(payload: unknown): { userId: string | null; email: string | null } {
  for (const record of candidateRecords(payload)) {
    const email = pickString(record, ["email"]);
    const userId = pickString(record, ["_id", "id", "userId", "uid"]);
    // Require the pair together. An unexpected 200 (a catch-all handler, a
    // collection response) must not contribute an id from one shape and an
    // email from another.
    if (email && userId) return { userId, email };
  }
  for (const record of candidateRecords(payload)) {
    const userId = pickString(record, ["_id", "id", "userId", "uid"]);
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

export function __resetInboundIdentityForTests(): void {
  profileEndpointUsable = true;
}

export async function resolveInboundIdentity(accessToken: string): Promise<InboundIdentity> {
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
  const sub = pickString(claims, ["sub"]);

  const userId = fromToken.userId ?? sub ?? reportedUserId;
  const email = fromToken.email ?? reportedEmail;

  if (!userId) return { kind: "unavailable", reason: "no-subject" };
  if (!email) return { kind: "unavailable", reason: "no-email" };

  return { kind: "authenticated", userId, email };
}
