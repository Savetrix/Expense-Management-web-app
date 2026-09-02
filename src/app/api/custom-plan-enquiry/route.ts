// Custom Plan enquiries from the pricing surfaces -> the Scantrix sales inbox.
//
// ── DELIBERATELY UNAUTHENTICATED ─────────────────────────────────────────────
// Unlike every other route in this app, this one takes no Bearer token. It has
// to: half its traffic comes from the public landing page's pricing section,
// where the visitor has no account — that is the entire point of a "Talk to
// Sales" flow. Requiring auth would leave it reachable only by people who
// already pay us.
//
// What replaces the auth check is four independent limits, in cost order so the
// cheapest rejection happens first:
//
//   1. Content-Length cap        — refuse an oversized body before reading it
//   2. Honeypot                  — a field no human can see, and no human fills
//   3. Per-IP rate limit         — best-effort, see lib/customPlanEnquiry/abuse.ts
//   4. Shape + length validation — the shared rules in lib/customPlanEnquiry/fields.ts
//
// A fifth, duplicate suppression, runs last because it is about correctness (one
// enquiry, one email) rather than abuse.
//
// ── LOGGING ──────────────────────────────────────────────────────────────────
// Structural only. Never the name, the address or the message: this is a public
// form, the payload is unverified personal data, and platform logs are a wider
// audience than the sales inbox the user consented to write to. Counting
// outcomes is enough to tell a broken deployment from a quiet one.
export const runtime = "nodejs";
// One upstream call with a 15s ceiling of its own, plus validation. 30s is
// ample; the route has no reason to sit near the platform's function limit.
export const maxDuration = 30;

import {
  clientKey,
  enquiryFingerprint,
  forgetFingerprint,
  isDuplicate,
  isRateLimited,
} from "@/lib/customPlanEnquiry/abuse";
import { readEnquiryConfig } from "@/lib/customPlanEnquiry/config";
import {
  isEnquirySurface,
  sanitizeDraft,
  validateDraft,
  type EnquirySurface,
} from "@/lib/customPlanEnquiry/fields";
import { buildEnquiryMessage } from "@/lib/customPlanEnquiry/message";
import { sendEmail } from "@/lib/email/send";
import { normalizeEmailAddress } from "@/lib/inboundEmail/address";

/** Matches the cap on the alias route. The largest legal body is ~4.7 KB. */
const MAX_BODY_BYTES = 20_000;

/**
 * Name of the honeypot field. Present in the form markup, hidden from sight and
 * from assistive technology, never focusable — so a value in it means an
 * automated client filled every input it found.
 */
const HONEYPOT_FIELD = "website";

const json = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    // Nothing here is cacheable and an enquiry response must never be shared
    // between visitors by an intermediary.
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(request: Request) {
  // ── 1. Size ──────────────────────────────────────────────────────────────
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "That message is too long. Please shorten it and try again." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // ── 2. Honeypot ──────────────────────────────────────────────────────────
  // Answered with 200, not 4xx, on purpose: a bot that learns which requests
  // are refused learns how to stop being refused. A human can never reach this
  // branch, so nothing legitimate is lost by lying to it.
  const honeypot = payload[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    console.log("[custom-plan-enquiry] rejected: honeypot");
    return json({ ok: true }, 200);
  }

  // ── 3. Rate limit ────────────────────────────────────────────────────────
  if (isRateLimited(clientKey(request.headers))) {
    return json(
      { error: "Too many enquiries from this connection. Please try again in a few minutes." },
      429,
    );
  }

  // ── 4. Validate ──────────────────────────────────────────────────────────
  // Sanitize first, then validate the sanitized values — so what gets checked is
  // exactly what would get sent, with no gap between the two for a control
  // character to live in.
  const draft = sanitizeDraft(payload);
  const fieldErrors = validateDraft(draft);
  if (Object.keys(fieldErrors).length > 0) {
    return json({ error: "Please correct the highlighted fields.", fieldErrors }, 400);
  }

  // Canonicalize with the same helper the inbound pipeline uses, so a stored or
  // replied-to address has one form. Belt and braces after validateDraft:
  // fields.ts is strictly the stricter of the two, so this should never fail —
  // but Reply-To is a header, and a header built from an unvalidated string is
  // how injection happens.
  const email = normalizeEmailAddress(draft.email);
  if (!email) {
    return json(
      { error: "Please correct the highlighted fields.", fieldErrors: { email: "Please enter a valid email address." } },
      400,
    );
  }

  const surface: EnquirySurface = isEnquirySurface(payload.surface) ? payload.surface : "landing";

  // ── 5. Duplicate ─────────────────────────────────────────────────────────
  // Reported as success. From the user's side a double-submitted enquiry DID
  // arrive, and showing them an error for it would only prompt a third attempt.
  const fingerprint = enquiryFingerprint(email, draft.message);
  if (isDuplicate(fingerprint)) {
    console.log(`[custom-plan-enquiry] duplicate suppressed surface=${surface}`);
    return json({ ok: true, duplicate: true }, 200);
  }

  // ── 6. Configuration ─────────────────────────────────────────────────────
  const config = readEnquiryConfig();
  if (!config.ok) {
    // The user gets a neutral message; the operator gets the specifics in the
    // server log. Never leak which variables a deployment is missing to the
    // browser — that is a map of the server's configuration.
    console.log(
      `[custom-plan-enquiry] not configured: missing=${config.missing.join(",") || "none"}${
        config.detail ? ` detail=${config.detail}` : ""
      }`,
    );
    forgetFingerprint(fingerprint);
    return json(
      {
        error:
          "We couldn't send your enquiry right now. Please email support@scantrix.ai and we'll pick it up from there.",
      },
      503,
    );
  }

  // ── 7. Send ──────────────────────────────────────────────────────────────
  const message = buildEnquiryMessage({ ...draft, email }, {
    surface,
    receivedAt: new Date().toISOString(),
    // Only ever what the client told us, and only used as a lead for sales to
    // follow — never as an authorization claim, because nothing here verifies
    // it. Trimmed and capped so a hostile value cannot bloat the email.
    userId:
      typeof payload.userId === "string" && payload.userId.trim()
        ? payload.userId.trim().slice(0, 64)
        : null,
  });

  const outcome = await sendEmail(
    {
      from: config.config.fromAddress,
      to: [config.config.recipient],
      subject: message.subject,
      text: message.text,
      html: message.html,
      // The whole reason the enquiry is useful: hitting Reply in the sales
      // inbox reaches the person who filled the form, not our own sender.
      replyTo: email,
    },
    config.config.providerApiKey,
  );

  if (!outcome.ok) {
    // Release the fingerprint so the user's retry is not mistaken for a
    // duplicate of an enquiry that never actually went anywhere.
    forgetFingerprint(fingerprint);
    console.log(
      `[custom-plan-enquiry] send failed reason=${outcome.reason} transient=${outcome.transient}`,
    );
    return json(
      {
        error: outcome.transient
          ? "We couldn't send your enquiry just now. Your details are still here — please try again."
          : "We couldn't send your enquiry. Please email support@scantrix.ai and we'll pick it up from there.",
      },
      outcome.transient ? 503 : 502,
    );
  }

  console.log(`[custom-plan-enquiry] sent surface=${surface}`);
  return json({ ok: true }, 200);
}
