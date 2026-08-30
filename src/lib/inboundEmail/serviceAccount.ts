// SERVER-ONLY. The dedicated Scantrix account that performs inbound uploads.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// An inbound email has no browser session, but the invoice it carries must be
// created inside the right company by an account the backend accepts.
//
// The first design stored the accountant's own refresh token and acted as them.
// That failed against a fact only measurement revealed: this backend allows
// exactly ONE live session per account. A second login invalidates the first
// session's refresh token. So the stored delegation and the person's own browser
// were competing for a single slot — every time they signed in anywhere the
// forwarding broke, and every forwarded invoice risked signing them out.
//
// A dedicated account that no human ever signs into removes the competition
// entirely. Three measured facts make it work:
//
//   1. Access tokens are stateless JWTs valid for SEVEN DAYS, and they SURVIVE a
//      later login on the same account (verified: token from login #1 still
//      answers 200 after login #2). So concurrent server instances cannot
//      invalidate each other, and we can cache one token for a week.
//   2. We therefore never call /auth/refresh at all — the single-session rule
//      only ever bit the refresh token, and we simply do not use one.
//   3. A "Contributor" member can upload invoices into a company it does not
//      own (verified against the live API). That is the product's own role,
//      described in its team screen as "can upload and edit invoices only" — so
//      the service account holds exactly the authority this feature needs and
//      nothing more. It cannot manage the team or touch the QuickBooks link.
//
// The consequence worth stating plainly: NO USER CREDENTIAL IS STORED ANYWHERE
// any more. One credential, owned by us, scoped by the backend's own role model.
//
// ── SELF-HEALING ─────────────────────────────────────────────────────────────
// Because we hold the account's email and password, a dead session is not an
// outage: we sign in again and carry on. There is no "reconnect" for a user to
// click, and no state a human has to repair.
import { SAVETRIX_API_BASE_URL } from "./config";
import { classifyHttpFailure } from "./idempotency";
import { readServiceSession, writeServiceSession } from "./store";

const TIMEOUT_MS = 15_000;

/**
 * Re-authenticate this long before the cached token expires. Generous because a
 * login is cheap and a token that dies mid-message costs a redelivery.
 */
const RENEW_BEFORE_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Cap the cached lifetime even if the token claims longer. */
const MAX_SESSION_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

export type ServiceTokenOutcome =
  | { ok: true; accessToken: string }
  /** The account itself is unusable — wrong password, disabled, deleted. */
  | { ok: false; reason: "unauthorized"; detail: string }
  /** Upstream problem. Worth another delivery attempt. */
  | { ok: false; reason: "transient"; detail: string };

