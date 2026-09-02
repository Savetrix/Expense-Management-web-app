// SERVER-ONLY. Rate limiting and duplicate suppression for the public enquiry
// endpoint.
//
// ── HONEST ABOUT THE LIMITS OF THIS ──────────────────────────────────────────
// State lives in instance memory, exactly like the rate limiter in
// src/app/api/chat/route.ts, and it carries the same caveat: it does NOT hold
// across serverless instances or regions, so it bounds abuse that lands
// repeatedly on the same warm instance and nothing more. A determined attacker
// with a spread of source addresses gets through.
//
// That is an acceptable trade here and it is worth saying why, rather than
// implying more protection than exists. The blast radius of getting past this
// is "a human reads a junk email" — there is no account created, no money
// moved, no data exposed. The cheap in-memory guard removes the accidental
// double-submit and the naive script, which is the bulk of real traffic, and it
// does so without putting a Vercel Blob round trip (and a hard dependency on
// blob credentials) in front of a sales form. If enquiry spam ever becomes a
// real problem, the fix is a shared store — the same open question the chat
// route already records — or a CAPTCHA, not a bigger Map.
//
// The other three defences are elsewhere and are NOT best-effort: the honeypot
// and the body-size cap in the route, and the length/shape validation in
// fields.ts.
import { createHash } from "node:crypto";

/** Per-IP window. Generous — a person correcting a typo must not be blocked. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * How long the same enquiry is treated as already-received.
 *
 * Covers the cases the client-side submit guard cannot: a double-tap that
 * produced two in-flight requests, and a retry after a response was lost in
 * transit. Long enough to absorb those, short enough that somebody who
 * genuinely wants to resend the same text after a coffee break can.
 */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

/**
 * Ceiling on tracked keys, so a spray of distinct source addresses cannot grow
 * these maps without bound. Eviction is oldest-first and only ever loses
 * protection, never correctness.
 */
const MAX_TRACKED_KEYS = 5_000;

const requestTimestamps = new Map<string, number[]>();
const recentFingerprints = new Map<string, number>();

function evictOldest(map: Map<string, unknown>): void {
  if (map.size <= MAX_TRACKED_KEYS) return;
  // Map iterates in insertion order, so the first key is the oldest entry.
  const overflow = map.size - MAX_TRACKED_KEYS;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++removed >= overflow) break;
  }
}

/**
 * Record an attempt and report whether the caller has exceeded the window.
 *
 * Counts the attempt even when it is over the limit, so a client that keeps
 * hammering stays blocked for the full window rather than sliding back under
 * the cap by waiting for its own earliest entry to age out.
 */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const timestamps = (requestTimestamps.get(key) ?? []).filter(
    (at) => now - at < RATE_LIMIT_WINDOW_MS,
  );
  timestamps.push(now);
  requestTimestamps.set(key, timestamps);
  evictOldest(requestTimestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Stable identity for "the same enquiry sent twice".
 *
 * Hashed rather than stored raw: this map lives in memory for ten minutes and
 * there is no reason for a plaintext address and message body to sit in it.
 * Email is lowercased so `A@b.com` and `a@b.com` collapse; the message is
 * compared verbatim, because an edited message is a new enquiry.
 */
export function enquiryFingerprint(email: string, message: string): string {
  return createHash("sha256").update(`${email.toLowerCase()}\u0000${message}`).digest("hex");
}

/**
 * True when this exact enquiry was already accepted inside the window.
 *
 * Marks the fingerprint as seen either way, so the window is measured from the
 * most recent attempt.
 */
export function isDuplicate(fingerprint: string, now: number = Date.now()): boolean {
  const seenAt = recentFingerprints.get(fingerprint);
  const duplicate = seenAt !== undefined && now - seenAt < DUPLICATE_WINDOW_MS;

  // Prune opportunistically — there is no timer to do it, and without this the
  // map only ever grows until it hits the eviction ceiling.
  for (const [key, at] of recentFingerprints) {
    if (now - at >= DUPLICATE_WINDOW_MS) recentFingerprints.delete(key);
  }

  recentFingerprints.set(fingerprint, now);
  evictOldest(recentFingerprints);
  return duplicate;
}

/**
 * Forget a fingerprint recorded moments ago.
 *
 * Called when the send FAILED. Without it, a transient provider outage would
 * mark the enquiry as seen, and the user's perfectly reasonable retry would be
 * silently swallowed as a duplicate — losing the enquiry entirely, which is the
 * one outcome this whole feature exists to prevent.
 */
export function forgetFingerprint(fingerprint: string): void {
  recentFingerprints.delete(fingerprint);
}

/**
 * Best available client identifier.
 *
 * `x-forwarded-for` is a client-supplied header and is trivially spoofed in
 * general — but on Vercel the platform proxy rewrites it, and the FIRST entry
 * is the real peer. Taking the first entry (not the last) is what makes this
 * usable there. Falls back to a shared bucket when no header is present, which
 * fails toward rate-limiting more traffic together rather than less.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam — the module-level maps would otherwise leak between test cases. */
export function __resetAbuseStateForTests(): void {
  requestTimestamps.clear();
  recentFingerprints.clear();
}
