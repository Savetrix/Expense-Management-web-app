// ISOMORPHIC. The one definition of what a valid Custom Plan enquiry looks like.
//
// Deliberately dependency-free so the browser and the route handler validate
// against the SAME rules rather than two implementations that drift apart. The
// server is still the authority — everything here runs again in
// src/app/api/custom-plan-enquiry/route.ts — but a shared module means an
// inline error the user sees is the error the server would have produced.
//
// Nothing in this file may import from lib/inboundEmail/*: those modules are
// server-only and pulling one in would drag it into the client bundle. The
// email rules below intentionally mirror `isPlausibleAddress` in
// lib/inboundEmail/address.ts, so anything accepted here is also accepted by
// that module's `normalizeEmailAddress`, which the route uses to canonicalize.

export type EnquiryField = "name" | "email" | "company" | "message";

/**
 * Length bounds, shared with the form so the counter and the server agree.
 *
 * `message.min` is 10 rather than 1 on purpose: a one-word enquiry gives sales
 * nothing to act on, and it is the single cheapest filter against drive-by
 * form spam that gets past the honeypot.
 */
export const FIELD_LIMITS = {
  name: { min: 2, max: 100 },
  email: { min: 3, max: 320 },
  company: { min: 0, max: 120 },
  message: { min: 10, max: 4000 },
} as const;

export interface EnquiryDraft {
  name: string;
  email: string;
  company: string;
  message: string;
}

export const EMPTY_DRAFT: EnquiryDraft = { name: "", email: "", company: "", message: "" };

/** Per-field messages, keyed by field. Absent key = that field is fine. */
export type FieldErrors = Partial<Record<EnquiryField, string>>;

/**
 * Conservative address check, matching lib/inboundEmail/address.ts's rules:
 * exactly one '@', a non-empty local-part free of whitespace and control
 * characters, and a domain with at least one dot and no consecutive dots.
 *
 * This is not a full RFC 5322 validator and does not try to be. It rejects the
 * shapes that cause trouble downstream — chiefly anything carrying a CR or LF,
 * which is what turns an address into a header-injection vector once it is used
 * as Reply-To.
 */
export function isPlausibleEmail(value: string): boolean {
  if (value.length < FIELD_LIMITS.email.min || value.length > FIELD_LIMITS.email.max) return false;
  if (/[\s\x00-\x1f\x7f]/.test(value)) return false;

  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 255) return false;
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..") || local.includes("..")) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return false;
  return true;
}

/**
 * Collapse a single-line field to something safe to place in a header or a
 * subject: control characters (CR and LF above all) removed outright, runs of
 * whitespace collapsed, ends trimmed.
 *
 * Stripping rather than rejecting is right for name/company — a pasted value
 * with a stray newline is a formatting accident, not an attack, and the user
 * should not be blocked over it. `email` is NOT put through this: a control
 * character there is a rejection, not something to quietly clean up.
 */
export function sanitizeLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Same idea for the message body, but newlines survive — they are the user's
 * paragraphing. CRLF is normalized to LF, other control characters go, and runs
 * of three or more blank lines collapse to two so a pasted block cannot stretch
 * the notification email indefinitely.
 */
export function sanitizeMultiline(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Normalize a raw draft into the exact strings that will be validated and sent. */
export function sanitizeDraft(raw: Partial<Record<EnquiryField, unknown>>): EnquiryDraft {
  return {
    name: sanitizeLine(raw.name),
    // Only the ends are trimmed: an interior space makes the address invalid
    // and the user should be told so, not have it silently deleted.
    email: typeof raw.email === "string" ? raw.email.trim() : "",
    company: sanitizeLine(raw.company),
    message: sanitizeMultiline(raw.message),
  };
}

/**
 * Validate one already-sanitized field. Returns null when the field is fine.
 *
 * Per-field rather than whole-form so the modal can validate on blur without
 * lighting up every untouched field at once.
 */
export function validateField(field: EnquiryField, value: string): string | null {
  switch (field) {
    case "name":
      if (!value) return "Please enter your name.";
      if (value.length < FIELD_LIMITS.name.min) return "Please enter your full name.";
      if (value.length > FIELD_LIMITS.name.max) {
        return `Please keep your name under ${FIELD_LIMITS.name.max} characters.`;
      }
      return null;

    case "email":
      if (!value) return "Please enter your email address.";
      if (!isPlausibleEmail(value)) return "Please enter a valid email address.";
      return null;

    case "company":
      // Optional. Only a length ceiling applies.
      if (value.length > FIELD_LIMITS.company.max) {
        return `Please keep the company name under ${FIELD_LIMITS.company.max} characters.`;
      }
      return null;

    case "message":
      if (!value) return "Please tell us what you need.";
      if (value.length < FIELD_LIMITS.message.min) {
        return "Please add a little more detail so we can prepare a useful answer.";
      }
      if (value.length > FIELD_LIMITS.message.max) {
        return `Please keep your message under ${FIELD_LIMITS.message.max} characters.`;
      }
      return null;
  }
}

export const ENQUIRY_FIELDS: readonly EnquiryField[] = ["name", "email", "company", "message"];

/** Validate a whole sanitized draft. An empty object means it is good to send. */
export function validateDraft(draft: EnquiryDraft): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of ENQUIRY_FIELDS) {
    const error = validateField(field, draft[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

/** Which pricing surface the enquiry came from. Recorded for sales context only. */
export type EnquirySurface = "app" | "landing";

export function isEnquirySurface(value: unknown): value is EnquirySurface {
  return value === "app" || value === "landing";
}
