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
  | "usage_limit_exceeded"
  // ── Added during implementation; the design's list was written before the
  // pipeline existed and missed four outcomes that actually occur. ──
  /** Signature verified but the body was not a shape we can act on. */
  | "invalid_payload"
  /**
   * An auto-reply, bounce, or mailing-list message. Distinct from a rejection of
   * the sender: nothing is wrong, it simply is not an invoice. Kept separate so
   * bounce storms are visible in metrics rather than inflating
   * `sender_not_registered`.
   */
  | "automated_message"
  /**
   * The delegated refresh token no longer works — the owner signed out
   * everywhere, changed their password, or the backend revoked it. Uniquely
   * user-actionable: the fix is to re-enable forwarding for that company, so it
   * gets its own code and its own message in the settings screen.
   */
  | "credential_expired"
  /** The invoice backend refused the upload for a reason that will not change. */
  | "ingestion_failed";

/** Provider-reported authentication verdicts. Only ever provider-validated (§9). */
export type AuthVerdict = "pass" | "fail" | "neutral" | "none";

export interface EmailAuthResults {
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
}

/**
 * What the authentication headers actually looked like on one message.
 *
 * Recorded and surfaced in the settings screen because Resend does NOT report
 * SPF/DKIM/DMARC on the webhook — the verdicts above are reconstructed from the
 * `Authentication-Results` header instead (see authResults.ts). Nobody should
 * have to guess whether that header arrived: this is the evidence.
 *
 * `trust` says how much the verdicts are worth:
 *   "verified" — the header's authserv-id matched INBOUND_EXPECTED_AUTHSERV_ID.
 *   "advisory" — a header was found, but nothing proves the provider wrote it.
 *   "absent"   — no usable authentication header at all.
 *   "rejected" — a pinned authserv-id is set and no header matched it.
 */
export interface InboundAuthResultsDiagnostics {
  authenticationResults: string | null;
  receivedSpf: string | null;
  returnPath: string | null;
  authservId: string | null;
  trust: "verified" | "advisory" | "absent" | "rejected";
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
  /**
   * Envelope recipients (RCPT TO), from Resend's `received_for`. This — not
   * `to` — is what selects the workspace: a forwarded or BCC'd invoice often
   * does not name our alias in any visible header, so resolving from `to` alone
   * would drop exactly the messages this feature exists to handle.
   */
  receivedFor: string[];
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
