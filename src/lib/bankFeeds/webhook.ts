// SERVER-ONLY. Plaid webhook verification and handling.
//
// Verification (plaid.com/docs/api/webhooks/webhook-verification/):
//   1. `Plaid-Verification` header is a JWT; its header must say alg ES256.
//   2. The signing key comes from /webhook_verification_key/get by `kid`,
//      cached here (several kids, refetched once a key reports expired).
//   3. The signature is checked with Node's own crypto (P-256, raw r||s).
//   4. `iat` no older than 5 minutes.
//   5. sha256 of the RAW body equals the `request_body_sha256` claim, compared in
//      constant time. Hash the bytes as received: Plaid's JSON is whitespace-
//      sensitive, so re-serialising would never match.
// Plaid's own sample skips the alg, the key expiry and caches one key; this
// does all three.
import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

import type { PlaidGateway } from "./plaid";

const MAX_AGE_SECONDS = 5 * 60;

interface CachedKey {
  jwk: Record<string, unknown>;
  fetchedAt: number;
}
const g = globalThis as { __plaidWebhookKeys?: Map<string, CachedKey> };
const keys = (g.__plaidWebhookKeys ??= new Map());

function b64urlJson(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function keyFor(gateway: PlaidGateway, kid: string): Promise<Record<string, unknown> | null> {
  const cached = keys.get(kid);
  const expired = typeof cached?.jwk.expired_at === "number" && cached.jwk.expired_at !== null && (cached.jwk.expired_at as number) * 1000 < Date.now();
  if (cached && !expired) return cached.jwk;
  const jwk = await gateway.webhookKey(kid).catch(() => null);
  if (!jwk) return null;
  if (keys.size > 20) keys.clear();
  keys.set(kid, { jwk, fetchedAt: Date.now() });
  return jwk;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyPlaidWebhook(gateway: PlaidGateway, rawBody: string, jwt: string | null, nowSeconds = Math.floor(Date.now() / 1000)): Promise<VerifyResult> {
  if (!jwt) return { ok: false, reason: "no signature header" };
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed signature" };
  const header = b64urlJson(parts[0]);
  if (header?.alg !== "ES256" || typeof header.kid !== "string") return { ok: false, reason: "unexpected algorithm" };

  const jwk = await keyFor(gateway, header.kid);
  if (!jwk) return { ok: false, reason: "unknown key" };
  if (typeof jwk.expired_at === "number" && jwk.expired_at * 1000 < Date.now()) return { ok: false, reason: "expired key" };

  let signatureOk = false;
  try {
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string }, format: "jwk" });
    signatureOk = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "bad signature" };

  const claims = b64urlJson(parts[1]);
  const iat = typeof claims?.iat === "number" ? claims.iat : null;
  if (iat === null || nowSeconds - iat > MAX_AGE_SECONDS || iat - nowSeconds > 60) return { ok: false, reason: "stale" };

  const expected = typeof claims?.request_body_sha256 === "string" ? claims.request_body_sha256 : "";
  const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return { ok: false, reason: "body mismatch" };
  }
  return { ok: true };
}

/** Tests only. */
export function __seedWebhookKeyForTests(kid: string, jwk: Record<string, unknown> | null): void {
  if (jwk) keys.set(kid, { jwk, fetchedAt: Date.now() });
  else keys.clear();
}

export interface PlaidWebhook {
  webhook_type: string;
  webhook_code: string;
  item_id?: string;
  error?: { error_code?: string } | null;
  initial_update_complete?: boolean;
  historical_update_complete?: boolean;
  environment?: string;
}

/** What a webhook asks us to do. */
export type WebhookAction =
  | { kind: "sync"; initialComplete?: boolean; historicalComplete?: boolean }
  | { kind: "status"; status: "login_required" | "pending_disconnect" | "revoked" | "active" | "error"; code: string | null }
  | { kind: "new_accounts" }
  | { kind: "ignore" };

export function actionFor(w: PlaidWebhook): WebhookAction {
  if (w.webhook_type === "TRANSACTIONS") {
    if (w.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      return { kind: "sync", initialComplete: w.initial_update_complete, historicalComplete: w.historical_update_complete };
    }
    return { kind: "ignore" };
  }
  if (w.webhook_type === "ITEM") {
    switch (w.webhook_code) {
      case "ERROR": {
        const code = w.error?.error_code ?? "ITEM_ERROR";
        return { kind: "status", status: code === "ITEM_LOGIN_REQUIRED" ? "login_required" : "error", code };
      }
      case "PENDING_DISCONNECT":
      case "PENDING_EXPIRATION":
        return { kind: "status", status: "pending_disconnect", code: w.webhook_code };
      case "USER_PERMISSION_REVOKED":
        return { kind: "status", status: "revoked", code: w.webhook_code };
      case "LOGIN_REPAIRED":
        return { kind: "status", status: "active", code: null };
      case "NEW_ACCOUNTS_AVAILABLE":
        return { kind: "new_accounts" };
      default:
        return { kind: "ignore" };
    }
  }
  return { kind: "ignore" };
}
