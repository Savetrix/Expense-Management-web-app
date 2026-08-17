// Tests for inbound-email invoice ingestion domain logic.
// See EMAIL_INVOICE_INGESTION_ARCHITECTURE.md §26.
//
// These cover the security-bearing decisions: which string counts as the sender,
// which bytes count as a PDF, which alias resolves, and what may be retried. The
// durable pieces (DB, queue, worker) live in the backend and are not exercised here.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  domainOf,
  findInboundLocalPart,
  normalizeEmailAddress,
  parseEmailAddress,
  sameDomain,
} from "../lib/inboundEmail/address";
import {
  aliasHashMatches,
  extractAliasToken,
  formatAliasAddress,
  hashAliasToken,
  mintAliasToken,
  resolveAliasHash,
} from "../lib/inboundEmail/alias";
import {
  authorizeInboundSender,
  evaluateEmailAuthentication,
  isAutomatedMessage,
  type AuthorizationInput,
} from "../lib/inboundEmail/authorization";
import {
  checkEnvelopeLimits,
  detectForbiddenFormat,
  detectMimeType,
  isLikelyInlineAsset,
  sanitizeFilename,
  selectCandidateAttachments,
  validateAttachment,
} from "../lib/inboundEmail/attachment";
import {
  attachmentIdempotencyKey,
  classifyHttpFailure,
  classifyRejection,
  messageIdempotencyKey,
  nextRetryDelaySeconds,
} from "../lib/inboundEmail/idempotency";
import { verifyWebhookSignature } from "../lib/inboundEmail/signature";
import { extractHeaders, normalizeResendEvent } from "../lib/inboundEmail/providers/resend";
import type { NormalizedAttachment } from "../lib/inboundEmail/types";
import { createHmac } from "node:crypto";

