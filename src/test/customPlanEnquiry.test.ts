// Tests for the Custom Plan enquiry feature.
//
// The focus is the security-bearing and correctness-bearing decisions, the same
// way inboundEmail.test.ts is scoped: which strings are accepted, what survives
// sanitisation, what the sales inbox actually receives, and when a second
// submission counts as a duplicate. The network call to Resend is not exercised
// here — lib/email/send.ts is a thin fetch wrapper and there is no seam worth
// mocking for the value it would add.
//
// Run with: npm test
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  DUPLICATE_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  __resetAbuseStateForTests,
  clientKey,
  enquiryFingerprint,
  forgetFingerprint,
  isDuplicate,
  isRateLimited,
} from "../lib/customPlanEnquiry/abuse";
import {
  FIELD_LIMITS,
  isPlausibleEmail,
  sanitizeDraft,
  sanitizeLine,
  sanitizeMultiline,
  validateDraft,
  validateField,
  type EnquiryDraft,
} from "../lib/customPlanEnquiry/fields";
import { buildEnquiryMessage, buildSubject } from "../lib/customPlanEnquiry/message";
import { normalizeEmailAddress } from "../lib/inboundEmail/address";

const validDraft = (overrides: Partial<EnquiryDraft> = {}): EnquiryDraft => ({
  name: "Priya Raman",
  email: "priya@acme.com",
  company: "Acme Holdings",
  message: "We run six entities and push about 4,000 invoices a month.",
  ...overrides,
});

// ── email shape ────────────────────────────────────────────────────────────
describe("enquiry email validation", () => {
  it("accepts ordinary work addresses", () => {
    for (const address of [
      "priya@acme.com",
      "a.b+tag@sub.example.co.uk",
      "finance-team@acme-holdings.com",
      "x@y.io",
    ]) {
      assert.equal(isPlausibleEmail(address), true, address);
    }
  });

  it("rejects the shapes that break downstream", () => {
    for (const address of [
      "",
      "no-at-sign.com",
      "two@@at.com",
      "@nolocal.com",
      "nodomain@",
      "no@dot",
      "trailing@dot.",
      "double@dot..com",
      "spaced address@acme.com",
      "under@-hyphen.com",
    ]) {
      assert.equal(isPlausibleEmail(address), false, address);
    }
  });

  it("rejects an address carrying CR or LF, which is the header-injection case", () => {
    // If this ever passes, a submitted address becomes a forged Reply-To plus
    // an arbitrary extra header.
    assert.equal(isPlausibleEmail("priya@acme.com\r\nBcc: victim@elsewhere.com"), false);
    assert.equal(isPlausibleEmail("priya@acme.com\nX-Injected: 1"), false);
  });

  it("never accepts an address that lib/inboundEmail/address.ts would reject", () => {
    // fields.ts must stay the STRICTER of the two: the route validates with
    // fields.ts and then canonicalizes with normalizeEmailAddress, so a gap
    // between them would surface as a confusing 400 after a green form.
    const candidates = [
      "priya@acme.com",
      "a.b+tag@sub.example.co.uk",
      "UPPER@Example.COM",
      "x@y.io",
      "finance-team@acme-holdings.com",
    ];
    for (const address of candidates) {
      if (isPlausibleEmail(address)) {
        assert.notEqual(normalizeEmailAddress(address), null, address);
      }
    }
  });
});

