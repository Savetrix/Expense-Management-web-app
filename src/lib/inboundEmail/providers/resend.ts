// SERVER-ONLY. Resend Inbound -> NormalizedInboundEvent.
//
// The only file that knows Resend's webhook payload shape. Everything downstream
// sees NormalizedInboundEvent, so swapping to SES or Postmark means adding a
// sibling adapter and changing nothing else.
//
// This repository has no zod (checked against package.json), and the existing
// convention is hand-written type guards — see isInvoiceRecord/isVendor in
// src/lib/chatbot/tools.ts. Validation here follows that convention.
//
// ── CORRECTED AGAINST THE LIVE API ───────────────────────────────────────────
// An earlier version of this adapter was written from the architecture doc's
// assumptions rather than from Resend's reference, and three of them were wrong.
// The real `email.received` body is:
//
//   { type, created_at, data: { email_id, created_at, from, to, cc, bcc,
//                               received_for, message_id, subject,
//                               attachments: [{ id, filename, content_type }] } }
//
//   1. NO authentication results, and no spam score. The old adapter read
//      `data.authentication.spf` etc., which is always undefined — so every
//      message silently scored `none/none/none`, and with
//      INBOUND_REQUIRE_EMAIL_AUTH=true (the old default) every message would
//      have been rejected as `authentication_failed`. Verdicts now come from the
//      `Authentication-Results` header via authResults.ts, applied by the
//      pipeline after it fetches the message.
//   2. NO envelope object. The old adapter read `data.envelope.to` and
//      `data.envelope.from`. The envelope recipient is `received_for`; the
//      nearest thing to an envelope sender is the `Return-Path` header.
//   3. NO event id in the body. `svix-id` (the delivery id) is the outermost
//      idempotency key, and it arrives as a HEADER, so the caller must pass it.
import { parseEmailAddress } from "../address";
import type {
  EmailAuthResults,
  NormalizedAttachment,
  NormalizedInboundEvent,
  ValidationOutcome,
} from "../types";

/** Only inbound delivery is actionable; other event types are acknowledged and dropped. */
export const SUPPORTED_EVENT_TYPES = ["email.received", "inbound.email.received"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  const single = asString(value);
  return single ? [single] : [];
}

export function isSupportedEventType(type: string | null): boolean {
  return type !== null && (SUPPORTED_EVENT_TYPES as readonly string[]).includes(type);
}

export interface ParsedEnvelope {
  eventType: string | null;
  /** null when the event type is one we acknowledge but do not act on. */
  event: NormalizedInboundEvent | null;
}

export interface NormalizeOptions {
  /**
   * The `svix-id` delivery header. Required: the body carries no event id, and
   * without a stable outermost key a redelivery would be processed as new mail.
   */
  deliveryId: string;
}

/** No verdicts are available at webhook time; the pipeline fills these in. */
const NO_AUTH_RESULTS: EmailAuthResults = { spf: "none", dkim: "none", dmarc: "none" };

/**
 * Normalize a verified webhook body.
 *
 * Called only after signature verification. Returns a rejection outcome rather
 * than throwing on shape problems, so the route can answer 400 without a
 * try/catch.
 */
