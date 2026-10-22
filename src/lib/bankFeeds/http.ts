// SERVER-ONLY. What every bank route does first: config + kill switch, then the
// door, then the database. Errors use the same shape and codes as the
// email-forwarding routes: { error } with 401 (session), 403 (not yours),
// 409 (state), 503 (store, Plaid or config unavailable), 500 (unknown).
import { readBankConfig, type BankFeedsConfig } from "./config";
import { openDb, BankStoreError, type Db } from "./db";
import { authorizeBank, type BankAbility, type Caller, type CallerConnection } from "./door";
import { PlaidCallError } from "./plaid";

export interface BankContext {
  config: BankFeedsConfig;
  db: Db;
  caller: Caller;
  connection: CallerConnection;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...extra }, status);
}

/** Resolves the context, or the Response to send instead. */
export async function bankContext(
  request: Request,
  ability: BankAbility,
  options: { requireLiveConnection?: boolean } = {},
): Promise<BankContext | Response> {
  const outcome = readBankConfig();
  if (!outcome.ok) {
    console.warn(`[bank] not configured: missing ${outcome.missing.join(", ")}`);
    return fail(503, "Bank feeds are not set up on this server yet.", { reason: "not_configured" });
  }
  if (!outcome.config.enabled) return fail(503, "Bank feeds are switched off.", { reason: "disabled" });

  const door = await authorizeBank(request, ability, options);
  if (!door.ok) return fail(door.status, door.error);

  return { config: outcome.config, db: openDb(outcome.config.databaseUrl), caller: door.caller, connection: door.connection };
}

/** Maps a thrown error to a response; never echoes internals to the browser. */
export function errorResponse(where: string, error: unknown): Response {
  if (error instanceof BankStoreError) {
    console.error(`[bank] ${where}: store unavailable`, (error.cause as Error | undefined)?.message ?? "");
    return fail(503, "Scantrix couldn't reach its bank records just now. Try again in a moment.", { reason: "store_unavailable" });
  }
  if (error instanceof PlaidCallError) {
    console.error(`[bank] ${where}: plaid ${error.code} (${error.requestId ?? "no request id"})`);
    if (error.needsRelogin) return fail(409, "The bank needs you to sign in again.", { reason: "login_required" });
    return fail(502, error.displayMessage ?? "Plaid couldn't complete that just now. Try again in a moment.", { reason: "plaid", code: error.code });
  }
  console.error(`[bank] ${where}: unexpected`, error instanceof Error ? error.message : error);
  return fail(500, "Something went wrong. Try again.");
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
