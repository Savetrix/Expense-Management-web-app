// SERVER-ONLY. Shared vocabulary for inbound-email invoice ingestion.
//
// See EMAIL_INVOICE_INGESTION_ARCHITECTURE.md. Everything in this directory is
// deliberately pure and I/O-free: the durable pieces (database, queue, worker,
// the trusted ingestion call) live in the Savetrix backend, which is not in this
// workspace, so this logic has to be portable to it rather than tied to Next.js.

/** Explicit message state. Never inferred from nullable columns (§17). */
export type InboundMessageStatus =
  | "received"
  | "authorized"
  | "queued"
  | "fetching"
  | "processing"
  | "partially_completed"
  | "completed"
  | "rejected"
  | "failed"
  | "dead_lettered";

export type InboundAttachmentStatus =
  | "pending"
  | "validating"
  | "stored"
  | "ingesting"
  | "completed"
  | "rejected"
  | "failed";

/**
 * Why a message or attachment was refused. A closed union rather than free text
 * so callers branch on a value instead of comparing strings, and so metrics can
 * group by reason (§24).
 */
export type RejectionCode =
  | "invalid_signature"
  | "stale_timestamp"
  | "unknown_alias"
  | "feature_disabled"
  | "sender_not_registered"
  | "sender_not_verified"
  | "sender_not_authorized"
  | "account_inactive"
  | "ambiguous_workspace"
  | "authentication_failed"
  | "no_supported_attachments"
  | "file_too_large"
  | "too_many_attachments"
  | "unsupported_file_type"
  | "content_type_mismatch"
  | "malware_detected"
  | "duplicate_event"
  | "duplicate_attachment"
  | "usage_limit_exceeded";

/** Provider-reported authentication verdicts. Only ever provider-validated (§9). */
export type AuthVerdict = "pass" | "fail" | "neutral" | "none";

export interface EmailAuthResults {
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
}

/** Attachment metadata as the provider describes it — none of it trusted (§10). */
export interface NormalizedAttachment {
  providerAttachmentId: string;
  /** Exactly as the sender named it. Sanitize before use. */
  filename: string;
  /** What the provider *claims* the type is. Cross-checked against magic bytes. */
  reportedMimeType: string;
  sizeBytes: number;
  disposition: "attachment" | "inline" | "unknown";
  contentId: string | null;
}

/**
 * Provider-agnostic view of one inbound email. Adding a provider means writing a
 * new adapter that produces this shape; nothing downstream changes (§7 of the brief).
 */
export interface NormalizedInboundEvent {
  provider: string;
  providerEventId: string;
  providerEmailId: string;
  rfcMessageId: string | null;
  receivedAt: Date;
  /** Provider-validated envelope sender (MAIL FROM), when exposed. */
  envelopeSender: string | null;
  /** Parsed address from the outer `From`. Display names already discarded. */
  from: string | null;
  sender: string | null;
  returnPath: string | null;
  recipients: string[];
  subject: string | null;
  authResults: EmailAuthResults;
  attachments: NormalizedAttachment[];
  /** Only the fields needed for audit/replay — never the body (§25). */
  providerMetadata: Record<string, string | number | boolean | null>;
}

/**
 * A refusal that is a policy decision, not a bug. The webhook answers 2xx for
 * these so the provider stops retrying a permanent outcome (§13).
 */
export class InboundRejection extends Error {
  readonly code: RejectionCode;
  /** Safe for logs and metrics: no addresses, filenames, or content. */
  readonly detail?: string;

  constructor(code: RejectionCode, detail?: string) {
    super(`inbound rejected: ${code}`);
    this.name = "InboundRejection";
    this.code = code;
    this.detail = detail;
  }
}

/** Something transient failed. The provider or queue should retry (§19). */
export class InboundTransientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "InboundTransientError";
  }
}

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: RejectionCode; detail?: string };