export function normalizeResendEvent(
  payload: unknown,
  options: NormalizeOptions,
): ValidationOutcome<ParsedEnvelope> {
  const root = asRecord(payload);
  if (!root) return { ok: false, code: "invalid_payload", detail: "payload not an object" };

  const eventType = asString(root.type);
  if (!isSupportedEventType(eventType)) {
    // Not an error — an event we do not act on. The caller acknowledges it (§13).
    return { ok: true, value: { eventType, event: null } };
  }

  const data = asRecord(root.data) ?? root;

  const providerEmailId = asString(data.email_id) ?? asString(data.id);
  if (!providerEmailId) {
    return { ok: false, code: "invalid_payload", detail: "missing email_id" };
  }

  // `svix-id` first: it identifies this DELIVERY, so a redelivery of the same
  // email reuses it and dedupes correctly. Falling back to the email id keeps
  // idempotency working if the header is ever absent, at the cost of treating
  // two genuine deliveries of one email as one — the safe direction.
  const providerEventId = options.deliveryId?.trim() || providerEmailId;

  const receivedRaw = asString(data.created_at) ?? asString(root.created_at);
  const parsedReceived = receivedRaw ? new Date(receivedRaw) : new Date();
  const receivedAt = Number.isNaN(parsedReceived.getTime()) ? new Date() : parsedReceived;

  // `received_for` is the envelope recipient and the authoritative delivery
  // target: a forwarded or BCC'd invoice frequently does not name our alias in
  // `to` at all. Visible headers are kept as a fallback only.
  const receivedFor = asStringArray(data.received_for)
    .map((r) => parseEmailAddress(r))
    .filter((r): r is string => r !== null);

  const recipients = [
    ...receivedFor,
    ...asStringArray(data.to),
    ...asStringArray(data.cc),
    ...asStringArray(data.bcc),
  ]
    .map((r) => parseEmailAddress(r))
    .filter((r): r is string => r !== null);

  return {
    ok: true,
    value: {
      eventType,
      event: {
        provider: "resend",
        providerEventId,
        providerEmailId,
        rfcMessageId: asString(data.message_id),
        receivedAt,
        // Not exposed by Resend. The pipeline substitutes the Return-Path
        // header once it has fetched the message.
        envelopeSender: null,
        from: parseEmailAddress(asStringArray(data.from)[0] ?? asString(data.from)),
        sender: null,
        returnPath: null,
        recipients: Array.from(new Set(recipients)),
        receivedFor,
        subject: asString(data.subject),
        authResults: NO_AUTH_RESULTS,
        attachments: normalizeAttachments(data.attachments),
        providerMetadata: {
          // Audit/replay only. Never the body (§25).
          attachment_count: Array.isArray(data.attachments) ? data.attachments.length : 0,
          received_for_count: receivedFor.length,
        },
      },
    },
  };
}

/**
 * Webhook-payload attachments carry only id/filename/content_type — no size,
 * disposition or content-id. Those arrive from the attachments API, so the
 * defaults here are deliberately neutral: `sizeBytes: 0` and
 * `disposition: "unknown"` must not cause the inline-asset heuristic to discard
 * a real invoice before we have the metadata to judge it.
 */
function normalizeAttachments(value: unknown): NormalizedAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: NormalizedAttachment[] = [];
  for (const entry of value) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = asString(item.id) ?? asString(item.attachment_id);
    if (!id) continue;

    out.push({
      providerAttachmentId: id,
      filename: asString(item.filename) ?? asString(item.name) ?? "attachment",
      reportedMimeType: asString(item.content_type) ?? "application/octet-stream",
      sizeBytes: typeof item.size === "number" && item.size >= 0 ? item.size : 0,
      disposition: readDisposition(asString(item.content_disposition)),
      contentId: asString(item.content_id),
    });
  }
  return out;
}

export function readDisposition(raw: string | null): NormalizedAttachment["disposition"] {
  const value = raw?.toLowerCase() ?? "";
  if (value.startsWith("inline")) return "inline";
  if (value.startsWith("attachment")) return "attachment";
  return "unknown";
}

/**
 * Headers a message must NOT carry to be treated as a human forward (§16).
 *
 * Resend returns headers as an OBJECT on the fetched message, so duplicates are
 * already collapsed by the time we see them. Both shapes are accepted anyway,
 * because the webhook payload has no headers at all and a future provider may
 * use the array form.
 */
export function extractHeaders(payload: unknown): Record<string, string> {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload) ?? {};
  const headers = data.headers;
  const out: Record<string, string> = {};

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const item = asRecord(entry);
      const name = asString(item?.name);
      const value = asString(item?.value);
      if (name && value) out[name.toLowerCase()] = value;
    }
    return out;
  }
  const record = asRecord(headers);
  if (record) {
    for (const [name, value] of Object.entries(record)) {
      const str = Array.isArray(value) ? asString(value[0]) : asString(value);
      if (str) out[name.toLowerCase()] = str;
    }
  }
  return out;
}
