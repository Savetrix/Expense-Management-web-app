// SERVER-ONLY. The app's outbound email seam.
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────
// Before this, the repo could RECEIVE email but not send it. The Resend
// integration under lib/inboundEmail/ is read-only: it fetches received
// messages and their attachments (providers/resendClient.ts) and never posts to
// /emails. Everything a user gets today — OTP, invites, password reset — is sent
// by the Savetrix backend at api.savetrix.com, which exposes no general-purpose
// "send this email" endpoint we could borrow (see src/store/auth/authApi.ts:
// every route there is an auth operation, not a mail operation).
//
// So sending had to be added. Rather than introduce a second vendor, this reuses
// the one already integrated, wired the same way as its inbound sibling: plain
// `fetch` against api.resend.com with no SDK, an AbortSignal timeout, failures
// classified through the shared classifyHttpFailure, and response bodies never
// logged. Swapping providers later means one more adapter here and no changes
// at the call site.
//
// ── WHAT THE CALLER MUST KNOW ────────────────────────────────────────────────
// `from` MUST be on a domain verified for SENDING in the Resend dashboard.
// Verifying a domain for RECEIVING (the MX record described in
// EMAIL_FORWARDING_DEPLOY.md) does not also authorize sending from it — they are
// separate records and a separate verification. A `from` on an unverified domain
// fails permanently with a 403, which this reports as `permanent` so the caller
// surfaces a configuration problem instead of retrying forever.
import { classifyHttpFailure } from "../inboundEmail/idempotency";

const API_BASE = "https://api.resend.com";
const SEND_TIMEOUT_MS = 15_000;

export interface OutboundEmail {
  /** `a@b.com` or `Display Name <a@b.com>`. Must be a verified sending domain. */
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  /**
   * Where a human reply goes. Kept separate from `from` on purpose: the message
   * must be SENT by a domain we control (or DMARC drops it), while the reply
   * should reach the person who filled in the form.
   */
  replyTo?: string;
}

export type SendOutcome =
  /** Accepted by the provider. `id` is their message id, for support tickets. */
  | { ok: true; id: string | null }
  /**
   * Not sent. `transient` distinguishes "try again in a moment" (network, 5xx,
   * 429) from "this will fail identically next time" (bad key, unverified
   * sender), which is what decides the HTTP status the route answers with.
   */
  | { ok: false; reason: string; transient: boolean };

/**
 * Send one transactional email.
 *
 * Never throws — every failure path returns a SendOutcome, because the callers
 * are route handlers that must answer with a status code rather than a stack
 * trace. Nothing about the message content is logged here; the caller decides
 * what is safe to record (see the route's structural-logging note).
 */
export async function sendEmail(email: OutboundEmail, apiKey: string): Promise<SendOutcome> {
  const payload: Record<string, unknown> = {
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  };
  // Resend's field is snake_case `reply_to` (verified against their API
  // reference). A camelCase key is silently ignored rather than rejected, which
  // would have made replies go to the no-reply sender with no visible error.
  if (email.replyTo) payload.reply_to = email.replyTo;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Network error or timeout. Worth another attempt.
    return { ok: false, reason: "provider-unreachable", transient: true };
  }

  if (!response.ok) {
    // The body echoes the request (including recipient addresses), so it is
    // never logged or returned — only the status is.
    return {
      ok: false,
      reason: `provider-${response.status}`,
      transient: classifyHttpFailure(response.status) === "retryable",
    };
  }

  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { ok: true, id: typeof body?.id === "string" ? body.id : null };
}
