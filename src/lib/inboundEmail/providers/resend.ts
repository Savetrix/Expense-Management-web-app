// SERVER-ONLY. Resend Inbound -> NormalizedInboundEvent (§7 of the brief).
//
// The only file in this directory that knows Resend's payload shape. Everything
// downstream sees NormalizedInboundEvent, so swapping to SES or Postmark means
// adding a sibling adapter and changing nothing else.
//
// This repository has no zod (checked against package.json), and the existing
// convention is hand-written type guards — see isInvoiceRecord/isVendor in
// src/lib/chatbot/tools.ts. Validation here follows that convention.
import { parseEmailAddress } from "../address";
import type {
  AuthVerdict,
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

/** Providers spell verdicts inconsistently; anything unrecognized becomes "none". */
function asVerdict(value: unknown): AuthVerdict {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return "none";
  if (raw === "pass" || raw.endsWith("=pass")) return "pass";
  if (raw === "fail" || raw.endsWith("=fail") || raw === "softfail") return "fail";
  if (raw === "neutral" || raw === "none") return raw === "none" ? "none" : "neutral";
  return "neutral";
}

export function isSupportedEventType(type: string | null): boolean {
  return type !== null && (SUPPORTED_EVENT_TYPES as readonly string[]).includes(type);
}

export interface ParsedEnvelope {
  eventType: string | null;
  event: NormalizedInboundEvent | null;
}

/**
 * Normalize a verified webhook body.
 *
 * Called only after signature verification. Returns a rejection outcome rather than
 * throwing on shape problems, so the route can answer 400 without a try/catch.
 */
export function normalizeResendEvent(payload: unknown): ValidationOutcome<ParsedEnvelope> {
  const root = asRecord(payload);
  if (!root) return { ok: false, code: "no_supported_attachments", detail: "payload not an object" };

  const eventType = asString(root.type);
  if (!isSupportedEventType(eventType)) {
    // Not an error — an event we do not act on. The caller acknowledges it (§13).
    return { ok: true, value: { eventType, event: null } };
  }

  const data = asRecord(root.data) ?? root;

  const providerEmailId = asString(data.email_id) ?? asString(data.id);
  // `svix-id` is the delivery id and is the outermost dedupe key; fall back to the
  // email id so a provider that omits it still gets idempotency.
  const providerEventId = asString(root.event_id) ?? asString(root.id) ?? providerEmailId;
  if (!providerEmailId || !providerEventId) {
    return { ok: false, code: "no_supported_attachments", detail: "missing provider ids" };
  }

  const authSource = asRecord(data.authentication) ?? asRecord(data.auth_results) ?? {};
  const authResults: EmailAuthResults = {
    spf: asVerdict(authSource.spf),
    dkim: asVerdict(authSource.dkim),
    dmarc: asVerdict(authSource.dmarc),
  };

  const receivedRaw = asString(data.created_at) ?? asString(root.created_at);
  const receivedAt = receivedRaw ? new Date(receivedRaw) : new Date();

  const recipients = [
    ...asStringArray(data.to),
    ...asStringArray(data.cc),
    // The envelope recipient is the authoritative delivery target and can differ
    // from every visible header on a forwarded message.
    ...asStringArray(asRecord(data.envelope)?.to),
  ]
    .map((r) => parseEmailAddress(r))
    .filter((r): r is string => r !== null);

  const envelope = asRecord(data.envelope);

  return {
    ok: true,
    value: {
      eventType,
      event: {
        provider: "resend",
        providerEventId,
        providerEmailId,
        rfcMessageId: asString(data.message_id) ?? asString(data.rfc_message_id),
        receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
        envelopeSender: parseEmailAddress(asString(envelope?.from) ?? asString(data.envelope_from)),
        from: parseEmailAddress(asStringArray(data.from)[0] ?? asString(data.from)),
        sender: parseEmailAddress(asString(data.sender)),
        returnPath: parseEmailAddress(asString(data.return_path)),
        recipients,
        subject: asString(data.subject),
        authResults,
        attachments: normalizeAttachments(data.attachments),
        providerMetadata: {
          // Audit/replay only. Never the body (§25).
          spam_score: typeof data.spam_score === "number" ? data.spam_score : null,
          attachment_count: Array.isArray(data.attachments) ? data.attachments.length : 0,
        },
      },
    },
  };
}

function normalizeAttachments(value: unknown): NormalizedAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: NormalizedAttachment[] = [];
  for (const entry of value) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = asString(item.id) ?? asString(item.attachment_id);
    if (!id) continue;

    const dispositionRaw = asString(item.content_disposition)?.toLowerCase() ?? "";
    const disposition: NormalizedAttachment["disposition"] = dispositionRaw.startsWith("inline")
      ? "inline"
      : dispositionRaw.startsWith("attachment")
        ? "attachment"
        : "unknown";

    out.push({
      providerAttachmentId: id,
      filename: asString(item.filename) ?? asString(item.name) ?? "attachment",
      reportedMimeType: asString(item.content_type) ?? "application/octet-stream",
      sizeBytes: typeof item.size === "number" && item.size >= 0 ? item.size : 0,
      disposition,
      contentId: asString(item.content_id),
    });
  }
  return out;
}

/**
 * Headers a message must NOT carry to be treated as a human forward (§16).
 * Extracted here because the provider decides how it exposes headers.
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
      const str = asString(value);
      if (str) out[name.toLowerCase()] = str;
    }
  }
  return out;
}