// ── address parsing ────────────────────────────────────────────────────────
describe("email address parsing", () => {
  it("takes the addr-spec, never the display name", () => {
    // The whole point: a friendly name must not be able to impersonate anyone.
    assert.equal(parseEmailAddress('"Nikhil Savetrix" <attacker@evil.com>'), "attacker@evil.com");
    assert.equal(parseEmailAddress("Nikhil <nikhil@savetrix.com>"), "nikhil@savetrix.com");
    assert.equal(parseEmailAddress("nikhil@savetrix.com"), "nikhil@savetrix.com");
  });

  it("is not fooled by an @ inside a quoted display name", () => {
    assert.equal(
      parseEmailAddress('"nikhil@savetrix.com" <attacker@evil.com>'),
      "attacker@evil.com",
    );
  });

  it("refuses a list rather than picking one arbitrarily", () => {
    assert.equal(parseEmailAddress("a@b.com, c@d.com"), null);
  });

  it("rejects malformed and injection-shaped input", () => {
    for (const bad of [
      "", "   ", "no-at-sign", "a@@b.com", "@nodomain.com", "a@", "a@nodot",
      "a b@c.com", "a@b..com", "a@.b.com", "a@b.com.", "..a@b.com", null, undefined,
      "a@b.com\nBcc: victim@x.com",
    ]) {
      assert.equal(parseEmailAddress(bad as string), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  it("lowercases the domain but preserves local-part case", () => {
    // RFC 5321 makes the local-part case-sensitive; lowercasing it could match a
    // different real mailbox.
    assert.equal(normalizeEmailAddress("Nikhil@SaveTrix.COM"), "Nikhil@savetrix.com");
  });

  it("strips a +tag only when asked", () => {
    assert.equal(normalizeEmailAddress("a+invoices@b.com"), "a+invoices@b.com");
    assert.equal(normalizeEmailAddress("a+invoices@b.com", { stripPlusTag: true }), "a@b.com");
  });

  it("compares domains case-insensitively", () => {
    assert.equal(sameDomain("a@Example.com", "b@example.COM"), true);
    assert.equal(sameDomain("a@example.com", "b@evil.com"), false);
    assert.equal(sameDomain(null, "b@example.com"), false);
    assert.equal(domainOf("Nikhil <a@Example.COM>"), "example.com");
  });

  it("finds the inbound recipient among unrelated ones", () => {
    const recipients = ["boss@client.com", "inv-abc@in.scantrix.ai", "cc@other.com"];
    assert.equal(findInboundLocalPart(recipients, "in.scantrix.ai"), "inv-abc");
    assert.equal(findInboundLocalPart(recipients, "@in.scantrix.ai"), "inv-abc");
    // An address on any other domain must never select a workspace.
    assert.equal(findInboundLocalPart(["inv-abc@evil.com"], "in.scantrix.ai"), null);
  });
});

// ── alias tokens ───────────────────────────────────────────────────────────
describe("inbound alias tokens", () => {
  it("mints unguessable, non-encoding tokens", () => {
    const a = mintAliasToken();
    const b = mintAliasToken();
    assert.equal(a.token.length, 32);
    assert.notEqual(a.token, b.token);
    assert.match(a.localPart, /^inv-[a-z0-9]{32}$/);
    // Nothing about the tenant may be recoverable from the address.
    assert.equal(a.token.includes("savetrix"), false);
  });

  it("stores only a hash, and the hash is stable", () => {
    const { token, tokenHash } = mintAliasToken();
    assert.equal(tokenHash.length, 64);
    assert.notEqual(tokenHash, token);
    assert.equal(hashAliasToken(token), tokenHash);
  });

  it("resolves a local-part to the stored hash", () => {
    const { token, tokenHash, localPart } = mintAliasToken();
    assert.equal(resolveAliasHash(localPart), tokenHash);
    assert.equal(resolveAliasHash(localPart.toUpperCase()), tokenHash);
    assert.equal(extractAliasToken(localPart), token);
  });

  it("rejects local-parts that are not ours", () => {
    for (const bad of ["support", "inv-", "inv-tooshort", "invoices@x", `inv-${"z".repeat(33)}`, null]) {
      assert.equal(resolveAliasHash(bad as string), null, `should reject ${bad}`);
    }
    // 'i' is not in the alphabet, so a same-length lookalike still fails.
    assert.equal(extractAliasToken(`inv-${"i".repeat(32)}`), null);
  });

  it("compares hashes without leaking via length or early exit", () => {
    const h = hashAliasToken("abc");
    assert.equal(aliasHashMatches(h, h), true);
    assert.equal(aliasHashMatches(h, hashAliasToken("abd")), false);
    assert.equal(aliasHashMatches("short", h), false);
  });

  it("formats the receiving address", () => {
    assert.equal(formatAliasAddress("inv-abc", "in.scantrix.ai"), "inv-abc@in.scantrix.ai");
    assert.equal(formatAliasAddress("inv-abc", "@In.Scantrix.AI"), "inv-abc@in.scantrix.ai");
  });
});

// ── sender authorization ───────────────────────────────────────────────────
describe("sender authorization", () => {
  const base = (): AuthorizationInput => ({
    featureEnabled: true,
    alias: { active: true, workspaceId: "ws-1", tenantEnabled: true },
    envelopeSender: "nikhil@savetrix.com",
    from: "nikhil@savetrix.com",
    sender: {
      userId: "user-1",
      verifiedEmails: ["nikhil@savetrix.com"],
      active: true,
      uploadableWorkspaceIds: ["ws-1"],
    },
    authResults: { spf: "pass", dkim: "pass", dmarc: "pass" },
    requireEmailAuth: true,
    withinUsageLimits: true,
  });

  it("authorizes a verified, active, permitted sender", () => {
    const d = authorizeInboundSender(base());
    assert.equal(d.authorized, true);
    if (d.authorized) {
      assert.equal(d.userId, "user-1");
      assert.equal(d.workspaceId, "ws-1");
      assert.equal(d.senderEmail, "nikhil@savetrix.com");
    }
  });

  const denials: ReadonlyArray<[string, Partial<AuthorizationInput>, string]> = [
    ["feature off globally", { featureEnabled: false }, "feature_disabled"],
    ["feature off for tenant", { alias: { active: true, workspaceId: "ws-1", tenantEnabled: false } }, "feature_disabled"],
    ["unknown alias", { alias: null }, "unknown_alias"],
    ["revoked alias", { alias: { active: false, workspaceId: "ws-1", tenantEnabled: true } }, "unknown_alias"],
    ["sender not registered", { sender: null }, "sender_not_registered"],
    ["unparseable sender", { envelopeSender: null, from: "not-an-email" }, "sender_not_registered"],
    ["over quota", { withinUsageLimits: false }, "usage_limit_exceeded"],
  ];

  for (const [label, patch, code] of denials) {
    it(`denies: ${label}`, () => {
      const d = authorizeInboundSender({ ...base(), ...patch });
      assert.equal(d.authorized, false);
      if (!d.authorized) assert.equal(d.code, code);
    });
  }

  it("distinguishes unverified from unregistered", () => {
    const d = authorizeInboundSender({
      ...base(),
      sender: {
        userId: "user-1",
        verifiedEmails: [],
        unverifiedEmails: ["nikhil@savetrix.com"],
        active: true,
        uploadableWorkspaceIds: ["ws-1"],
      },
    });
    assert.equal(d.authorized, false);
    // "verify your email" is actionable; "not registered" is not.
    if (!d.authorized) assert.equal(d.code, "sender_not_verified");
  });

  it("denies a suspended or deleted account", () => {
    for (const patch of [{ suspended: true }, { deleted: true }, { active: false }]) {
      const d = authorizeInboundSender({
        ...base(),
        sender: { ...base().sender!, ...patch },
      });
      assert.equal(d.authorized, false);
      if (!d.authorized) assert.equal(d.code, "account_inactive");
    }
  });

  it("denies a real user who lacks access to THIS workspace", () => {
    const d = authorizeInboundSender({
      ...base(),
      sender: { ...base().sender!, uploadableWorkspaceIds: ["ws-other"] },
    });
    assert.equal(d.authorized, false);
    if (!d.authorized) assert.equal(d.code, "sender_not_authorized");
  });

  it("prefers the provider-validated envelope sender over the From header", () => {
    // From is spoofed to a legitimate user; the envelope is the attacker.
    const d = authorizeInboundSender({
      ...base(),
      envelopeSender: "attacker@evil.com",
      from: "nikhil@savetrix.com",
    });
    assert.equal(d.authorized, false);
    if (!d.authorized) assert.equal(d.code, "sender_not_registered");
  });

  it("checks the alias before the sender, so probes cannot enumerate accounts", () => {
    const d = authorizeInboundSender({ ...base(), alias: null, sender: null });
    assert.equal(d.authorized, false);
    if (!d.authorized) assert.equal(d.code, "unknown_alias");
  });
});

// ── email authentication policy ────────────────────────────────────────────
describe("email authentication policy", () => {
  const evaluate = (
    results: { spf: string; dkim: string; dmarc: string },
    extra: { envelopeSender?: string; from?: string; requireEmailAuth?: boolean } = {},
  ) =>
    evaluateEmailAuthentication({
      results: results as never,
      missing: false,
      requireEmailAuth: extra.requireEmailAuth ?? true,
      envelopeSender: extra.envelopeSender ?? "a@example.com",
      from: extra.from ?? "a@example.com",
    });

  it("accepts DMARC pass and rejects DMARC fail", () => {
    assert.equal(evaluate({ spf: "fail", dkim: "fail", dmarc: "pass" }).acceptable, true);
    assert.equal(evaluate({ spf: "pass", dkim: "pass", dmarc: "fail" }).acceptable, false);
  });

  it("accepts DKIM-only — forwarding legitimately breaks SPF", () => {
    assert.equal(evaluate({ spf: "fail", dkim: "pass", dmarc: "none" }).acceptable, true);
  });

  it("accepts SPF-only only when envelope and From domains agree", () => {
    assert.equal(
      evaluate({ spf: "pass", dkim: "none", dmarc: "none" }, { envelopeSender: "a@x.com", from: "b@x.com" })
        .acceptable,
      true,
    );
    assert.equal(
      evaluate({ spf: "pass", dkim: "none", dmarc: "none" }, { envelopeSender: "a@x.com", from: "b@evil.com" })
        .acceptable,
      false,
    );
  });

  it("rejects when nothing passes", () => {
    assert.equal(evaluate({ spf: "fail", dkim: "fail", dmarc: "none" }).acceptable, false);
  });

  it("fails closed when the provider reports nothing, unless configured otherwise", () => {
    const missing = (requireEmailAuth: boolean) =>
      evaluateEmailAuthentication({
        results: { spf: "none", dkim: "none", dmarc: "none" },
        missing: true,
        requireEmailAuth,
        envelopeSender: "a@x.com",
        from: "a@x.com",
      }).acceptable;
    assert.equal(missing(true), false);
    assert.equal(missing(false), true);
  });
});

// ── loop suppression ───────────────────────────────────────────────────────
describe("automated-message suppression", () => {
  it("suppresses auto-responders, bounces, and list mail", () => {
    const cases: Record<string, string>[] = [
      { "auto-submitted": "auto-replied" },
      { "x-autoreply": "yes" },
      { precedence: "bulk" },
      { "list-id": "<x.lists.example.com>" },
      { "content-type": "multipart/report; report-type=delivery-status" },
      { "x-failed-recipients": "a@b.com" },
      { "X-Auto-Response-Suppress": "All" },
    ];
    for (const headers of cases) {
      assert.equal(isAutomatedMessage(headers), true, JSON.stringify(headers));
    }
  });

  it("suppresses our own notification mail, preventing a loop", () => {
    assert.equal(isAutomatedMessage({ "x-savetrix-correlation-id": "abc" }), true);
  });

  it("lets an ordinary human forward through", () => {
    assert.equal(isAutomatedMessage({ "auto-submitted": "no", subject: "FW: invoice" }), false);
    assert.equal(isAutomatedMessage({}), false);
  });
});

// ── attachment validation ──────────────────────────────────────────────────
const pdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
const exe = () => Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)]);

const attachment = (over: Partial<NormalizedAttachment> = {}): NormalizedAttachment => ({
  providerAttachmentId: "att-1",
  filename: "invoice.pdf",
  reportedMimeType: "application/pdf",
  sizeBytes: 1024,
  disposition: "attachment",
  contentId: null,
  ...over,
});

describe("attachment magic-byte detection", () => {
  it("identifies the formats manual upload accepts", () => {
    assert.equal(detectMimeType(pdf()), "application/pdf");
    assert.equal(detectMimeType(png()), "image/png");
    assert.equal(detectMimeType(jpeg()), "image/jpeg");
  });

  it("returns null for unrecognized or truncated content", () => {
    assert.equal(detectMimeType(Buffer.from("hello world!!")), null);
    assert.equal(detectMimeType(Buffer.alloc(3)), null);
  });

  it("flags dangerous containers regardless of what they claim to be", () => {
    assert.equal(detectForbiddenFormat(zip()), "zip/office-macro/archive");
    assert.equal(detectForbiddenFormat(exe()), "windows-pe");
    assert.equal(detectForbiddenFormat(Buffer.from("#!/bin/sh\n")), "shebang-script");
    assert.equal(detectForbiddenFormat(pdf()), null);
  });
});

describe("filename sanitization", () => {
  it("strips directory traversal", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFilename("..\\..\\windows\\system32\\a.pdf"), "a.pdf");
  });

  it("removes bidi overrides used to disguise an extension", () => {
    // Renders as "invoice.pdf" to a human but is really .exe.
    const spoofed = "invoice‮fdp.exe";
    const safe = sanitizeFilename(spoofed);
    assert.equal(safe.includes("‮"), false);
  });

  it("removes control characters and path separators", () => {
    assert.equal(sanitizeFilename("in voice\n.pdf").includes(" "), false);
    assert.equal(sanitizeFilename("a:b*c?.pdf"), "a_b_c_.pdf");
  });

  it("falls back to a safe name and caps length", () => {
    assert.equal(sanitizeFilename(""), "attachment");
    assert.equal(sanitizeFilename("..."), "attachment");
    assert.equal(sanitizeFilename(null), "attachment");
    const long = sanitizeFilename("a".repeat(400) + ".pdf");
    assert.ok(long.length <= 180);
    assert.ok(long.endsWith(".pdf"), "extension preserved when truncating");
  });
});

