// Tests for the parts of inbound-email ingestion that actually run: the
// credential seal, the reconstructed authentication verdicts, the idempotency
// claim, the SSRF boundary, and the pipeline end to end against fakes.
//
// The pure decision logic is covered in inboundEmail.test.ts. What matters here
// is the wiring — and specifically the three places where getting it wrong costs
// real money: a duplicate bill in QuickBooks, an invoice created for the wrong
// company, and an invoice silently lost.
//
// Run with: npm test
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { deriveAuthResults, parseAuthenticationResults, parseReceivedSpf } from "../lib/inboundEmail/authResults";
import { parseEncryptionKey, type InboundEmailConfig } from "../lib/inboundEmail/config";
import { extractInvoiceId, type IngestAuthority } from "../lib/inboundEmail/ingest";
import { processInboundEvent } from "../lib/inboundEmail/pipeline";
import { checkDownloadUrl, type ResendAttachmentMeta } from "../lib/inboundEmail/providers/resendClient";
import { openSecret, sealSecret, secretsEqual } from "../lib/inboundEmail/secretBox";
import { evaluateScan, parseVerdict, readScanVerdicts } from "../lib/inboundEmail/scanVerdict";
import {
  __paths,
  __setInboundBlobIoForTests,
  claimMessage,
  createAlias,
  readAlias,
  InboundWriteConflictError,
  readMessage,
  releaseClaim,
  saveMessage,
  type AliasRecord,
  type InboundBlobIo,
  type MessageRecord,
  type WritePrecondition,
} from "../lib/inboundEmail/store";
import { hashAliasLocalPart } from "../lib/inboundEmail/alias";
import type { NormalizedInboundEvent } from "../lib/inboundEmail/types";

// ==============================
// IN-MEMORY BLOB STORE
// ==============================

/**
 * Emulates the two preconditions the real adapter relies on: create-only
 * (allowOverwrite:false) and If-Match. Without both, the idempotency tests below
 * would pass against a store that cannot actually provide the guarantee.
 */
function memoryIo(): InboundBlobIo & { dump: () => Map<string, string> } {
  const files = new Map<string, { text: string; etag: string }>();
  let counter = 0;

  return {
    async read(pathname) {
      const hit = files.get(pathname);
      return hit ? { text: hit.text, etag: hit.etag } : null;
    },
    async write(pathname: string, text: string, precondition: WritePrecondition) {
      const current = files.get(pathname);
      if (precondition.kind === "create" && current) throw new InboundWriteConflictError();
      if (precondition.kind === "match") {
        if (!current || current.etag !== precondition.etag) throw new InboundWriteConflictError();
      }
      counter += 1;
      files.set(pathname, { text, etag: `"etag-${counter}"` });
    },
    async remove(pathname) {
      files.delete(pathname);
    },
    async list(prefix) {
      return [...files.keys()].filter((key) => key.startsWith(prefix));
    },
    dump: () => new Map([...files].map(([key, value]) => [key, value.text])),
  };
}


/** A record as it would look after an attempt that died `agoMs` ago. */
async function plantStaleRecord(
  io: InboundBlobIo,
  record: MessageRecord,
  agoMs = 10 * 60 * 1000,
): Promise<void> {
  const stale = { ...record, updatedAt: new Date(Date.now() - agoMs).toISOString() };
  await io.write(__paths.messagePath(record.providerEventId), JSON.stringify(stale), { kind: "none" });
}

const KEY = randomBytes(32);

// ==============================
// SECRET BOX
// ==============================

describe("sealed refresh token", () => {
  it("round-trips under the right key and alias", () => {
    const sealed = sealSecret("refresh-abc", KEY, "alias-hash-1");
    assert.notEqual(sealed, "refresh-abc");
    assert.equal(openSecret(sealed, KEY, "alias-hash-1"), "refresh-abc");
  });

  it("produces a different ciphertext every time, so the IV is never reused", () => {
    const a = sealSecret("refresh-abc", KEY, "alias-hash-1");
    const b = sealSecret("refresh-abc", KEY, "alias-hash-1");
    assert.notEqual(a, b);
    assert.equal(openSecret(a, KEY, "alias-hash-1"), openSecret(b, KEY, "alias-hash-1"));
  });

  it("REFUSES a ciphertext moved to a different alias", () => {
    // The whole point of binding the alias hash as AAD: someone with write
    // access to the store must not be able to point company A's address at
    // company B's stored credential.
    const sealed = sealSecret("refresh-abc", KEY, "alias-A");
    assert.equal(openSecret(sealed, KEY, "alias-B"), null);
  });

  it("refuses the wrong key", () => {
    const sealed = sealSecret("refresh-abc", KEY, "alias-A");
    assert.equal(openSecret(sealed, randomBytes(32), "alias-A"), null);
  });

  it("refuses tampered bytes rather than returning attacker-chosen plaintext", () => {
    const sealed = sealSecret("refresh-abc", KEY, "alias-A");
    const parts = sealed.split(".");
    // Flip a character in the ciphertext segment.
    const flipped = parts[3][0] === "A" ? "B" : "A";
    parts[3] = flipped + parts[3].slice(1);
    assert.equal(openSecret(parts.join("."), KEY, "alias-A"), null);
  });

  it("refuses malformed input without throwing", () => {
    for (const bad of ["", "v1", "v1.a.b", "v2.a.b.c", "garbage"]) {
      assert.doesNotThrow(() => openSecret(bad, KEY, "alias-A"));
      assert.equal(openSecret(bad, KEY, "alias-A"), null);
    }
  });

  it("accepts a 32-byte key as hex or base64 and rejects a short one", () => {
    const raw = randomBytes(32);
    assert.deepEqual(parseEncryptionKey(raw.toString("hex")), raw);
    assert.deepEqual(parseEncryptionKey(raw.toString("base64")), raw);
    // A short key would silently weaken AES-256; it must be a config error.
    assert.equal(parseEncryptionKey(randomBytes(16).toString("base64")), null);
    assert.equal(parseEncryptionKey(""), null);
    assert.equal(parseEncryptionKey(undefined), null);
  });

  it("compares secrets without leaking length through an exception", () => {
    assert.equal(secretsEqual("abc", "abc"), true);
    assert.equal(secretsEqual("abc", "abcd"), false);
    assert.equal(secretsEqual(null, null), true);
    assert.equal(secretsEqual("abc", null), false);
  });
});

