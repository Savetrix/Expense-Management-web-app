// E-book access requests -> the Scantrix inbox, and the access cookie.
//
// The visitor has no account, so like /api/custom-plan-enquiry this takes no
// Bearer token. What stands in for authentication is the same stack of cheap
// limits, in cost order:
//
//   1. Content-Length cap  - refuse an oversized body before reading it
//   2. Honeypot            - a field no human can see, and no human fills
//   3. Per-IP rate limit   - best-effort, shared helper with the enquiry form
//   4. Shape validation    - the same rules the form shows (lib/ebookLeads/fields.ts)
//   5. Duplicate window    - a double click is one lead, not two emails
//
// On success it emails the support inbox (Reply-To is the visitor) and sets the
// access cookie that unlocks the PDFs and the web text. It reuses the Custom
// Plan enquiry's email settings, so it needs no new environment variables.
//
// ── LOGGING ──────────────────────────────────────────────────────────────────
// Structural only. Never a name, email or phone number: this is an unverified
// public form and platform logs are a wider audience than the inbox the visitor
// wrote to.
export const runtime = "nodejs";
export const maxDuration = 30;

import { EBOOKS } from "@/content/ebooks";
import {
  clientKey,
  enquiryFingerprint,
  forgetFingerprint,
  isDuplicate,
  isRateLimited,
} from "@/lib/customPlanEnquiry/abuse";
import { readEnquiryConfig } from "@/lib/customPlanEnquiry/config";
import { EBOOK_ACCESS_COOKIE, EBOOK_ACCESS_MAX_AGE_SECONDS } from "@/lib/ebookLeads/access";
import { isEbookIntent, sanitizeLead, validateLead } from "@/lib/ebookLeads/fields";
import { buildLeadMessage } from "@/lib/ebookLeads/message";
import { sendEmail } from "@/lib/email/send";
import { normalizeEmailAddress } from "@/lib/inboundEmail/address";

const MAX_BODY_BYTES = 10_000;

/** Name of the honeypot field. Must match the form (EbookGateModal). */
const HONEYPOT_FIELD = "website";

const json = (body: unknown, status: number, withAccess = false) => {
  const response = Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
  if (withAccess) {
    // Set on the Response rather than via cookies(): this handler builds its own
    // Response, and the cookie must ride on that exact object.
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${EBOOK_ACCESS_COOKIE}=1; Path=/; Max-Age=${EBOOK_ACCESS_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return response;
};

export async function POST(request: Request) {
  // ── 1. Size ──────────────────────────────────────────────────────────────
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "That request is too large." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // ── 2. Honeypot ──────────────────────────────────────────────────────────
  // Answered 200 with NO access cookie: a bot that learns which requests are
  // refused learns how to stop being refused, but it never gets the files.
  const honeypot = payload[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    console.log("[ebook-lead] rejected: honeypot");
    return json({ ok: true }, 200);
  }

  // ── 3. Rate limit ────────────────────────────────────────────────────────
  // Prefixed so these attempts don't count against the enquiry form's allowance.
  if (isRateLimited(`ebook:${clientKey(request.headers)}`)) {
    return json({ error: "Too many requests from this connection. Please try again in a few minutes." }, 429);
  }

  // ── 4. Validate ──────────────────────────────────────────────────────────
  const ebook = EBOOKS.find((book) => book.slug === payload.slug);
  if (!ebook || !isEbookIntent(payload.intent)) {
    return json({ error: "Unknown e-book." }, 400);
  }
  const intent = payload.intent;

  const lead = sanitizeLead(payload);
  const fieldErrors = validateLead(lead);
  if (Object.keys(fieldErrors).length > 0) {
    return json({ error: "Please correct the highlighted fields.", fieldErrors }, 400);
  }
  // Belt and braces: Reply-To is a header, and a header built from an
  // unvalidated string is how injection happens.
  const email = normalizeEmailAddress(lead.email);
  if (!email) {
    return json(
      { error: "Please correct the highlighted fields.", fieldErrors: { email: "Please enter a valid email address." } },
      400,
    );
  }

  // ── 5. Duplicate ─────────────────────────────────────────────────────────
  // Reported as success WITH access: from the visitor's side it worked.
  const fingerprint = enquiryFingerprint(email, `ebook:${ebook.slug}:${intent}`);
  if (isDuplicate(fingerprint)) {
    console.log("[ebook-lead] duplicate suppressed");
    return json({ ok: true, duplicate: true }, 200, true);
  }

  // ── 6. Configuration ─────────────────────────────────────────────────────
  const config = readEnquiryConfig();
  if (!config.ok) {
    console.log(
      `[ebook-lead] not configured: missing=${config.missing.join(",") || "none"}${config.detail ? ` detail=${config.detail}` : ""}`,
    );
    // In production a lead that goes nowhere is a lost lead, so fail closed and
    // let the visitor retry. In development there is rarely a Resend key, and
    // blocking every local test of the gate would make it unusable, so let the
    // visitor through and say so in the log.
    if (process.env.NODE_ENV === "production") {
      forgetFingerprint(fingerprint);
      return json(
        { error: "We couldn't process that just now. Please try again in a moment, or email support@scantrix.ai." },
        503,
      );
    }
    console.log("[ebook-lead] development: granting access without sending the email");
    return json({ ok: true }, 200, true);
  }

  // ── 7. Send ──────────────────────────────────────────────────────────────
  const message = buildLeadMessage(
    { ...lead, email },
    { ebookTitle: ebook.title, intent, receivedAt: new Date().toISOString() },
  );
  const outcome = await sendEmail(
    {
      from: config.config.fromAddress,
      to: [config.config.recipient],
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: email,
    },
    config.config.providerApiKey,
  );

  if (!outcome.ok) {
    forgetFingerprint(fingerprint);
    console.log(`[ebook-lead] send failed reason=${outcome.reason} transient=${outcome.transient}`);
    return json(
      {
        error: outcome.transient
          ? "We couldn't process that just now. Your details are still here, so please try again."
          : "We couldn't process that. Please email support@scantrix.ai and we'll sort it out.",
      },
      outcome.transient ? 503 : 502,
    );
  }

  console.log(`[ebook-lead] sent ebook=${ebook.slug} intent=${intent}`);
  return json({ ok: true }, 200, true);
}