// ── sanitisation ───────────────────────────────────────────────────────────
describe("enquiry sanitisation", () => {
  it("strips control characters from single-line fields", () => {
    assert.equal(sanitizeLine("Priya\r\nRaman"), "Priya Raman");
    assert.equal(sanitizeLine("Acme\u0000Holdings"), "Acme Holdings");
    assert.equal(sanitizeLine("  spaced   out  "), "spaced out");
  });

  it("keeps paragraphs in the message but drops other control characters", () => {
    const cleaned = sanitizeMultiline("Line one\r\n\r\nLine two\u0007 end");
    assert.equal(cleaned, "Line one\n\nLine two end");
  });

  it("collapses runs of blank lines so a pasted block cannot stretch the email", () => {
    assert.equal(sanitizeMultiline("a\n\n\n\n\n\nb"), "a\n\nb");
  });

  it("does not silently repair an address — an interior space stays invalid", () => {
    // Trimming the ends is a convenience; deleting an interior space would
    // change which mailbox the user asked us to reply to.
    const draft = sanitizeDraft({ email: "  priya raman@acme.com  " });
    assert.equal(draft.email, "priya raman@acme.com");
    assert.equal(validateField("email", draft.email), "Please enter a valid email address.");
  });

  it("coerces non-string input rather than throwing", () => {
    // The route hands sanitizeDraft a parsed JSON object whose fields can be
    // any type at all.
    const draft = sanitizeDraft({ name: 42, email: null, company: [], message: { a: 1 } });
    assert.deepEqual(draft, { name: "", email: "", company: "", message: "" });
  });
});

// ── field rules ────────────────────────────────────────────────────────────
describe("enquiry field rules", () => {
  it("passes a complete draft", () => {
    assert.deepEqual(validateDraft(validDraft()), {});
  });

  it("requires name, email and message but not company", () => {
    const errors = validateDraft({ name: "", email: "", company: "", message: "" });
    assert.ok(errors.name);
    assert.ok(errors.email);
    assert.ok(errors.message);
    assert.equal(errors.company, undefined);
  });

  it("rejects a message too short to act on", () => {
    assert.ok(validateDraft(validDraft({ message: "hi" })).message);
  });

  it("enforces the length ceilings", () => {
    assert.ok(validateDraft(validDraft({ name: "n".repeat(FIELD_LIMITS.name.max + 1) })).name);
    assert.ok(
      validateDraft(validDraft({ company: "c".repeat(FIELD_LIMITS.company.max + 1) })).company,
    );
    assert.ok(
      validateDraft(validDraft({ message: "m".repeat(FIELD_LIMITS.message.max + 1) })).message,
    );
  });
});

// ── the notification itself ────────────────────────────────────────────────
describe("enquiry notification", () => {
  const context = { surface: "landing" as const, receivedAt: "2026-09-02T10:00:00.000Z" };

  it("names the company in the subject, falling back to the person", () => {
    assert.equal(buildSubject(validDraft()), "New Custom Plan Enquiry – Acme Holdings");
    assert.equal(
      buildSubject(validDraft({ company: "" })),
      "New Custom Plan Enquiry – Priya Raman",
    );
  });

  it("caps the subject so a hostile company name cannot run away with it", () => {
    const subject = buildSubject(validDraft({ company: "Z".repeat(500) }));
    assert.ok(subject.length < 130, `subject was ${subject.length} chars`);
    assert.ok(subject.startsWith("New Custom Plan Enquiry – "));
  });

  it("escapes HTML in every interpolated field", () => {
    const { html } = buildEnquiryMessage(
      validDraft({
        name: '<img src=x onerror="alert(1)">',
        company: "A & B <Ltd>",
        message: "</div><script>alert(2)</script>",
      }),
      context,
    );
    // What matters is that no user-supplied TAG survives — an `onerror=` that
    // is only ever inert text inside `&lt;img ... &gt;` cannot execute, so
    // asserting on the bare substring would fail on correct output.
    assert.ok(!html.includes("<script"), "a raw <script> tag reached the HTML part");
    assert.ok(!html.includes("<img"), "a raw <img> tag reached the HTML part");
    assert.ok(!html.includes('onerror="alert'), "an unescaped event handler reached the HTML part");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    assert.ok(html.includes("A &amp; B &lt;Ltd&gt;"));
  });

  it("carries the full message and the contact details in both parts", () => {
    const draft = validDraft();
    const { text, html } = buildEnquiryMessage(draft, context);
    for (const part of [text, html]) {
      assert.ok(part.includes(draft.name));
      assert.ok(part.includes(draft.email));
      assert.ok(part.includes(draft.company));
      assert.ok(part.includes("4,000 invoices a month"));
    }
  });

  it("records which surface the enquiry came from", () => {
    assert.ok(buildEnquiryMessage(validDraft(), context).text.includes("Public pricing section"));
    assert.ok(
      buildEnquiryMessage(validDraft(), { ...context, surface: "app" }).text.includes("/plans"),
    );
  });

  it("says so plainly when the sender was not signed in", () => {
    assert.ok(buildEnquiryMessage(validDraft(), context).text.includes("Not signed in"));
    assert.ok(
      buildEnquiryMessage(validDraft(), { ...context, userId: "u_123" }).text.includes("u_123"),
    );
  });
});

