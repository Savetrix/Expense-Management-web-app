// SERVER-ONLY. The one door every bank route goes through.
//
// The browser sends its own Savetrix access token (authFetch) and the company in
// `X-QB-Id`. This repo cannot verify the token's signature (no signing secret),
// so the backend vouches for it: one `GET /qb-connections` with the caller's
// token both proves the token is live and lists the companies the caller can
// act on, with their role in each. That one call replaces the two that email
// forwarding makes (identity, then ownership).
//
// The company id is never taken on trust: it must be in the caller's own list.
// Results are cached for 60 s per instance by sha256(token); an "unavailable"
// answer is never cached, so a backend blip does not lock anyone out for a minute.
import { createHash } from "node:crypto";

import { SAVETRIX_API_BASE_URL } from "./config";

export type BankRole = "owner" | "admin" | "accountant" | "contributor" | "unknown";

/** What each role may do, mirroring the backend's ROLE_PERMISSIONS (Scantrix_API src/constants/permissions.js). */
export type BankAbility = "view" | "code" | "post" | "connect";

const ABILITIES: Record<BankRole, BankAbility[]> = {
  // CONNECT_QBO, REVIEW_EDIT_GL, APPROVE_POST_QBO, VIEW_ALL_SCANS
  owner: ["view", "code", "post", "connect"],
  admin: ["view", "code", "post", "connect"],
  // REVIEW_EDIT_GL, APPROVE_POST_QBO, VIEW_ALL_SCANS — but not CONNECT_QBO
  accountant: ["view", "code", "post"],
  // Upload only: bank data is not theirs to see.
  contributor: [],
  unknown: [],
};

export function can(role: BankRole, ability: BankAbility): boolean {
  return ABILITIES[role].includes(ability);
}

export interface CallerConnection {
  id: string;
  name: string;
  status: string | null;
  role: BankRole;
  /** "quickbooks" | "xero"; absent on older backends = QuickBooks. */
  providerId: string;
  providerName: string;
}

export interface Caller {
  userId: string;
  accessToken: string;
  connections: CallerConnection[];
}

export type DoorResult =
  | { ok: true; caller: Caller; connection: CallerConnection }
  | { ok: false; status: 401 | 403 | 409 | 503; error: string };

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

interface CacheEntry {
  caller: Caller;
  expiresAt: number;
}
const g = globalThis as { __bankDoorCache?: Map<string, CacheEntry> };
const cache = (g.__bankDoorCache ??= new Map());

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toRole(value: unknown): BankRole {
  const role = typeof value === "string" ? value.toLowerCase() : "";
  return role === "owner" || role === "admin" || role === "accountant" || role === "contributor" ? role : "unknown";
}

/** `{ data: { connections: [...] } }`, the shape getMyQBConnections reads. */
export function readConnections(payload: unknown): CallerConnection[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const list = [data?.connections, root?.connections, data, root].find((v) => Array.isArray(v));
  if (!Array.isArray(list)) return [];
  const out: CallerConnection[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = typeof item._id === "string" ? item._id : typeof item.id === "string" ? item.id : null;
    if (!id) continue;
    const provider = asRecord(item.provider);
    const providerId = typeof provider?.id === "string" ? provider.id : "quickbooks";
    out.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Company",
      status: typeof item.status === "string" ? item.status : null,
      role: toRole(item.role),
      providerId,
      providerName: typeof provider?.name === "string" ? provider.name : providerId === "xero" ? "Xero" : "QuickBooks",
    });
  }
  return out;
}

/** JWT payload without signature verification — used only after the backend vouched for the token. */
function userIdFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = asRecord(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    for (const key of ["id", "_id", "userId", "sub"]) {
      const v = payload?.[key];
      if (typeof v === "string" && v) return v;
    }
  } catch {
    // fall through
  }
  return null;
}

async function vouch(token: string): Promise<{ ok: true; caller: Caller } | { ok: false; reason: "unauthenticated" | "unavailable" }> {
  const key = createHash("sha256").update(token).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { ok: true, caller: hit.caller };

  let response: Response;
  try {
    response = await fetch(`${SAVETRIX_API_BASE_URL}/qb-connections`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthenticated" };
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const userId = userIdFromToken(token);
  if (!userId) return { ok: false, reason: "unauthenticated" };
  const caller: Caller = { userId, accessToken: token, connections: readConnections(await response.json().catch(() => null)) };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { caller, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ok: true, caller };
}

/**
 * Checks the caller and their right to `ability` on the company in `X-QB-Id`.
 * `requireLiveConnection` refuses a company whose accounting link is broken
 * (posting needs it; reading a feed does not).
 */
export async function authorizeBank(
  request: Request,
  ability: BankAbility,
  options: { requireLiveConnection?: boolean } = {},
): Promise<DoorResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Sign in again to continue." };

  const qbConnectionId = request.headers.get("x-qb-id")?.trim();
  if (!qbConnectionId) return { ok: false, status: 403, error: "Pick a company first." };

  const vouched = await vouch(token);
  if (!vouched.ok) {
    return vouched.reason === "unauthenticated"
      ? { ok: false, status: 401, error: "Your session has expired. Sign in again." }
      : { ok: false, status: 503, error: "Scantrix could not confirm your account just now. Try again in a moment." };
  }

  const connection = vouched.caller.connections.find((c) => c.id === qbConnectionId);
  if (!connection || connection.status === "disconnected") {
    return { ok: false, status: 403, error: "You don't have access to this company." };
  }
  if (!can(connection.role, ability)) {
    const verb = ability === "connect" ? "connect or disconnect banks" : ability === "post" ? "post to the accounting software" : ability === "code" ? "code bank transactions" : "see bank transactions";
    return { ok: false, status: 403, error: `Your role in ${connection.name} can't ${verb}.` };
  }
  if (options.requireLiveConnection && connection.status === "reconnect_required") {
    return { ok: false, status: 409, error: `Reconnect ${connection.providerName} for ${connection.name} first.` };
  }
  return { ok: true, caller: vouched.caller, connection };
}

/** Tests only. */
export function __resetBankDoorForTests(): void {
  cache.clear();
}
