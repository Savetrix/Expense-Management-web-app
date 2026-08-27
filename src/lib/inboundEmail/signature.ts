// SERVER-ONLY. Webhook signature verification (§13).
//
// Verified against the UNTOUCHED raw body. Parsing first and verifying afterwards
// would mean the JSON parser — and any code reading the parsed object — runs on
// input nobody has authenticated yet.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignatureHeaders {
  /** Unique message id, part of the signed payload. */
  id: string;
  /** Unix seconds, as a string, exactly as sent. */
  timestamp: string;
  /** Space-separated `v1,<base64>` entries. */
  signature: string;
}

export type SignatureFailure = "invalid_signature" | "stale_timestamp";

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailure };

export interface VerifyOptions {
  /** Provider secret, `whsec_`-prefixed for Svix-style secrets. */
  secret: string;
  /** Replay window. 5 minutes matches the provider default. */
  toleranceSeconds?: number;
  /** Injectable for tests; defaults to now. */
  nowSeconds?: number;
}

/**
 * Svix-scheme verification, which is what Resend uses.
 *
 * Signed payload is `${id}.${timestamp}.${rawBody}`. Multiple `v1,` signatures may
 * be present during a secret rotation, so any match is accepted — that is what
 * makes rotation possible without dropping deliveries.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: SignatureHeaders,
  options: VerifyOptions,
): SignatureResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "invalid_signature" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_signature" };

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  // Symmetric window: a timestamp far in the future is as suspicious as a stale one.
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: "stale_timestamp" };

  const secret = options.secret.startsWith("whsec_") ? options.secret.slice(6) : options.secret;
  let key: Buffer;
  try {
    key = Buffer.from(secret, "base64");
    if (key.length === 0) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");

  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    if (constantTimeEquals(value, expected)) return { ok: true };
  }
  return { ok: false, reason: "invalid_signature" };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