// ==============================
// AUTHENTICATION RESULTS
// ==============================

describe("authentication verdicts reconstructed from headers", () => {
  it("parses a normal Authentication-Results header", () => {
    const parsed = parseAuthenticationResults(
      "mx.resend.com; spf=pass smtp.mailfrom=savetrix.com; dkim=pass header.d=savetrix.com; dmarc=pass",
    );
    assert.equal(parsed.authservId, "mx.resend.com");
    assert.deepEqual(parsed.results, { spf: "pass", dkim: "pass", dmarc: "pass" });
    assert.equal(parsed.stated, true);
  });

  it("is not fooled by semicolons or '=' inside comments and quoted strings", () => {
    const parsed = parseAuthenticationResults(
      'mx.resend.com; dkim=fail (bad signature; dmarc=pass) header.i="a=b; dmarc=pass"; spf=fail',
    );
    // The dmarc=pass hiding in a comment and a quoted string must not count.
    assert.equal(parsed.results.dmarc, "none");
    assert.equal(parsed.results.dkim, "fail");
    assert.equal(parsed.results.spf, "fail");
  });

  it("lets any passing DKIM signature win over a failing one", () => {
    // Multiple signatures are normal (one per signing domain); a later fail
    // must not demote an earlier pass.
    const parsed = parseAuthenticationResults("x; dkim=pass header.d=a.com; dkim=fail header.d=b.com");
    assert.equal(parsed.results.dkim, "pass");
  });

  it("treats a DKIM temperror as an absence, not a forgery", () => {
    // Rejecting legitimate mail during somebody else's DNS outage is the wrong
    // failure direction.
    const parsed = parseAuthenticationResults("x; dkim=temperror");
    assert.equal(parsed.results.dkim, "neutral");
  });

  it("maps softfail and permerror to fail", () => {
    assert.equal(parseAuthenticationResults("x; spf=softfail").results.spf, "fail");
    assert.equal(parseAuthenticationResults("x; spf=permerror").results.spf, "fail");
  });

  it("unfolds a folded header", () => {
    const parsed = parseAuthenticationResults("mx.resend.com;\r\n  spf=pass;\r\n\tdkim=pass");
    assert.deepEqual(
      { spf: parsed.results.spf, dkim: parsed.results.dkim },
      { spf: "pass", dkim: "pass" },
    );
  });

  it("reads the older Received-SPF header", () => {
    assert.equal(parseReceivedSpf("pass (domain of savetrix.com designates 1.2.3.4)"), "pass");
    assert.equal(parseReceivedSpf("fail (bad)"), "fail");
  });

  it("reports absent when no authentication header arrived at all", () => {
    const derived = deriveAuthResults({ from: "a@b.com" });
    assert.equal(derived.missing, true);
    assert.equal(derived.diagnostics.trust, "absent");
    assert.equal(derived.diagnostics.authenticationResults, null);
  });

  it("reports advisory — never verified — when no authserv-id is pinned", () => {
    // Resend collapses duplicate headers into one object entry, so without a
    // pin we genuinely cannot prove who wrote this. Saying so is the honest
    // answer; silently calling it trustworthy is not.
    const derived = deriveAuthResults({
      "Authentication-Results": "mx.resend.com; dmarc=pass",
    });
    assert.equal(derived.diagnostics.trust, "advisory");
    assert.equal(derived.results.dmarc, "pass");
    assert.equal(derived.missing, false);
  });

  it("believes a header whose authserv-id matches the pin", () => {
    const derived = deriveAuthResults(
      { "Authentication-Results": "mx.resend.com; dmarc=pass" },
      { expectedAuthservId: "mx.resend.com" },
    );
    assert.equal(derived.diagnostics.trust, "verified");
    assert.equal(derived.missing, false);
  });

  it("REFUSES a forged header when a pin is configured", () => {
    // This is the attack: a forwarded message carrying the original sender's
    // own `Authentication-Results: ...; dmarc=pass`. With a pin set, it is not
    // our provider's header, so it buys nothing.
    const derived = deriveAuthResults(
      { "Authentication-Results": "evil.example; dmarc=pass; dkim=pass; spf=pass" },
      { expectedAuthservId: "mx.resend.com" },
    );
    assert.equal(derived.diagnostics.trust, "rejected");
    // Crucially reported as MISSING, not as a pass.
    assert.equal(derived.missing, true);
    assert.equal(derived.results.dmarc, "none");
  });

  it("picks the pinned header out of an array of several", () => {
    const derived = deriveAuthResults(
      {
        "Authentication-Results": [
          "evil.example; dmarc=pass",
          "mx.resend.com; dmarc=fail",
        ],
      },
      { expectedAuthservId: "mx.resend.com" },
    );
    assert.equal(derived.diagnostics.trust, "verified");
    assert.equal(derived.results.dmarc, "fail");
  });

  it("fills an unstated SPF verdict from Received-SPF but never overrules one", () => {
    const filled = deriveAuthResults({
      "Authentication-Results": "mx; dkim=pass",
      "Received-SPF": "pass (designates)",
    });
    assert.equal(filled.results.spf, "pass");

    const kept = deriveAuthResults({
      "Authentication-Results": "mx; spf=fail",
      "Received-SPF": "pass (designates)",
    });
    assert.equal(kept.results.spf, "fail");
  });

  it("surfaces Return-Path for use as the envelope sender", () => {
    const derived = deriveAuthResults({ "Return-Path": "<bounce@savetrix.com>" });
    assert.equal(derived.diagnostics.returnPath, "<bounce@savetrix.com>");
  });

  it("reads headers case-insensitively", () => {
    const derived = deriveAuthResults({ "AUTHENTICATION-RESULTS": "mx; dmarc=pass" });
    assert.equal(derived.results.dmarc, "pass");
  });
});

