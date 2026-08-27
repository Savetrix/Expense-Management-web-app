// Inbound-email webhook. The provider's only entry point into this app.
//
// ORDER OF OPERATIONS IS LOAD-BEARING (§13):
//   read raw body -> verify signature -> verify timestamp -> parse JSON -> validate
// Parsing before verifying would run the JSON parser, and every line after it,
// on input nobody has authenticated. `request.text()` is read first and the
// signature is computed over that exact string — never over a re-serialized
// object, which would not match the bytes the provider signed.
//
// STATUS CODES ARE A CONTROL CHANNEL, NOT DECORATION. Resend redelivers on
// failure 8 times over ~32 hours and lets an operator replay any delivery from
// its dashboard, so:
//   * 200 = "settled, never send this again" — including every policy rejection.
//     A rejected sender is a permanent decision; retrying it for 32 hours would
//     burn provider quota and flood logs to no purpose.
//   * 503 = "not settled, please redeliver" — only for failures BEFORE the work
//     is durably settled: store unreachable, provider fetch failed, upload
//     failed transiently.
//   * 401 = bad signature or stale timestamp. Not retryable, and it must not
//     look like a server problem.
//
// NOTHING SENSITIVE IS LOGGED (§24): no bodies, no attachment bytes, no
// extracted financial data, no tokens, no signatures, no download URLs. Lines
// carry the correlation id and a structural outcome, in the `[inbound]` style
// src/app/api/chat/route.ts established.
export const runtime = "nodejs";
// Bounded by the envelope caps: at most 10 files, one upload each. Well inside
// this budget in practice; a genuinely slow provider trips the 503 path and is
// redelivered rather than being allowed to run long.
export const maxDuration = 300;

import { readInboundConfig } from "@/lib/inboundEmail/config";
import { RefreshTokenAuthority } from "@/lib/inboundEmail/ingest";
import { correlationIdFor, processInboundEvent } from "@/lib/inboundEmail/pipeline";
import { normalizeResendEvent } from "@/lib/inboundEmail/providers/resend";
import { verifyWebhookSignature } from "@/lib/inboundEmail/signature";
import { InboundStoreError } from "@/lib/inboundEmail/store";
import { InboundTransientError } from "@/lib/inboundEmail/types";

/**
 * A provider webhook body is metadata only — ids, addresses, a subject and an
 * attachment list. Attachment bytes never travel in it. Anything this large is
 * not a shape we produce a useful answer for, and refusing early keeps a hostile
 * body from being read into memory at all.
 */
const MAX_BODY_BYTES = 1_000_000;

/** No body, so a misconfigured endpoint cannot be probed for its shape. */
const ok = (payload: Record<string, unknown>) =>
  Response.json(payload, { status: 200, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  // ── Config first ─────────────────────────────────────────────────────────
  // A missing signing secret means we cannot authenticate anything, so there is
  // no safe way to proceed. 503 (not 500) because it IS recoverable: set the
  // variable, and the provider's redelivery picks the message up. Mail is not
  // lost to a deploy that forgot an env var.
  const configOutcome = readInboundConfig();
  if (!configOutcome.ok) {
    console.log(
      "[inbound] misconfigured:",
      configOutcome.missing.join(",") || configOutcome.detail || "unknown",
    );
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }
  const config = configOutcome.config;

  // ── Raw body, then signature ─────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const svixId = request.headers.get("svix-id")?.trim() ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const svixSignature = request.headers.get("svix-signature")?.trim() ?? "";

  const verdict = verifyWebhookSignature(
    rawBody,
    { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
    { secret: config.webhookSigningSecret, toleranceSeconds: config.toleranceSeconds },
  );
  if (!verdict.ok) {
    // Deliberately indistinguishable to a caller guessing secrets: same status,
    // same shape. The reason is logged, not returned.
    console.log("[inbound] signature rejected:", verdict.reason);
    return Response.json({ error: verdict.reason }, { status: 401 });
  }

  // ── Only now is it safe to parse ─────────────────────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const normalized = normalizeResendEvent(payload, { deliveryId: svixId });
  if (!normalized.ok) {
    console.log("[inbound] invalid payload:", normalized.detail ?? normalized.code);
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { eventType, event } = normalized.value;
  if (!event) {
    // A signed event we simply do not act on (a delivery report, a future event
    // type). Acknowledge so it is not retried.
    console.log("[inbound] ignored event type:", eventType ?? "unknown");
    return ok({ status: "ignored" });
  }

  const correlationId = correlationIdFor(event.providerEventId);

  try {
    const result = await processInboundEvent(event, {
      config,
      authority: new RefreshTokenAuthority(config.tokenEncryptionKey),
    });

    switch (result.kind) {
      case "done":
        console.log(`[inbound] ${correlationId} ${result.status} invoices=${result.invoiceCount}`);
        return ok({ status: result.status, correlationId });

      case "rejected":
        // A policy decision, and permanent. 200 stops the retry cycle.
        console.log(`[inbound] ${correlationId} rejected=${result.code}${result.detail ? ` (${result.detail})` : ""}`);
        return ok({ status: "rejected", reason: result.code, correlationId });

      case "duplicate":
        console.log(`[inbound] ${correlationId} duplicate`);
        return ok({ status: "duplicate", correlationId });

      case "deferred":
        console.log(`[inbound] ${correlationId} recorded but feature disabled`);
        return ok({ status: "recorded", correlationId });

      case "retry":
        // Nothing durable was settled. Ask for redelivery.
        console.log(`[inbound] ${correlationId} retry=${result.detail}`);
        return Response.json(
          { error: "temporarily_unavailable", correlationId },
          { status: 503 },
        );
    }
  } catch (error) {
    // Store unreachable or an explicitly transient provider failure: both mean
    // "we could not settle this", so hand it back to the provider's queue.
    if (error instanceof InboundStoreError || error instanceof InboundTransientError) {
      console.log(`[inbound] ${correlationId} transient:`, error.message);
      return Response.json({ error: "temporarily_unavailable", correlationId }, { status: 503 });
    }

    // Unknown failure. Also retryable — a bug that loses an accountant's invoice
    // silently is worse than one that redelivers a few times while we fix it.
    console.log(
      `[inbound] ${correlationId} unhandled:`,
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json({ error: "temporarily_unavailable", correlationId }, { status: 503 });
  }
}

/**
 * Some providers probe the endpoint with a GET before saving it. Answer plainly
 * without revealing configuration.
 */
export async function GET() {
  return Response.json({ status: "ready" }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