// ── abuse controls ─────────────────────────────────────────────────────────
describe("enquiry rate limiting", () => {
  beforeEach(() => __resetAbuseStateForTests());

  it("allows a normal burst and blocks beyond the cap", () => {
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i += 1) {
      assert.equal(isRateLimited("1.2.3.4", now), false, `attempt ${i + 1} should pass`);
    }
    assert.equal(isRateLimited("1.2.3.4", now), true);
  });

  it("keeps a hammering client blocked instead of letting it slide back under the cap", () => {
    // Over-limit attempts are still recorded, so the window never empties while
    // the client keeps trying.
    const start = Date.now();
    for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i += 1) isRateLimited("1.2.3.4", start);
    assert.equal(isRateLimited("1.2.3.4", start + RATE_LIMIT_WINDOW_MS - 1), true);
  });

  it("forgets a client once its window has passed", () => {
    const start = Date.now();
    for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i += 1) isRateLimited("1.2.3.4", start);
    assert.equal(isRateLimited("1.2.3.4", start + RATE_LIMIT_WINDOW_MS + 1), false);
  });

  it("buckets clients separately", () => {
    const now = Date.now();
    for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i += 1) isRateLimited("1.2.3.4", now);
    assert.equal(isRateLimited("5.6.7.8", now), false);
  });

  it("takes the FIRST x-forwarded-for entry, which is the real peer on Vercel", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" });
    assert.equal(clientKey(headers), "203.0.113.9");
  });

  it("falls back to a shared bucket rather than treating every request as unique", () => {
    // Failing toward "rate-limit more traffic together" is the safe direction —
    // a per-request unique key would disable the limiter entirely.
    assert.equal(clientKey(new Headers()), "unknown");
    assert.equal(clientKey(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  });
});

describe("enquiry duplicate suppression", () => {
  beforeEach(() => __resetAbuseStateForTests());

  const print = () => enquiryFingerprint("priya@acme.com", "We run six entities.");

  it("treats the same enquiry inside the window as a duplicate", () => {
    const now = Date.now();
    assert.equal(isDuplicate(print(), now), false);
    assert.equal(isDuplicate(print(), now + 1_000), true);
  });

  it("lets the same enquiry through again once the window has passed", () => {
    const now = Date.now();
    isDuplicate(print(), now);
    assert.equal(isDuplicate(print(), now + DUPLICATE_WINDOW_MS + 1), false);
  });

  it("ignores address casing but not an edited message", () => {
    assert.equal(
      enquiryFingerprint("Priya@Acme.com", "same text"),
      enquiryFingerprint("priya@acme.com", "same text"),
    );
    assert.notEqual(
      enquiryFingerprint("priya@acme.com", "same text"),
      enquiryFingerprint("priya@acme.com", "same text plus a correction"),
    );
  });

  it("does not let one person's enquiry block another's", () => {
    const now = Date.now();
    isDuplicate(enquiryFingerprint("a@x.com", "hello there"), now);
    assert.equal(isDuplicate(enquiryFingerprint("b@x.com", "hello there"), now), false);
  });

  it("releases the fingerprint after a failed send so the retry is not swallowed", () => {
    // The whole point: a provider outage must not turn the user's retry into a
    // silent "already received" and lose the enquiry.
    const now = Date.now();
    const fingerprint = print();
    assert.equal(isDuplicate(fingerprint, now), false);
    forgetFingerprint(fingerprint);
    assert.equal(isDuplicate(fingerprint, now + 1_000), false);
  });
});