// ==============================
// PROVIDER MALWARE SCAN
// ==============================

describe("provider scan verdicts", () => {
  it("reads the SES headers Resend actually sends", () => {
    // These header names are taken from a real forwarded invoice, not a guess.
    const v = readScanVerdicts({
      "X-SES-Virus-Verdict": "PASS",
      "X-SES-Spam-Verdict": "GRAY",
    });
    assert.deepEqual(v, { virus: "pass", spam: "gray" });
  });

  it("reads them case-insensitively", () => {
    assert.equal(readScanVerdicts({ "x-ses-virus-verdict": "FAIL" }).virus, "fail");
  });

  it("REFUSES a message the provider flagged as a virus", () => {
    const decision = evaluateScan({ virus: "fail", spam: "pass" });
    assert.equal(decision.accept, false);
    if (!decision.accept) assert.equal(decision.reason, "malware_detected");
  });

  it("accepts when no verdict is present, by default", () => {
    // Deliberate. Defaulting to reject would break every message the moment a
    // provider stopped sending the header — the same mistake the design's
    // email-auth default made, which had to be reversed after it broke the
    // first live test.
    assert.equal(evaluateScan({ virus: "unknown", spam: "unknown" }).accept, true);
  });

  it("can be made strict where a deployment wants that", () => {
    const decision = evaluateScan({ virus: "unknown", spam: "pass" }, { requireVirusVerdict: true });
    assert.equal(decision.accept, false);
  });

  it("does NOT reject spam by default", () => {
    // An invoice forwarded from a noisy mailbox trips spam heuristics easily,
    // and silently discarding a real invoice is worse than importing a junk one
    // a human rejects at review.
    assert.equal(evaluateScan({ virus: "pass", spam: "fail" }).accept, true);
    assert.equal(evaluateScan({ virus: "pass", spam: "fail" }, { rejectSpam: true }).accept, false);
  });

  it("never guesses an unrecognised verdict either way", () => {
    assert.equal(parseVerdict("something-new"), "unknown");
    assert.equal(parseVerdict(null), "unknown");
    assert.equal(parseVerdict("PROCESSING"), "processing");
  });
});

// ==============================
// SSRF BOUNDARY
// ==============================

describe("attachment download URL allow-list", () => {
  it("accepts the provider's CDN host", () => {
    const check = checkDownloadUrl(
      "https://inbound-cdn.resend.com/em_1/attachments/att_1?signature=abc",
    );
    assert.equal(check.ok, true);
  });

  it("rejects any other host, however public", () => {
    for (const url of [
      "https://evil.example/att",
      "https://resend.com.evil.example/att",
      "https://notresend.com/att",
    ]) {
      const check = checkDownloadUrl(url);
      assert.equal(check.ok, false, url);
      if (!check.ok) assert.equal(check.reason, "host-not-allowed");
    }
  });

  it("rejects internal and link-local addresses", () => {
    for (const host of [
      "http://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/att",
      "https://localhost/att",
      "https://10.0.0.5/att",
      "https://192.168.1.1/att",
      "https://172.16.0.1/att",
      "https://[::ffff:169.254.169.254]/att",
    ]) {
      assert.equal(checkDownloadUrl(host).ok, false, host);
    }
  });

  it("rejects plain http, which would expose the signed token in transit", () => {
    const check = checkDownloadUrl("http://inbound-cdn.resend.com/att");
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.reason, "non-https");
  });

  it("rejects a malformed URL without throwing", () => {
    assert.doesNotThrow(() => checkDownloadUrl("not a url"));
    assert.equal(checkDownloadUrl("not a url").ok, false);
  });
});

