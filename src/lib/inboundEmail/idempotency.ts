// SERVER-ONLY. Idempotency keys and retry classification (§18, §19).
//
// Delivery is at-least-once at every hop — provider webhook, queue, and the
// ingestion call — so "did I already do this?" has to be answerable from stable
// inputs rather than from whether some earlier attempt happened to finish.
import type { RejectionCode } from "./types";

/** One inbound message. The provider event id is the outermost unique key. */
export function messageIdempotencyKey(providerEmailId: string): string {
  return `inbound:${providerEmailId}`;
}

/**
 * One attachment within one message, keyed by content hash rather than by
 * filename or index: the same bytes re-delivered are the same work, and two
 * different files that happen to share a name are not.
 */
export function attachmentIdempotencyKey(providerEmailId: string, sha256: string): string {
  return `inbound:${providerEmailId}:${sha256}`;
}

/**
 * Key handed to the shared ingestion operation, so a retried worker cannot create a
 * second invoice from bytes that already produced one.
 */
export function ingestIdempotencyKey(providerEmailId: string, sha256: string): string {
  return attachmentIdempotencyKey(providerEmailId, sha256);
}

/** Retry only what could plausibly succeed later. Everything else is terminal. */
export type FailureClass = "retryable" | "permanent";

const PERMANENT_CODES: ReadonlySet<RejectionCode> = new Set<RejectionCode>([
  "invalid_signature",
  "stale_timestamp",
  "unknown_alias",
  "feature_disabled",
  "sender_not_registered",
  "sender_not_verified",
  "sender_not_authorized",
  "account_inactive",
  "ambiguous_workspace",
  "authentication_failed",
  "no_supported_attachments",
  "file_too_large",
  "too_many_attachments",
  "unsupported_file_type",
  "content_type_mismatch",
  "malware_detected",
  "duplicate_event",
  "duplicate_attachment",
  "invalid_payload",
  "automated_message",
  // The stored delegation is dead until a human re-enables forwarding, so
  // retrying it for 32 hours would only burn provider quota.
  "credential_expired",
  // Reached only after classifyHttpFailure already ruled the backend's refusal
  // permanent; a retryable upload failure never becomes this code.
  "ingestion_failed",
  // A refused host or a redirect will be refused identically next time.
  "attachment_download_failed",
]);

/**
 * A rejection code is permanent by policy — retrying an unauthorized sender just
 * burns provider quota. `usage_limit_exceeded` is the exception: quotas reset.
 */
export function classifyRejection(code: RejectionCode): FailureClass {
  return PERMANENT_CODES.has(code) ? "permanent" : "retryable";
}

/**
 * Classify a transport/HTTP failure from the provider or the invoice backend.
 * 429 and 5xx are worth another attempt; 4xx means the request itself is wrong and
 * repeating it verbatim will fail identically.
 */
export function classifyHttpFailure(status: number | null | undefined): FailureClass {
  if (typeof status !== "number") return "retryable"; // network error / timeout
  if (status === 408 || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  return "permanent";
}

export interface BackoffOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseSeconds?: number;
  maxSeconds?: number;
}

/**
 * Delay before attempt `attempt` (1-based). Exponential with a cap, so a provider
 * outage does not turn into a tight retry loop. Returns null once attempts are
 * exhausted, which is the caller's signal to dead-letter.
 */
export function nextRetryDelaySeconds(
  attempt: number,
  options: BackoffOptions = {},
): number | null {
  const maxAttempts = options.maxAttempts ?? 5;
  const base = options.baseSeconds ?? 60;
  const max = options.maxSeconds ?? 6 * 60 * 60;
  if (attempt < 1) return base;
  if (attempt >= maxAttempts) return null;
  return Math.min(base * Math.pow(5, attempt - 1), max);
}
