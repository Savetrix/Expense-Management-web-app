// SERVER-ONLY. One inbound email, end to end.
//
// This is the orchestration the architecture doc split across a webhook, a
// queue, and a worker. It runs synchronously inside the webhook instead, and
// that is a deliberate design change rather than a shortcut — the reasoning:
//
//   * Resend redelivers a failed webhook 8 times over ~32 hours (immediately,
//     5s, 5m, 30m, 2h, 5h, 10h, 10h) and lets you replay any delivery by hand
//     from its dashboard. That is a durable, at-least-once queue with
//     exponential backoff and a dead-letter UI — already built, already
//     operated. Returning 503 enqueues; returning 200 acknowledges.
//   * Every step is idempotent and its progress is persisted, so a redelivery
//     resumes rather than repeating (store.claimMessage).
//   * The work is bounded and small: at most 10 files, ≤15 MB each, one HTTP
//     upload apiece. That fits a function invocation comfortably.
//
// What the doc forbade — in-memory queues, `setTimeout`, fire-and-forget
// promises, work that dies with the request — is still forbidden, and none of it
// happens here. The difference is that the durable queue is the provider's
// rather than ours.
//
// ATTACHMENTS ARE INDEPENDENT. One unreadable file must not stop the others;
// that is what `partially_completed` is for.
import { findInboundLocalPart, normalizeEmailAddress } from "./address";
import { hashAliasLocalPart, resolveAliasHash } from "./alias";
import {
  checkEnvelopeLimits,
  isLikelyInlineAsset,
  selectCandidateAttachments,
  validateAttachment,
} from "./attachment";
import { deriveAuthResults } from "./authResults";
import { evaluateScan, readScanVerdicts } from "./scanVerdict";
import { authorizeInboundSender, isAutomatedMessage, type SenderFacts } from "./authorization";
import type { InboundEmailConfig } from "./config";
import type { IngestAuthority } from "./ingest";
import { extractHeaders, readDisposition } from "./providers/resend";
import {
  downloadAttachment,
  fetchReceivedEmail,
  listAttachments,
  type ResendAttachmentMeta,
} from "./providers/resendClient";
import {
  appendActivity,
  claimMessage,
  readAlias,
  recordEmailInvoiceIds,
  saveMessage,
  touchAliasUsed,
  type AliasRecord,
  type MessageAttachmentRecord,
  type MessageRecord,
} from "./store";
import type {
  InboundAuthResultsDiagnostics,
  InboundMessageStatus,
  NormalizedAttachment,
  NormalizedInboundEvent,
  RejectionCode,
} from "./types";

const MAX_SUBJECT_CHARS = 200;

export interface PipelineDeps {
  config: InboundEmailConfig;
  authority: IngestAuthority;
  /** Injected so tests can drive the pipeline without network access. */
  provider?: {
    fetchEmail: typeof fetchReceivedEmail;
    listAttachments: typeof listAttachments;
    download: typeof downloadAttachment;
  };
}

export type PipelineResult =
  /** Terminal. Answer 200 — the provider must not retry a permanent decision. */
  | { kind: "done"; status: InboundMessageStatus; correlationId: string; invoiceCount: number }
  | { kind: "rejected"; code: RejectionCode; correlationId: string; detail?: string }
  | { kind: "duplicate"; correlationId: string }
  /** Recorded but not processed, because the feature is off. Replayable. */
  | { kind: "deferred"; correlationId: string }
  /** Answer 503 so the provider redelivers. */
  | { kind: "retry"; correlationId: string; detail: string };

const truncateSubject = (subject: string | null): string | null =>
  subject === null ? null : subject.slice(0, MAX_SUBJECT_CHARS);

/**
 * Correlation id: stable per delivery, so a retry logs and reports under the
 * same id the user was already given, and support can follow one thread.
 * Derived rather than random for exactly that reason.
 */
export const correlationIdFor = (providerEventId: string): string =>
  `inb_${hashAliasLocalPart(providerEventId).slice(0, 20)}`;