// ==============================
// INVOICE ID EXTRACTION
// ==============================

describe("reading the invoice id out of the upload response", () => {
  it("finds it in each shape the API is known to use", () => {
    assert.equal(extractInvoiceId({ data: { invoice: { _id: "inv_1" } } }), "inv_1");
    assert.equal(extractInvoiceId({ data: { invoices: [{ _id: "inv_2" }] } }), "inv_2");
    assert.equal(extractInvoiceId({ data: { _id: "inv_3" } }), "inv_3");
    assert.equal(extractInvoiceId({ invoice: { id: "inv_4" } }), "inv_4");
    assert.equal(extractInvoiceId({ _id: "inv_5" }), "inv_5");
  });

  it("returns null rather than inventing an id", () => {
    // The upload still succeeded; we just cannot name the invoice.
    assert.equal(extractInvoiceId({ success: true }), null);
    assert.equal(extractInvoiceId(null), null);
    assert.equal(extractInvoiceId("nope"), null);
  });
});

// ==============================
// IDEMPOTENCY CLAIM
// ==============================

const seedMessage = (overrides: Partial<MessageRecord> = {}): MessageRecord => ({
  version: 1,
  provider: "resend",
  providerEventId: "msg_1",
  providerEmailId: "em_1",
  rfcMessageId: null,
  correlationId: "inb_test",
  aliasHash: null,
  userId: null,
  qbConnectionId: null,
  senderEmail: null,
  subjectRedacted: null,
  receivedAt: "2026-08-14T10:00:00.000Z",
  status: "received",
  rejectionCode: null,
  detail: null,
  attempts: 1,
  attachments: [],
  authDiagnostics: null,
  createdAt: "2026-08-14T10:00:00.000Z",
  updatedAt: "2026-08-14T10:00:00.000Z",
  completedAt: null,
  ...overrides,
});

describe("claiming a webhook delivery", () => {
  let io: InboundBlobIo;
  beforeEach(() => {
    io = memoryIo();
    __setInboundBlobIoForTests(io);
  });

  it("claims an unseen delivery", async () => {
    const outcome = await claimMessage(seedMessage());
    assert.equal(outcome.kind, "claimed");
  });

  it("treats a redelivery of FINISHED work as a duplicate", async () => {
    await claimMessage(seedMessage());
    await saveMessage(seedMessage({ status: "completed" }));
    const again = await claimMessage(seedMessage());
    assert.equal(again.kind, "duplicate");
  });

  it("RESUMES a redelivery whose previous attempt DIED", async () => {
    // Treating "a record exists" as "already done" would silently drop every
    // invoice whose first attempt died half-way — exactly the case the
    // provider's 8 retries exist to recover.
    await claimMessage(seedMessage());
    await plantStaleRecord(io, seedMessage({ status: "processing", attempts: 1 }));
    const again = await claimMessage(seedMessage());
    assert.equal(again.kind, "claimed");
    if (again.kind === "claimed") assert.equal(again.record.attempts, 2);
  });

  it("counts attempts across successive dead attempts", async () => {
    await claimMessage(seedMessage());
    for (let i = 0; i < 3; i += 1) {
      const current = await readMessage("msg_1");
      await plantStaleRecord(io, current!);
      await claimMessage(seedMessage());
    }
    const record = await readMessage("msg_1");
    assert.equal(record?.attempts, 4);
  });

  it("REFUSES to resume a delivery another execution is working on", async () => {
    // The duplicate-bill scenario: our processing outlasts the provider's
    // webhook timeout, it retries, and two executions upload the same
    // attachments in parallel. The second must back off, not resume.
    await claimMessage(seedMessage());
    // A live execution: marked in-flight and recently alive.
    await saveMessage(seedMessage({ status: "processing", inFlight: true }));

    const again = await claimMessage(seedMessage());
    assert.equal(again.kind, "in_progress");
  });

  it("lets the next retry straight in once we have stopped working", async () => {
    // We return 503 the moment we stop, and the provider can retry within
    // seconds. Making it wait out the whole lease would waste retries, so
    // stopping releases the claim explicitly.
    await claimMessage(seedMessage());
    await releaseClaim(seedMessage({ status: "processing", inFlight: true }));

    const again = await claimMessage(seedMessage());
    assert.equal(again.kind, "claimed");
  });

  it("treats every terminal status as settled", async () => {
    for (const status of ["completed", "partially_completed", "rejected", "dead_lettered"] as const) {
      io = memoryIo();
      __setInboundBlobIoForTests(io);
      await claimMessage(seedMessage());
      await saveMessage(seedMessage({ status }));
      const again = await claimMessage(seedMessage());
      assert.equal(again.kind, "duplicate", status);
    }
  });
});

// ==============================
// PIPELINE END TO END
// ==============================

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40_000, 0x20)]);
const PNG_TINY = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2_000, 0x01),
]);

const ALIAS_LOCAL = "acme-corp-7k2m9x";
const ALIAS_HASH = hashAliasLocalPart(ALIAS_LOCAL);