describe("validateAttachment", () => {
  it("accepts a genuine PDF and reports a stable hash", () => {
    const r = validateAttachment(attachment(), pdf());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.detectedMimeType, "application/pdf");
      assert.equal(r.value.sanitizedFilename, "invoice.pdf");
      assert.equal(r.value.sha256.length, 64);
      assert.equal(r.value.sha256, validateAttachment(attachment(), pdf()).ok ? r.value.sha256 : "");
    }
  });

  it("rejects a .pdf that is really an executable", () => {
    // The extension and the declared MIME both lie; only the bytes tell the truth.
    const r = validateAttachment(attachment({ filename: "invoice.pdf" }), exe());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "unsupported_file_type");
  });

  it("rejects an archive even when declared as a PDF", () => {
    const r = validateAttachment(attachment(), zip());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "unsupported_file_type");
  });

  it("rejects a declared/detected type mismatch", () => {
    const r = validateAttachment(attachment({ reportedMimeType: "application/pdf" }), png());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "content_type_mismatch");
  });

  it("tolerates known MIME aliases", () => {
    assert.equal(validateAttachment(attachment({ reportedMimeType: "image/jpg" }), jpeg()).ok, true);
    assert.equal(
      validateAttachment(attachment({ reportedMimeType: "application/pdf; charset=binary" }), pdf()).ok,
      true,
    );
  });

  it("enforces the real byte length, not the reported size", () => {
    const r = validateAttachment(attachment({ sizeBytes: 10 }), pdf(), {
      maxAttachments: 10,
      maxFileBytes: 32,
      maxTotalBytes: 100,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "file_too_large");
  });

  it("rejects an empty file", () => {
    const r = validateAttachment(attachment(), Buffer.alloc(0));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "unsupported_file_type");
  });
});