function seedRecord(event: NormalizedInboundEvent, correlationId: string): MessageRecord {
  const now = new Date().toISOString();
  return {
    version: 1,
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerEmailId: event.providerEmailId,
    rfcMessageId: event.rfcMessageId,
    correlationId,
    aliasHash: null,
    userId: null,
    qbConnectionId: null,
    senderEmail: null,
    subjectRedacted: truncateSubject(event.subject),
    receivedAt: event.receivedAt.toISOString(),
    status: "received",
    rejectionCode: null,
    detail: null,
    attempts: 1,
    attachments: [],
    authDiagnostics: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

/** Resolve which of our addresses this mail was actually delivered to. */
export function resolveAliasCandidate(
  event: NormalizedInboundEvent,
  domain: string,
): string | null {
  // Envelope recipients first — authoritative, and present on forwards and BCCs
  // where no visible header names us. Visible headers are the fallback.
  const fromEnvelope = findInboundLocalPart(event.receivedFor, domain);
  if (fromEnvelope) return fromEnvelope;
  return findInboundLocalPart(event.recipients, domain);
}

/**
 * Merge webhook-payload attachment metadata with the richer metadata from the
 * attachments API. The API is authoritative — it carries size, disposition,
 * content-id and a fresh signed `download_url`, none of which the webhook has.
 */
function toNormalizedAttachment(meta: ResendAttachmentMeta): NormalizedAttachment {
  return {
    providerAttachmentId: meta.id,
    filename: meta.filename,
    reportedMimeType: meta.contentType,
    sizeBytes: meta.sizeBytes,
    disposition: readDisposition(meta.contentDisposition),
    contentId: meta.contentId,
  };
}

export async function processInboundEvent(
  event: NormalizedInboundEvent,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { config, authority } = deps;
  const provider = deps.provider ?? {
    fetchEmail: fetchReceivedEmail,
    listAttachments,
    download: downloadAttachment,
  };
  const correlationId = correlationIdFor(event.providerEventId);

  // ── 1. Claim the delivery ─────────────────────────────────────────────────
  const claim = await claimMessage(seedRecord(event, correlationId));
  if (claim.kind === "duplicate") return { kind: "duplicate", correlationId };
  let record = claim.record;

  // ── 2. Global kill switch ─────────────────────────────────────────────────
  // Left in a NON-terminal state on purpose (§30): the message is recorded, not
  // lost, and replaying the delivery once the flag is on picks it up.
  if (!config.enabled) {
    record = { ...record, status: "received", detail: "feature disabled" };
    await saveMessage(record);
    return { kind: "deferred", correlationId };
  }

  const finish = async (
    status: InboundMessageStatus,
    code: RejectionCode | null,
    detail: string | null,
    alias: AliasRecord | null,
    invoiceCount = 0,
  ): Promise<void> => {
    record = {
      ...record,
      status,
      rejectionCode: code,
      detail,
      completedAt: new Date().toISOString(),
    };
    await saveMessage(record);
    const owner = alias?.userId ?? record.userId;
    if (owner) {
      // Remember which invoices came from email — the backend cannot tell, so
      // this is what drives the "Email" badge on the invoice list.
      await recordEmailInvoiceIds(
        owner,
        record.attachments
          .filter((entry) => entry.status === "completed" && entry.invoiceId)
          .map((entry) => entry.invoiceId as string),
      );
      await appendActivity(owner, {
        correlationId,
        receivedAt: record.receivedAt,
        subject: record.subjectRedacted,
        senderEmail: record.senderEmail,
        status,
        rejectionCode: code,
        detail,
        invoiceCount,
        companyName: alias?.companyName ?? null,
        qbConnectionId: alias?.qbConnectionId ?? record.qbConnectionId ?? null,
        authDiagnostics: record.authDiagnostics,
      });
    }
  };

  // ── 3. Resolve the alias ──────────────────────────────────────────────────
  const localPart = resolveAliasCandidate(event, config.domain);
  const aliasHash = resolveAliasHash(localPart);
  const alias = aliasHash ? await readAlias(aliasHash) : null;

  // A malformed address and an address we do not own give the SAME answer, so a
  // prober cannot distinguish them.
  if (!alias) {
    await finish("rejected", "unknown_alias", null, null);
    return { kind: "rejected", code: "unknown_alias", correlationId };
  }

  record = {
    ...record,
    aliasHash: alias.tokenHash,
    userId: alias.userId,
    qbConnectionId: alias.qbConnectionId,
  };

  // ── 4. Fetch the message (headers, envelope recipients, attachment metadata) ─
  let fetched;
  try {
    fetched = await provider.fetchEmail(event.providerEmailId, config.providerApiKey);
  } catch {
    // Transient by classification inside the client. Do NOT mark terminal —
    // returning 503 lets the provider redeliver into a resumable record.
    record = { ...record, status: "fetching", detail: "provider fetch failed" };
    await saveMessage(record);
    return { kind: "retry", correlationId, detail: "provider-fetch-failed" };
  }
  if (!fetched) {
    await finish("rejected", "invalid_payload", "message not retrievable", alias);
    return { kind: "rejected", code: "invalid_payload", correlationId };
  }

  const headers = extractHeaders({ data: { headers: fetched.headers } });

  // ── 5. Loop and auto-responder suppression ────────────────────────────────
  // Before authorization so a bounce storm never reaches the decision table.
  if (isAutomatedMessage(headers)) {
    await finish("rejected", "automated_message", "auto-submitted or bounce", alias);
    return { kind: "rejected", code: "automated_message", correlationId };
  }

  // ── 5b. The provider's own malware scan ──────────────────────────────────
  // Resend runs on Amazon SES, which scans every message and stamps the result
  // on these headers. Checked HERE, before authorization and long before any
  // attachment is fetched, so hostile bytes are never downloaded at all.
  const scan = evaluateScan(readScanVerdicts(fetched.headers), {
    rejectSpam: process.env.INBOUND_REJECT_SPAM === "true",
    requireVirusVerdict: process.env.INBOUND_REQUIRE_VIRUS_VERDICT === "true",
  });
  if (!scan.accept) {
    await finish(
      "rejected",
      scan.reason === "malware_detected" ? "malware_detected" : "no_supported_attachments",
      scan.detail,
      alias,
    );
    return {
      kind: "rejected",
      code: scan.reason === "malware_detected" ? "malware_detected" : "no_supported_attachments",
      correlationId,
      detail: scan.detail,
    };
  }

  // ── 6. Authentication verdicts, reconstructed from headers ────────────────
  const derived = deriveAuthResults(fetched.headers, {
    expectedAuthservId: process.env.INBOUND_EXPECTED_AUTHSERV_ID ?? null,
  });
  const authDiagnostics: InboundAuthResultsDiagnostics = derived.diagnostics;
  record = { ...record, authDiagnostics };

  // Return-Path stands in for the envelope sender Resend does not expose.
  const envelopeSender = normalizeEmailAddress(derived.diagnostics.returnPath);
  const fromAddress = normalizeEmailAddress(fetched.from) ?? event.from;

  // ── 7. Sender authorization ───────────────────────────────────────────────
  const senderFacts = await resolveSenderFacts(alias, envelopeSender, fromAddress);

  const decision = authorizeInboundSender({
    featureEnabled: config.enabled,
    alias: { active: alias.active, workspaceId: alias.qbConnectionId, tenantEnabled: alias.active },
    envelopeSender,
    from: fromAddress,
    sender: senderFacts,
    authResults: derived.results,
    authResultsMissing: derived.missing,
    requireEmailAuth: config.requireEmailAuth,
    withinUsageLimits: true,
  });

  if (!decision.authorized) {
    record = { ...record, senderEmail: envelopeSender ?? fromAddress ?? null };
    await finish("rejected", decision.code, decision.detail ?? null, alias);
    return { kind: "rejected", code: decision.code, correlationId, detail: decision.detail };
  }

  record = { ...record, senderEmail: decision.senderEmail, status: "processing" };
  await saveMessage(record);
  await touchAliasUsed(alias.tokenHash);

  // ── 8. Attachment metadata with fresh download URLs ───────────────────────
  // Re-listed on every attempt: `download_url` is signed and expires, so a URL
  // captured on attempt 1 is useless to the 10-hour retry.
  let metas: ResendAttachmentMeta[];
  try {
    metas = await provider.listAttachments(
      event.providerEmailId,
      config.providerApiKey,
      config.limits.maxAttachments,
    );
  } catch {
    record = { ...record, status: "fetching", detail: "attachment listing failed" };
    await saveMessage(record);
    return { kind: "retry", correlationId, detail: "attachment-list-failed" };
  }

  // Fall back to the webhook's thinner list if the API returned nothing but the
  // webhook said there were files — better to try than to drop the invoice.
  const allAttachments =
    metas.length > 0 ? metas.map(toNormalizedAttachment) : event.attachments;

  const envelopeCheck = checkEnvelopeLimits(allAttachments, config.limits);
  if (!envelopeCheck.ok) {
    await finish("rejected", envelopeCheck.code, envelopeCheck.detail ?? null, alias);
    return { kind: "rejected", code: envelopeCheck.code, correlationId };
  }

  const candidates = selectCandidateAttachments(allAttachments);
  if (candidates.length === 0) {
    await finish("rejected", "no_supported_attachments", "only inline assets", alias);
    return { kind: "rejected", code: "no_supported_attachments", correlationId };
  }

  // ── 9. Authority to create invoices in this company ──────────────────────
  // A dedicated service account, cached for days (serviceAccount.ts). Nothing
  // belonging to the accountant is stored or spent here — which is why signing
  // in on another device can no longer break their forwarding.
  const acquired = await authority.acquire(alias.qbConnectionId);
  if (!acquired.ok) {
    if (acquired.reason === "unauthorized") {
      await finish("rejected", "credential_expired", acquired.detail, alias);
      return { kind: "rejected", code: "credential_expired", correlationId };
    }
    record = { ...record, detail: acquired.detail };
    await saveMessage(record);
    return { kind: "retry", correlationId, detail: acquired.detail };
  }
  const accessToken = acquired.accessToken;

  // ── 10. Per attachment: download, validate, ingest ────────────────────────
  const downloadUrlById = new Map(metas.map((meta) => [meta.id, meta.downloadUrl]));
  const results: MessageAttachmentRecord[] = [];
  let transientSeen: string | null = null;

  for (const attachment of candidates) {
    const previous = record.attachments.find(
      (entry) => entry.providerAttachmentId === attachment.providerAttachmentId,
    );

    // Already finished on an earlier attempt — never redo it.
    if (previous && (previous.status === "completed" || previous.status === "rejected")) {
      results.push(previous);
      continue;
    }

    // AMBIGUOUS. A previous attempt posted this file and died before recording
    // the outcome, so we do not know whether an invoice exists. We deliberately
    // DO NOT re-post: the backend has no dedupe on
    // (connection, vendor, invoice number) — see BACKEND_duplicate-bills.md —
    // so a re-post risks a second bill in QuickBooks. This is the same policy
    // src/lib/api.ts applies to a write that 401s: never re-send a write whose
    // outcome is unknown. Surfaced to the user instead.
    if (previous && previous.status === "ingesting") {
      results.push({
        ...previous,
        status: "failed",
        detail: "upload outcome unknown; not retried to avoid a duplicate bill",
      });
      continue;
    }

    const base: MessageAttachmentRecord = {
      sha256: null,
      providerAttachmentId: attachment.providerAttachmentId,
      sanitizedFilename: attachment.filename,
      status: "validating",
      rejectionCode: null,
      detail: null,
      invoiceId: null,
    };

    const downloadUrl = downloadUrlById.get(attachment.providerAttachmentId) ?? null;
    if (!downloadUrl) {
      results.push({
        ...base,
        status: "rejected",
        rejectionCode: "attachment_download_failed",
        detail: "no download url",
      });
      transientSeen = transientSeen ?? "missing-download-url";
      continue;
    }

    const downloaded = await provider.download(downloadUrl, config.limits.maxFileBytes);
    if (!downloaded.ok) {
      if (downloaded.transient) {
        results.push({ ...base, status: "pending", detail: downloaded.reason });
        transientSeen = transientSeen ?? downloaded.reason;
      } else {
        // Only a size refusal is genuinely about the file. Everything else
        // here is a retrieval problem on our side or the provider's, and
        // calling it "unsupported file type" blames the sender's PDF for our
        // own allow-list.
        results.push({
          ...base,
          status: "rejected",
          rejectionCode: downloaded.reason.startsWith("too-large")
            ? "file_too_large"
            : "attachment_download_failed",
          detail: downloaded.reason,
        });
      }
      continue;
    }

    const validated = validateAttachment(attachment, downloaded.bytes, config.limits);
    if (!validated.ok) {
      results.push({
        ...base,
        status: "rejected",
        rejectionCode: validated.code,
        detail: validated.detail ?? null,
      });
      continue;
    }

    // Now that the real bytes and size are known, re-apply the inline-asset
    // heuristic: the webhook's metadata reported size 0, so a signature logo
    // could not be recognised until here.
    if (
      isLikelyInlineAsset({ ...attachment, sizeBytes: validated.value.sizeBytes }) &&
      validated.value.detectedMimeType !== "application/pdf"
    ) {
      results.push({
        ...base,
        sha256: validated.value.sha256,
        sanitizedFilename: validated.value.sanitizedFilename,
        status: "rejected",
        rejectionCode: "no_supported_attachments",
        detail: "inline asset",
      });
      continue;
    }

    // Tenant-level duplicate: the same bytes already ingested for this message.
    if (results.some((entry) => entry.sha256 === validated.value.sha256)) {
      results.push({
        ...base,
        sha256: validated.value.sha256,
        sanitizedFilename: validated.value.sanitizedFilename,
        status: "rejected",
        rejectionCode: "duplicate_attachment",
        detail: "same bytes twice in one email",
      });
      continue;
    }

    // Persist "ingesting" BEFORE the upload. This write is what makes the
    // ambiguity above detectable at all — without it, a crash mid-upload is
    // indistinguishable from never having tried.
    const ingesting: MessageAttachmentRecord = {
      ...base,
      sha256: validated.value.sha256,
      sanitizedFilename: validated.value.sanitizedFilename,
      status: "ingesting",
    };
    record = { ...record, attachments: [...results, ingesting] };
    await saveMessage(record);

    const upload = await authority.uploadInvoice(
      {
        bytes: downloaded.bytes,
        filename: validated.value.sanitizedFilename,
        mimeType: validated.value.detectedMimeType,
      },
      accessToken,
      alias.qbConnectionId,
    );

    if (upload.ok) {
      results.push({ ...ingesting, status: "completed", invoiceId: upload.invoiceId });
    } else if (upload.transient) {
      // Reset to pending so the retry re-uploads: a transient failure means the
      // request did not land, which is materially different from "unknown".
      results.push({ ...ingesting, status: "pending", detail: upload.detail });
      transientSeen = transientSeen ?? upload.detail;
    } else {
      results.push({
        ...ingesting,
        status: "rejected",
        rejectionCode: "ingestion_failed",
        detail: upload.detail,
      });
    }

    record = { ...record, attachments: results };
    await saveMessage(record);
  }

  record = { ...record, attachments: results };

  // ── 11. Message-level outcome ─────────────────────────────────────────────
  const completed = results.filter((entry) => entry.status === "completed").length;
  const stillPending = results.some((entry) => entry.status === "pending");

  if (stillPending && completed === 0) {
    // Nothing landed and something is retryable — ask for redelivery.
    record = { ...record, status: "processing", detail: transientSeen };
    await saveMessage(record);
    return { kind: "retry", correlationId, detail: transientSeen ?? "attachment-retry" };
  }

  if (stillPending) {
    // Some invoices exist, some files still need another attempt. Retrying is
    // safe: completed attachments are skipped by the loop above.
    record = { ...record, status: "processing", detail: transientSeen };
    await saveMessage(record);
    return { kind: "retry", correlationId, detail: transientSeen ?? "partial-retry" };
  }

  if (completed === 0) {
    const firstCode = results.find((entry) => entry.rejectionCode)?.rejectionCode ?? null;
    await finish("rejected", firstCode ?? "no_supported_attachments", "no attachment ingested", alias);
    return { kind: "rejected", code: firstCode ?? "no_supported_attachments", correlationId };
  }

  const status: InboundMessageStatus =
    completed === results.length ? "completed" : "partially_completed";
  await finish(status, null, `${completed} of ${results.length} ingested`, alias, completed);
  return { kind: "done", status, correlationId, invoiceCount: completed };
}

/**
 * Who is allowed to forward to this address.
 *
 * There is no "look up a user by email address" endpoint on the Savetrix API, so
 * the authorized set is captured at enable time instead: the alias stores the
 * owner's account email, read SERVER-SIDE from their profile (never supplied by
 * the browser — see the alias route). Additional senders are opt-in per alias.
 *
 * This is a tighter rule than §8's "any registered user with upload permission",
 * and tighter is the right direction: the owner explicitly nominated who may
 * forward into their books. It also means the check needs no network call in the
 * common case.
 */
async function resolveSenderFacts(
  alias: AliasRecord,
  envelopeSender: string | null,
  fromAddress: string | null,
): Promise<SenderFacts | null> {
  // MUST mirror authorizeInboundSender's own expression exactly. It computes
  // `normalize(envelopeSender) ?? normalize(from)`, so a non-null but
  // unparseable Return-Path makes it fall through to From — and if we resolved a
  // different address here than it compares there, the two would disagree and
  // the match below would be meaningless.
  const normalizedClaimed =
    normalizeEmailAddress(envelopeSender) ?? normalizeEmailAddress(fromAddress);
  if (!normalizedClaimed) return null;

  const authorized = aliasAuthorizedSenders(alias);
  if (authorized.length === 0) return null;

  // Lowercased on both sides. RFC 5321 makes the local-part case-sensitive and
  // normalizeEmailAddress rightly preserves it, but these are our own users'
  // real mailboxes at providers that all treat local-parts case-insensitively,
  // and mail clients rewrite case freely — so `Nikhil@corp.com` must match a
  // stored `nikhil@corp.com` rather than being refused.
  const target = normalizedClaimed.toLowerCase();
  const matches = authorized.some(
    (candidate) => normalizeEmailAddress(candidate)?.toLowerCase() === target,
  );
  if (!matches) {
    // Deliberately the same answer an unknown address gets: never reveal whether
    // the sender has a Scantrix account.
    return null;
  }

  return {
    userId: alias.userId,
    // The identity match is decided above, where the allow-list lives; this hands
    // authorizeInboundSender the address in the exact form it will compare, so
    // its remaining checks (alias active, account state, email-auth policy,
    // quota) all still run and still gate the outcome.
    verifiedEmails: [normalizedClaimed],
    active: true,
    uploadableWorkspaceIds: [alias.qbConnectionId],
  };
}

/** Owner plus any explicitly added senders. */
export function aliasAuthorizedSenders(alias: AliasRecord): string[] {
  const out: string[] = [];
  if (alias.ownerEmail) out.push(alias.ownerEmail);
  for (const extra of alias.additionalSenders ?? []) out.push(extra);
  return out;
}