function aliasRecord(overrides: Partial<AliasRecord> = {}): AliasRecord {
  return {
    version: 1,
    tokenHash: ALIAS_HASH,
    localPart: ALIAS_LOCAL,
    receivingAddress: `${ALIAS_LOCAL}@invoice.scantrix.ai`,
    userId: "user_1",
    ownerEmail: "nikhil@savetrix.com",
    additionalSenders: [],
    qbConnectionId: "qb_acme",
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    active: true,
    rotationVersion: 1,
    sealedRefreshToken: sealSecret("refresh-abc", KEY, ALIAS_HASH),
    createdAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

function config(overrides: Partial<InboundEmailConfig> = {}): InboundEmailConfig {
  return {
    enabled: true,
    provider: "resend",
    domain: "invoice.scantrix.ai",
    providerApiKey: "re_test",
    webhookSigningSecret: "whsec_test",
    toleranceSeconds: 300,
    requireEmailAuth: false,
    // Explicit, so the suite does not inherit whatever .env.local happens to say.
    expectedAuthservId: null,
    limits: { maxAttachments: 10, maxFileBytes: 15 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 },
    retentionDays: 30,
    tokenEncryptionKey: KEY,
    serviceEmail: "invoices@example.com",
    servicePassword: "service-secret",
    ...overrides,
  };
}

function event(overrides: Partial<NormalizedInboundEvent> = {}): NormalizedInboundEvent {
  return {
    provider: "resend",
    providerEventId: "msg_1",
    providerEmailId: "em_1",
    rfcMessageId: "<x@y>",
    receivedAt: new Date("2026-08-14T10:00:00.000Z"),
    envelopeSender: null,
    from: "nikhil@savetrix.com",
    sender: null,
    returnPath: null,
    recipients: [`${ALIAS_LOCAL}@invoice.scantrix.ai`],
    receivedFor: [`${ALIAS_LOCAL}@invoice.scantrix.ai`],
    subject: "FW: Invoice 123",
    authResults: { spf: "none", dkim: "none", dmarc: "none" },
    attachments: [],
    providerMetadata: {},
    ...overrides,
  };
}

interface FakeOptions {
  /** What the FETCHED message reports as From. Defaults to the authorized owner. */
  fetchedFrom?: string;
  headers?: Record<string, string | string[]>;
  metas?: ResendAttachmentMeta[];
  bytes?: Record<string, Buffer>;
  uploadResults?: Array<{ ok: boolean; transient?: boolean; invoiceId?: string }>;
  acquireFails?: "unauthorized" | "transient";
  fetchThrows?: boolean;
  downloadTransient?: boolean;
}

function fakes(options: FakeOptions = {}) {
  const uploads: Array<{ filename: string; qbId: string; bytes: number }> = [];
  let uploadIndex = 0;

  const metas: ResendAttachmentMeta[] =
    options.metas ??
    [
      {
        id: "att_1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: PDF.length,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=a",
        expiresAt: null,
      },
    ];

  const bytes = options.bytes ?? { att_1: PDF };

  const authority: IngestAuthority = {
    async acquire() {
      if (options.acquireFails === "unauthorized") {
        return { ok: false, reason: "unauthorized", detail: "login-401" };
      }
      if (options.acquireFails === "transient") {
        return { ok: false, reason: "transient", detail: "login-503" };
      }
      return { ok: true, accessToken: "service-access-xyz" };
    },
    async uploadInvoice(file, _token, qbConnectionId) {
      uploads.push({ filename: file.filename, qbId: qbConnectionId, bytes: file.bytes.length });
      const planned = options.uploadResults?.[uploadIndex];
      uploadIndex += 1;
      if (!planned || planned.ok) {
        return { ok: true, invoiceId: planned?.invoiceId ?? `inv_${uploadIndex}` };
      }
      return { ok: false, transient: planned.transient ?? false, detail: "upload-500" };
    },
  };

  const provider = {
    async fetchEmail() {
      if (options.fetchThrows) throw new Error("boom");
      return {
        id: "em_1",
        from: options.fetchedFrom ?? "nikhil@savetrix.com",
        to: [],
        cc: [],
        receivedFor: [`${ALIAS_LOCAL}@invoice.scantrix.ai`],
        subject: "FW: Invoice 123",
        messageId: "<x@y>",
        createdAt: null,
        headers: options.headers ?? { "Return-Path": "<nikhil@savetrix.com>" },
        attachments: [],
      };
    },
    async listAttachments() {
      return metas;
    },
    async download(url: string) {
      if (options.downloadTransient) {
        return { ok: false as const, reason: "download-403", transient: true };
      }
      const id = metas.find((meta) => meta.downloadUrl === url)?.id ?? "";
      const found = bytes[id];
      return found
        ? { ok: true as const, bytes: found }
        : { ok: false as const, reason: "download-404", transient: false };
    },
  };

  return { authority, provider: provider as never, uploads };
}

describe("inbound pipeline", () => {
  let io: InboundBlobIo;
  beforeEach(async () => {
    io = memoryIo();
    __setInboundBlobIoForTests(io);
    await createAlias(aliasRecord());
  });

  it("ingests a forwarded invoice into the alias's company", async () => {
    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(event(), { config: config(), authority, provider });

    assert.equal(result.kind, "done");
    if (result.kind === "done") {
      assert.equal(result.status, "completed");
      assert.equal(result.invoiceCount, 1);
    }
    assert.equal(uploads.length, 1);
    // The alias — not the sender, not a default — chose the company.
    assert.equal(uploads[0].qbId, "qb_acme");
    assert.equal(uploads[0].filename, "invoice.pdf");
  });

  it("records the invoice id and the auth diagnostics on the message", async () => {
    const { authority, provider } = fakes({
      headers: {
        "Return-Path": "<nikhil@savetrix.com>",
        "Authentication-Results": "mx.resend.com; dmarc=pass",
      },
    });
    await processInboundEvent(event(), { config: config(), authority, provider });

    const record = await readMessage("msg_1");
    assert.equal(record?.status, "completed");
    assert.equal(record?.attachments[0].status, "completed");
    assert.equal(record?.attachments[0].invoiceId, "inv_1");
    // The diagnostics are the whole reason the settings panel can explain itself.
    assert.equal(record?.authDiagnostics?.trust, "advisory");
    assert.equal(record?.authDiagnostics?.authservId, "mx.resend.com");
  });

  it("rejects an address we do not own", async () => {
    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(
      event({
        receivedFor: ["someone-else-abc123@invoice.scantrix.ai"],
        recipients: ["someone-else-abc123@invoice.scantrix.ai"],
      }),
      { config: config(), authority, provider },
    );
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "unknown_alias");
    assert.equal(uploads.length, 0);
  });

  it("gives a malformed address the SAME answer as an unknown one", async () => {
    // Otherwise the endpoint becomes an oracle for which addresses exist.
    const { authority, provider } = fakes();
    const result = await processInboundEvent(
      event({ receivedFor: ["!!!@invoice.scantrix.ai"], recipients: ["!!!@invoice.scantrix.ai"] }),
      { config: config(), authority, provider },
    );
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "unknown_alias");
  });

  it("rejects a sender who is not on the alias's allow-list", async () => {
    const { authority, provider, uploads } = fakes({
      headers: { "Return-Path": "<attacker@evil.com>" },
      fetchedFrom: "attacker@evil.com",
    });
    const result = await processInboundEvent(event({ from: "attacker@evil.com" }), {
      config: config(),
      authority,
      provider,
    });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "sender_not_registered");
    assert.equal(uploads.length, 0);
  });

  it("is not fooled by a display name that impersonates the owner", async () => {
    const { authority, provider, uploads } = fakes({
      headers: { "Return-Path": '"nikhil@savetrix.com" <attacker@evil.com>' },
      fetchedFrom: '"Nikhil Savetrix" <attacker@evil.com>',
    });
    const result = await processInboundEvent(
      event({ from: '"Nikhil Savetrix" <attacker@evil.com>' }),
      { config: config(), authority, provider },
    );
    assert.equal(result.kind, "rejected");
    assert.equal(uploads.length, 0);
  });

  it("accepts an authorized From when Return-Path was rewritten by a gateway", async () => {
    // Corporate gateways, relays and mailing lists routinely rewrite
    // Return-Path to a bounce handler. Taking Return-Path in preference to From
    // meant comparing `bounces+123@gateway.example` against the allow-list and
    // refusing an accountant whose From was perfectly correct.
    const { authority, provider, uploads } = fakes({
      headers: {
        "Return-Path": "<bounces+7f3a2@mail-gateway.example>",
        "Authentication-Results": "amazonses.com; dmarc=pass; dkim=pass; spf=pass",
      },
      fetchedFrom: "nikhil@savetrix.com",
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "done");
    assert.equal(uploads.length, 1);
  });

  it("still rejects when NEITHER Return-Path nor From is authorized", async () => {
    const { authority, provider, uploads } = fakes({
      headers: { "Return-Path": "<bounces@gateway.example>" },
      fetchedFrom: "attacker@evil.com",
    });
    const result = await processInboundEvent(event({ from: "attacker@evil.com" }), {
      config: config(),
      authority,
      provider,
    });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "sender_not_registered");
    assert.equal(uploads.length, 0);
  });

  it("accepts an explicitly added additional sender", async () => {
    __setInboundBlobIoForTests(memoryIo());
    await createAlias(aliasRecord({ additionalSenders: ["colleague@savetrix.com"] }));
    const { authority, provider, uploads } = fakes({
      headers: { "Return-Path": "<colleague@savetrix.com>" },
    });
    const result = await processInboundEvent(event({ from: "colleague@savetrix.com" }), {
      config: config(),
      authority,
      provider,
    });
    assert.equal(result.kind, "done");
    assert.equal(uploads.length, 1);
  });

  it("matches a sender whose mail client rewrote the local-part case", async () => {
    const { authority, provider } = fakes({
      headers: { "Return-Path": "<Nikhil@Savetrix.com>" },
    });
    const result = await processInboundEvent(event({ from: "Nikhil@Savetrix.com" }), {
      config: config(),
      authority,
      provider,
    });
    assert.equal(result.kind, "done");
  });

  it("rejects a revoked alias as unknown", async () => {
    __setInboundBlobIoForTests(memoryIo());
    await createAlias(aliasRecord({ active: false, sealedRefreshToken: null }));
    const { authority, provider } = fakes();
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "unknown_alias");
  });

  it("refuses an auto-reply before it reaches the decision table", async () => {
    const { authority, provider, uploads } = fakes({
      headers: { "Auto-Submitted": "auto-replied", "Return-Path": "<nikhil@savetrix.com>" },
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "automated_message");
    assert.equal(uploads.length, 0);
  });

  it("rejects when auth results are absent and strict mode is on", async () => {
    const { authority, provider } = fakes({ headers: { "Return-Path": "<nikhil@savetrix.com>" } });
    const result = await processInboundEvent(event(), {
      config: config({ requireEmailAuth: true }),
      authority,
      provider,
    });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "authentication_failed");
  });

  it("accepts when auth results are absent and strict mode is off", async () => {
    // The shipped default. The gate is the verified-sender check, not this.
    const { authority, provider } = fakes();
    const result = await processInboundEvent(event(), {
      config: config({ requireEmailAuth: false }),
      authority,
      provider,
    });
    assert.equal(result.kind, "done");
  });

  it("records but does not process while the feature is off, so nothing is lost", async () => {
    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(event(), {
      config: config({ enabled: false }),
      authority,
      provider,
    });
    assert.equal(result.kind, "deferred");
    assert.equal(uploads.length, 0);
    // Left NON-terminal on purpose: replaying the delivery once the flag is on
    // must pick it up rather than skipping it as a duplicate.
    const record = await readMessage("msg_1");
    assert.equal(record?.status, "received");
    await plantStaleRecord(io, record!);
    const again = await claimMessage(seedMessage());
    assert.equal(again.kind, "claimed");
  });

  it("asks for redelivery when the provider fetch fails", async () => {
    const { authority, provider } = fakes({ fetchThrows: true });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "retry");
  });

  it("asks for redelivery when the download URL has expired", async () => {
    const { authority, provider, uploads } = fakes({ downloadTransient: true });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "retry");
    assert.equal(uploads.length, 0);
  });

  it("stops permanently when the delegated credential is dead", async () => {
    const { authority, provider } = fakes({ acquireFails: "unauthorized" });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "credential_expired");
  });

  it("asks for redelivery when the token exchange is merely unavailable", async () => {
    const { authority, provider } = fakes({ acquireFails: "transient" });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "retry");
  });

  it("skips a signature logo and still ingests the real invoice", async () => {
    const metas: ResendAttachmentMeta[] = [
      {
        id: "att_logo",
        filename: "logo.png",
        contentType: "image/png",
        contentDisposition: "inline",
        contentId: "<logo@x>",
        sizeBytes: PNG_TINY.length,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_logo?sig=b",
        expiresAt: null,
      },
      {
        id: "att_1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: PDF.length,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=a",
        expiresAt: null,
      },
    ];
    const { authority, provider, uploads } = fakes({
      metas,
      bytes: { att_logo: PNG_TINY, att_1: PDF },
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "done");
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].filename, "invoice.pdf");
  });

  it("reports partially_completed when one file is unusable", async () => {
    const metas: ResendAttachmentMeta[] = [
      {
        id: "att_1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: PDF.length,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=a",
        expiresAt: null,
      },
      {
        id: "att_bad",
        filename: "notes.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: 50_000,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_bad?sig=c",
        expiresAt: null,
      },
    ];
    // Declared a PDF, actually a ZIP. One bad file must not take the other down.
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40_000, 0)]);
    const { authority, provider, uploads } = fakes({
      metas,
      bytes: { att_1: PDF, att_bad: zip },
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "done");
    if (result.kind === "done") assert.equal(result.status, "partially_completed");
    assert.equal(uploads.length, 1);
  });

  it("NEVER re-uploads a file whose previous outcome is unknown", async () => {
    // The duplicate-bill guard. A first attempt posted this file and died before
    // recording the result, so the record says "ingesting". Re-posting could put
    // a second bill in QuickBooks — the backend has no dedupe on
    // (connection, vendor, invoice number). Same policy as lib/api.ts: never
    // re-send a write whose outcome is unknown.
    await claimMessage(seedMessage());
    await plantStaleRecord(
      io,
      seedMessage({
        status: "processing",
        attachments: [
          {
            sha256: "abc",
            providerAttachmentId: "att_1",
            sanitizedFilename: "invoice.pdf",
            status: "ingesting",
            rejectionCode: null,
            detail: null,
            invoiceId: null,
          },
        ],
      }),
    );

    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(event(), { config: config(), authority, provider });

    assert.equal(uploads.length, 0);
    assert.equal(result.kind, "rejected");
    const record = await readMessage("msg_1");
    assert.equal(record?.attachments[0].status, "failed");
    assert.match(record?.attachments[0].detail ?? "", /duplicate bill/);
  });

  it("does not re-upload a file that already completed on an earlier attempt", async () => {
    await claimMessage(seedMessage());
    await plantStaleRecord(
      io,
      seedMessage({
        status: "processing",
        attachments: [
          {
            sha256: "abc",
            providerAttachmentId: "att_1",
            sanitizedFilename: "invoice.pdf",
            status: "completed",
            rejectionCode: null,
            detail: null,
            invoiceId: "inv_earlier",
          },
        ],
      }),
    );

    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(uploads.length, 0);
    assert.equal(result.kind, "done");
    if (result.kind === "done") assert.equal(result.invoiceCount, 1);
  });

  it("re-uploads after a TRANSIENT upload failure, which is not ambiguous", async () => {
    const { authority: failing, provider } = fakes({
      uploadResults: [{ ok: false, transient: true }],
    });
    const first = await processInboundEvent(event(), { config: config(), authority: failing, provider });
    assert.equal(first.kind, "retry");

    // The redelivery succeeds and the invoice is created.
    const { authority: working, provider: p2, uploads } = fakes();
    const second = await processInboundEvent(event(), {
      config: config(),
      authority: working,
      provider: p2,
    });
    assert.equal(second.kind, "done");
    assert.equal(uploads.length, 1);
  });

  it("refuses a virus-flagged message WITHOUT downloading the attachment", async () => {
    const { authority, provider, uploads } = fakes({
      headers: {
        "Return-Path": "<nikhil@savetrix.com>",
        "X-SES-Virus-Verdict": "FAIL",
      },
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "malware_detected");
    assert.equal(uploads.length, 0);
  });

  it("proceeds normally when the provider scan passes", async () => {
    const { authority, provider } = fakes({
      headers: {
        "Return-Path": "<nikhil@savetrix.com>",
        "X-SES-Virus-Verdict": "PASS",
        "X-SES-Spam-Verdict": "PASS",
      },
    });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "done");
  });

  it("says so plainly when the email was forwarded AS AN ATTACHMENT", async () => {
    // Outlook's "Forward as attachment" nests the original message. Reporting
    // that as "no invoice attachment found" sends the accountant hunting for a
    // file they did attach; the actual fix is to forward normally.
    const metas: ResendAttachmentMeta[] = [
      {
        id: "att_nested",
        filename: "Fwd: Invoice.eml",
        contentType: "message/rfc822",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: 90_000,
        downloadUrl: "https://cdn.resend.app/em_1/attachments/att_nested?sig=a",
        expiresAt: null,
      },
    ];
    const { authority, provider, uploads } = fakes({ metas, bytes: {} });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });

    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "forwarded_as_attachment");
    assert.equal(uploads.length, 0);
  });

  it("rejects an email whose only attachment is not a supported type", async () => {
    const metas: ResendAttachmentMeta[] = [
      {
        id: "att_1",
        filename: "contract.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        contentDisposition: "attachment",
        contentId: null,
        sizeBytes: 5000,
        downloadUrl: "https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=a",
        expiresAt: null,
      },
    ];
    const { authority, provider, uploads } = fakes({ metas, bytes: {} });
    const result = await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(result.kind, "rejected");
    assert.equal(uploads.length, 0);
  });

  it("rejects an envelope with too many attachments before downloading anything", async () => {
    const metas: ResendAttachmentMeta[] = Array.from({ length: 12 }, (_, index) => ({
      id: `att_${index}`,
      filename: `f${index}.pdf`,
      contentType: "application/pdf",
      contentDisposition: "attachment",
      contentId: null,
      sizeBytes: 1000,
      downloadUrl: `https://inbound-cdn.resend.com/em_1/attachments/att_${index}?sig=a`,
      expiresAt: null,
    }));
    const { authority, provider, uploads } = fakes({ metas });
    const result = await processInboundEvent(event(), {
      config: config({ limits: { maxAttachments: 10, maxFileBytes: 1e7, maxTotalBytes: 4e7 } }),
      authority,
      provider,
    });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") assert.equal(result.code, "too_many_attachments");
    assert.equal(uploads.length, 0);
  });

  it("ingests with NO per-alias credential stored", async () => {
    // The regression this guards: the pipeline used to refuse outright when an
    // alias carried no sealed refresh token. Uploads are now performed by the
    // service account, so an alias holding no user credential at all is the
    // NORMAL case — and every alias created from now on looks like this.
    __setInboundBlobIoForTests(memoryIo());
    await createAlias(aliasRecord({ sealedRefreshToken: null }));

    const { authority, provider, uploads } = fakes();
    const result = await processInboundEvent(event(), { config: config(), authority, provider });

    assert.equal(result.kind, "done");
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].qbId, "qb_acme");
  });

  it("never stores a user credential on the alias while ingesting", async () => {
    __setInboundBlobIoForTests(memoryIo());
    await createAlias(aliasRecord({ sealedRefreshToken: null }));

    const { authority, provider } = fakes();
    await processInboundEvent(event(), { config: config(), authority, provider });

    const stored = await readAlias(ALIAS_HASH);
    assert.equal(stored?.sealedRefreshToken, null);
  });

  it("treats a redelivery of completed work as a duplicate and uploads nothing", async () => {
    const { authority, provider, uploads } = fakes();
    await processInboundEvent(event(), { config: config(), authority, provider });
    assert.equal(uploads.length, 1);

    const { authority: a2, provider: p2, uploads: u2 } = fakes();
    const again = await processInboundEvent(event(), { config: config(), authority: a2, provider: p2 });
    assert.equal(again.kind, "duplicate");
    assert.equal(u2.length, 0);
  });
});
