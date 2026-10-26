// The e-book lead form: field rules, and the email the support inbox receives.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEbookIntent,
  isPlausiblePhone,
  sanitizeLead,
  validateLead,
  validateLeadField,
} from "../lib/ebookLeads/fields";
import { buildLeadMessage, buildLeadSubject } from "../lib/ebookLeads/message";

const valid = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "" };

describe("lead validation", () => {
  it("accepts a complete lead with no phone number", () => {
    assert.deepEqual(validateLead(sanitizeLead(valid)), {});
  });

  it("requires first name, last name and email", () => {
    const errors = validateLead(sanitizeLead({ firstName: "", lastName: "  ", email: "" }));
    assert.ok(errors.firstName);
    assert.ok(errors.lastName);
    assert.ok(errors.email);
    assert.equal(errors.phone, undefined);
  });

  it("rejects a malformed email and one carrying a newline", () => {
    assert.ok(validateLeadField("email", "not-an-email"));
    assert.ok(validateLeadField("email", "a@b.com\r\nBcc: x@y.com"));
  });

  it("treats the phone number as optional but checks it when given", () => {
    assert.equal(validateLeadField("phone", ""), null);
    assert.equal(validateLeadField("phone", "(416) 555-0123"), null);
    assert.equal(validateLeadField("phone", "+44 20 7946 0958"), null);
    assert.ok(validateLeadField("phone", "123"));
    assert.ok(validateLeadField("phone", "call me maybe"));
  });

  it("counts digits, not punctuation, for the phone minimum", () => {
    assert.equal(isPlausiblePhone("------"), false);
    assert.equal(isPlausiblePhone("555-0123"), true);
  });

  it("strips control characters from names", () => {
    const lead = sanitizeLead({ ...valid, firstName: "Ada\r\nBcc: x@y.com" });
    assert.ok(!/[\r\n]/.test(lead.firstName));
  });
});

describe("intent", () => {
  it("accepts only read and download", () => {
    assert.equal(isEbookIntent("read"), true);
    assert.equal(isEbookIntent("download"), true);
    assert.equal(isEbookIntent("delete"), false);
    assert.equal(isEbookIntent(undefined), false);
  });
});

describe("lead email", () => {
  const context = {
    ebookTitle: "AI Invoice Processing for Accountants",
    intent: "download" as const,
    receivedAt: "2026-10-26T12:00:00.000Z",
  };

  it("names the person and the e-book in the subject", () => {
    const subject = buildLeadSubject(sanitizeLead(valid), context.ebookTitle);
    assert.match(subject, /Ada Lovelace/);
    assert.match(subject, /AI Invoice Processing/);
  });

  it("shows every field in both the text and the HTML part", () => {
    const message = buildLeadMessage(sanitizeLead({ ...valid, phone: "416 555 0123" }), context);
    for (const part of [message.text, message.html]) {
      assert.match(part, /Ada/);
      assert.match(part, /Lovelace/);
      assert.match(part, /ada@example\.com/);
      assert.match(part, /416 555 0123/);
      assert.match(part, /Downloaded the PDF/);
    }
  });

  it("shows a dash when no phone number was given", () => {
    const message = buildLeadMessage(sanitizeLead(valid), context);
    assert.match(message.text, /Phone: —/);
  });

  it("escapes HTML in everything the visitor typed", () => {
    const evil = sanitizeLead({ ...valid, firstName: "<script>alert(1)</script>", lastName: 'O"Brien' });
    const { html } = buildLeadMessage(evil, context);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /O&quot;Brien/);
  });

  it("caps a very long subject", () => {
    const long = sanitizeLead({ ...valid, firstName: "A".repeat(60), lastName: "B".repeat(60) });
    assert.ok(buildLeadSubject(long, "T".repeat(200)).length < 130);
  });
});