describe("envelope limits and candidate selection", () => {
  it("rejects an email with no attachments", () => {
    const r = checkEnvelopeLimits([]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "no_supported_attachments");
  });

  it("rejects too many attachments before downloading anything", () => {
    const many = Array.from({ length: 11 }, (_, i) => attachment({ providerAttachmentId: `a${i}` }));
    const r = checkEnvelopeLimits(many);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "too_many_attachments");
  });

  it("rejects an oversized total on metadata alone", () => {
    const big = [attachment({ sizeBytes: 30 * 1024 * 1024 }), attachment({ sizeBytes: 30 * 1024 * 1024 })];
    const r = checkEnvelopeLimits(big);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "file_too_large");
  });

  it("keeps a real invoice and drops the signature logo", () => {
    const candidates = selectCandidateAttachments([
      attachment({ providerAttachmentId: "invoice", filename: "invoice.pdf" }),
      attachment({
        providerAttachmentId: "logo",
        filename: "logo.png",
        reportedMimeType: "image/png",
        sizeBytes: 4096,
        disposition: "inline",
        contentId: "<logo@corp>",
      }),
    ]);
    assert.deepEqual(candidates.map((c) => c.providerAttachmentId), ["invoice"]);
  });

  it("never treats a PDF as an inline asset, however small", () => {
    // Wrongly skipping a real invoice is worse than processing a stray graphic.
    const tinyPdf = attachment({ sizeBytes: 900, disposition: "inline", contentId: "<x@y>" });
    assert.equal(isLikelyInlineAsset(tinyPdf), false);
  });

  it("treats a tracking pixel as an inline asset", () => {
    const pixel = attachment({ reportedMimeType: "image/gif", sizeBytes: 43, disposition: "unknown" });
    assert.equal(isLikelyInlineAsset(pixel, { width: 1, height: 1 }), true);
  });

  it("drops unsupported declared types", () => {
    const c = selectCandidateAttachments([
      attachment({ providerAttachmentId: "doc", reportedMimeType: "application/zip" }),
    ]);
    assert.equal(c.length, 0);
  });
});