/** `exp` from a JWT, in ms. Null for anything we cannot read. */
function expiryOf(accessToken: string): number | null {
  const segments = accessToken.split(".");
  if (segments.length !== 3) return null;
  try {
    const json = Buffer.from(
      segments[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function login(email: string, password: string): Promise<ServiceTokenOutcome> {
  let response: Response;
  try {
    response = await fetch(`${SAVETRIX_API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "transient", detail: "login-unreachable" };
  }

  if (response.status === 401 || response.status === 403 || response.status === 400) {
    // Bad credentials or a disabled account. Retrying for 32 hours will not fix
    // it; a human has to correct the configuration.
    return { ok: false, reason: "unauthorized", detail: `login-${response.status}` };
  }
  if (!response.ok) {
    if (classifyHttpFailure(response.status) === "retryable") {
      return { ok: false, reason: "transient", detail: `login-${response.status}` };
    }
    return { ok: false, reason: "unauthorized", detail: `login-${response.status}` };
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: { accessToken?: unknown } }
    | null;
  const accessToken = payload?.data?.accessToken;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return { ok: false, reason: "transient", detail: "login-no-token" };
  }
  return { ok: true, accessToken: accessToken.trim() };
}

export interface ServiceCredentials {
  email: string;
  password: string;
}

/**
 * A usable service access token, from cache when possible.
 *
 * `forceRefresh` skips the cache — used when a cached token was just refused,
 * so one stale entry cannot wedge every subsequent message.
 *
 * Concurrency needs no lock: two instances logging in simultaneously both
 * receive valid tokens (access tokens survive each other), and whichever writes
 * the cache last simply wins. This is only safe because of measured fact (1) in
 * the file header — with session-invalidating access tokens it would not be.
 */
export async function getServiceAccessToken(
  credentials: ServiceCredentials,
  options: { forceRefresh?: boolean } = {},
): Promise<ServiceTokenOutcome> {
  if (!options.forceRefresh) {
    const cached = await readServiceSession().catch(() => null);
    if (cached && cached.email === credentials.email && cached.expiresAtMs - Date.now() > RENEW_BEFORE_MS) {
      return { ok: true, accessToken: cached.accessToken };
    }
  }

  const outcome = await login(credentials.email, credentials.password);
  if (!outcome.ok) return outcome;

  const claimed = expiryOf(outcome.accessToken);
  const expiresAtMs = Math.min(
    claimed ?? Date.now() + MAX_SESSION_MS,
    Date.now() + MAX_SESSION_MS,
  );
  // Best-effort: a cache write failure costs an extra login, never correctness.
  await writeServiceSession({
    email: credentials.email,
    accessToken: outcome.accessToken,
    expiresAtMs,
  }).catch(() => undefined);

  return outcome;
}

// ==============================
// MEMBERSHIP
// ==============================

export type MembershipOutcome =
  | { ok: true; alreadyMember: boolean }
  | { ok: false; reason: string };

interface MemberEntry {
  email: string | null;
  inviteToken: string | null;
  inviteStatus: string | null;
}

function readMembers(payload: unknown): { members: MemberEntry[]; ownerEmail: string | null } {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return { members: [], ownerEmail: null };

  const owner = data.owner as { userId?: { email?: unknown } } | undefined;
  const ownerEmail =
    typeof owner?.userId?.email === "string" ? owner.userId.email.toLowerCase() : null;

  const raw = Array.isArray(data.members) ? data.members : [];
  const members: MemberEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const nested = item.userId as { email?: unknown } | undefined;
    const email =
      (typeof nested?.email === "string" && nested.email) ||
      (typeof item.invitedEmail === "string" && item.invitedEmail) ||
      null;
    members.push({
      email: email ? email.toLowerCase() : null,
      inviteToken: typeof item.inviteToken === "string" ? item.inviteToken : null,
      inviteStatus: typeof item.inviteStatus === "string" ? item.inviteStatus : null,
    });
  }
  return { members, ownerEmail };
}

async function call(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: unknown; qbId?: string },
): Promise<{ status: number; payload: unknown } | null> {
  try {
    const response = await fetch(`${SAVETRIX_API_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.qbId ? { "X-QB-Id": init.qbId } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

/**
 * Make sure the service account is a Contributor on this company.
 *
 * Runs at ENABLE time, not per email, because inviting requires the OWNER's
 * token and the owner is only present when they press the button. Idempotent:
 * an existing accepted membership is left alone, and a pending invite is
 * accepted rather than re-issued.
 *
 * `ownerAccessToken` is the person turning forwarding on; `serviceAccessToken`
 * is the robot accepting. Both are needed — the backend quite rightly will not
 * let one account both invite and accept on the other's behalf.
 */
export async function ensureServiceMembership(
  ownerAccessToken: string,
  serviceAccessToken: string,
  qbConnectionId: string,
  serviceEmail: string,
): Promise<MembershipOutcome> {
  const wanted = serviceEmail.toLowerCase();

  const existing = await call(
    `/qb-connections/${encodeURIComponent(qbConnectionId)}/members`,
    ownerAccessToken,
    { qbId: qbConnectionId },
  );
  if (!existing) return { ok: false, reason: "members-unreachable" };
  if (existing.status === 401 || existing.status === 403) {
    return { ok: false, reason: "not-authorized-to-invite" };
  }

  let inviteToken: string | null = null;

  if (existing.status < 400) {
    const { members, ownerEmail } = readMembers(existing.payload);
    // The service account could itself be the owner on a company somebody set
    // up by hand. Nothing to do then.
    if (ownerEmail === wanted) return { ok: true, alreadyMember: true };

    const match = members.find((m) => m.email === wanted);
    if (match?.inviteStatus === "accepted") return { ok: true, alreadyMember: true };
    // A pending invite from an earlier half-finished attempt: reuse its token
    // instead of creating a second one.
    if (match?.inviteToken) inviteToken = match.inviteToken;
  }

  if (!inviteToken) {
    const invited = await call(
      `/qb-connections/${encodeURIComponent(qbConnectionId)}/members`,
      ownerAccessToken,
      { method: "POST", qbId: qbConnectionId, body: { email: serviceEmail, role: "contributor" } },
    );
    if (!invited) return { ok: false, reason: "invite-unreachable" };
    if (invited.status >= 400) return { ok: false, reason: `invite-${invited.status}` };

    const data = (invited.payload as { data?: Record<string, unknown> } | null)?.data;
    const member = (data?.member ?? data) as Record<string, unknown> | undefined;
    const token = member?.inviteToken;
    if (typeof token !== "string" || !token) return { ok: false, reason: "invite-no-token" };
    inviteToken = token;
  }

  const accepted = await call("/qb-connections/invite/accept", serviceAccessToken, {
    method: "POST",
    body: { inviteToken },
  });
  if (!accepted) return { ok: false, reason: "accept-unreachable" };
  if (accepted.status >= 400) return { ok: false, reason: `accept-${accepted.status}` };

  return { ok: true, alreadyMember: false };
}