// ── signature verification ─────────────────────────────────────────────────
describe("webhook signature verification", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key-material").toString("base64");
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const sign = (id: string, ts: string, payload: string) => {
    const raw = secret.slice(6);
    return (
      "v1," +
      createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${ts}.${payload}`).digest("base64")
    );
  };

  it("accepts a correct signature", () => {
    const ts = "1700000000";
    const r = verifyWebhookSignature(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, {
      secret,
      nowSeconds: 1700000010,
    });
    assert.deepEqual(r, { ok: true });
  });

  it("rejects a body altered after signing", () => {
    const ts = "1700000000";
    const sig = sign("msg_1", ts, body);
    const r = verifyWebhookSignature(body + " ", { id: "msg_1", timestamp: ts, signature: sig }, {
      secret,
      nowSeconds: 1700000010,
    });
    assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
  });

  it("rejects a replayed old delivery", () => {
    const ts = "1700000000";
    const r = verifyWebhookSignature(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, {
      secret,
      nowSeconds: 1700000000 + 4000,
    });
    assert.deepEqual(r, { ok: false, reason: "stale_timestamp" });
  });

  it("rejects a timestamp from the future", () => {
    const ts = "1700009999";
    const r = verifyWebhookSignature(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, {
      secret,
      nowSeconds: 1700000000,
    });
    assert.deepEqual(r, { ok: false, reason: "stale_timestamp" });
  });

  it("rejects a signature made with the wrong secret", () => {
    const ts = "1700000000";
    const other = "whsec_" + Buffer.from("different-key").toString("base64");
    const raw = other.slice(6);
    const sig =
      "v1," +
      createHmac("sha256", Buffer.from(raw, "base64")).update(`msg_1.${ts}.${body}`).digest("base64");
    const r = verifyWebhookSignature(body, { id: "msg_1", timestamp: ts, signature: sig }, {
      secret,
      nowSeconds: 1700000010,
    });
    assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
  });

  it("accepts any valid signature in the list, enabling secret rotation", () => {
    const ts = "1700000000";
    const sig = `v1,${Buffer.from("garbage").toString("base64")} ${sign("msg_1", ts, body)}`;
    assert.deepEqual(
      verifyWebhookSignature(body, { id: "msg_1", timestamp: ts, signature: sig }, { secret, nowSeconds: 1700000010 }),
      { ok: true },
    );
  });

  it("rejects missing headers rather than throwing", () => {
    for (const headers of [
      { id: "", timestamp: "1700000000", signature: "v1,x" },
      { id: "msg_1", timestamp: "", signature: "v1,x" },
      { id: "msg_1", timestamp: "1700000000", signature: "" },
      { id: "msg_1", timestamp: "not-a-number", signature: "v1,x" },
    ]) {
      const r = verifyWebhookSignature(body, headers, { secret, nowSeconds: 1700000010 });
      assert.equal(r.ok, false);
    }
  });
});

// ── provider normalization ─────────────────────────────────────────────────
describe("Resend payload normalization", () => {
  const payload = {
    type: "email.received",
    event_id: "evt_1",
    data: {
      email_id: "em_1",
      message_id: "<abc@mail.example.com>",
      created_at: "2026-08-14T10:00:00.000Z",
      from: ['"Nikhil" <nikhil@savetrix.com>'],
      to: ["inv-token@in.scantrix.ai"],
      envelope: { from: "nikhil@savetrix.com", to: ["inv-token@in.scantrix.ai"] },
      subject: "FW: Invoice 123",
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      attachments: [
        { id: "att_1", filename: "invoice.pdf", content_type: "application/pdf", size: 2048, content_disposition: "attachment" },
        { id: "att_2", filename: "logo.png", content_type: "image/png", size: 3000, content_disposition: "inline; filename=logo.png", content_id: "<logo@x>" },
      ],
    },
  };

  it("normalizes a forwarded invoice into the provider-agnostic shape", () => {
    const r = normalizeResendEvent(payload);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const e = r.value.event!;
    assert.equal(e.provider, "resend");
    assert.equal(e.providerEventId, "evt_1");
    assert.equal(e.providerEmailId, "em_1");
    // Display name discarded at the boundary.
    assert.equal(e.from, "nikhil@savetrix.com");
    assert.equal(e.envelopeSender, "nikhil@savetrix.com");
    assert.deepEqual(e.authResults, { spf: "pass", dkim: "pass", dmarc: "pass" });
    assert.equal(e.attachments.length, 2);
    assert.equal(e.attachments[1].disposition, "inline");
    assert.equal(e.attachments[1].contentId, "<logo@x>");
    // Never the body.
    assert.equal("body" in e.providerMetadata, false);
  });

  it("finds the alias in the normalized recipients", () => {
    const r = normalizeResendEvent(payload);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(findInboundLocalPart(r.value.event!.recipients, "in.scantrix.ai"), "inv-token");
  });

  it("acknowledges an unsupported event type without producing an event", () => {
    const r = normalizeResendEvent({ type: "email.delivered", data: {} });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.event, null);
      assert.equal(r.value.eventType, "email.delivered");
    }
  });

  it("rejects a payload missing provider ids", () => {
    const r = normalizeResendEvent({ type: "email.received", data: { from: ["a@b.com"] } });
    assert.equal(r.ok, false);
  });

  it("survives hostile shapes without throwing", () => {
    for (const bad of [null, undefined, 42, "string", [], { type: "email.received", data: 5 }]) {
      assert.doesNotThrow(() => normalizeResendEvent(bad));
    }
  });

  it("normalizes headers from either array or object form", () => {
    assert.equal(
      extractHeaders({ data: { headers: [{ name: "Auto-Submitted", value: "auto-replied" }] } })[
        "auto-submitted"
      ],
      "auto-replied",
    );
    assert.equal(
      extractHeaders({ data: { headers: { "Auto-Submitted": "auto-replied" } } })["auto-submitted"],
      "auto-replied",
    );
    assert.deepEqual(extractHeaders({}), {});
  });
});

// ── idempotency and retries ────────────────────────────────────────────────
describe("idempotency and retry classification", () => {
  it("derives stable keys from stable inputs", () => {
    assert.equal(messageIdempotencyKey("em_1"), "inbound:em_1");
    assert.equal(attachmentIdempotencyKey("em_1", "hash"), "inbound:em_1:hash");
    // Same bytes re-delivered are the same work.
    assert.equal(attachmentIdempotencyKey("em_1", "h"), attachmentIdempotencyKey("em_1", "h"));
    assert.notEqual(attachmentIdempotencyKey("em_1", "h1"), attachmentIdempotencyKey("em_1", "h2"));
  });

  it("treats policy rejections as permanent", () => {
    for (const code of ["unknown_alias", "sender_not_verified", "malware_detected", "duplicate_event"] as const) {
      assert.equal(classifyRejection(code), "permanent", code);
    }
  });

  it("treats a quota rejection as retryable, since quotas reset", () => {
    assert.equal(classifyRejection("usage_limit_exceeded"), "retryable");
  });

  it("retries 5xx/429/timeouts but not 4xx", () => {
    assert.equal(classifyHttpFailure(500), "retryable");
    assert.equal(classifyHttpFailure(503), "retryable");
    assert.equal(classifyHttpFailure(429), "retryable");
    assert.equal(classifyHttpFailure(408), "retryable");
    assert.equal(classifyHttpFailure(null), "retryable");
    assert.equal(classifyHttpFailure(400), "permanent");
    assert.equal(classifyHttpFailure(404), "permanent");
  });

  it("backs off exponentially then gives up so work can be dead-lettered", () => {
    assert.equal(nextRetryDelaySeconds(1), 60);
    assert.equal(nextRetryDelaySeconds(2), 300);
    assert.equal(nextRetryDelaySeconds(3), 1500);
    assert.equal(nextRetryDelaySeconds(5), null);
    assert.ok((nextRetryDelaySeconds(4) ?? 0) <= 6 * 60 * 60);
  });
});
