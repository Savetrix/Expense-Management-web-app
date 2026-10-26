// ISOMORPHIC. The one definition of what a valid e-book access request looks
// like, shared by the form in the browser and the route handler so the inline
// error a visitor sees is the error the server would have produced. The server
// is still the authority: everything here runs again in
// src/app/api/ebooks/lead/route.ts.
//
// Reuses the Custom Plan enquiry's sanitizing and email rules rather than
// restating them, so the two public forms can never disagree on what a valid
// address is. That module is dependency-free, so importing it here is safe for
// the client bundle.
import { isPlausibleEmail, sanitizeLine } from "@/lib/customPlanEnquiry/fields";

export type LeadField = "firstName" | "lastName" | "email" | "phone";

export const LEAD_FIELDS: readonly LeadField[] = ["firstName", "lastName", "email", "phone"];

export const LEAD_LIMITS = {
  firstName: { min: 1, max: 60 },
  lastName: { min: 1, max: 60 },
  phone: { max: 30 },
} as const;

/** What the visitor did that opened the form: it decides what happens after. */
export type EbookIntent = "read" | "download";

export function isEbookIntent(value: unknown): value is EbookIntent {
  return value === "read" || value === "download";
}

export interface LeadDraft {
  firstName: string;
  lastName: string;
  email: string;
  /** Optional. Empty string when not given. */
  phone: string;
}

export const EMPTY_LEAD: LeadDraft = { firstName: "", lastName: "", email: "", phone: "" };

export type LeadErrors = Partial<Record<LeadField, string>>;

/** Normalize a raw draft into the exact strings that will be validated and sent. */
export function sanitizeLead(raw: Partial<Record<LeadField, unknown>>): LeadDraft {
  return {
    firstName: sanitizeLine(raw.firstName),
    lastName: sanitizeLine(raw.lastName),
    // Only the ends are trimmed: an interior space makes the address invalid
    // and the visitor should be told so, not have it silently deleted.
    email: typeof raw.email === "string" ? raw.email.trim() : "",
    phone: sanitizeLine(raw.phone),
  };
}

/**
 * Digits, spaces and the usual separators, with an optional leading "+". At
 * least seven digits, so "123" is rejected but "(416) 555-0123" and
 * "+44 20 7946 0958" both pass. Deliberately not country-specific.
 */
export function isPlausiblePhone(value: string): boolean {
  if (!/^\+?[0-9 ().-]+$/.test(value)) return false;
  return value.replace(/\D/g, "").length >= 7;
}

/** Validate one already-sanitized field. Null means it is fine. */
export function validateLeadField(field: LeadField, value: string): string | null {
  switch (field) {
    case "firstName":
      if (!value) return "Please enter your first name.";
      if (value.length > LEAD_LIMITS.firstName.max) return "Please keep your first name under 60 characters.";
      return null;
    case "lastName":
      if (!value) return "Please enter your last name.";
      if (value.length > LEAD_LIMITS.lastName.max) return "Please keep your last name under 60 characters.";
      return null;
    case "email":
      if (!value) return "Please enter your email address.";
      if (!isPlausibleEmail(value)) return "Please enter a valid email address.";
      return null;
    case "phone":
      // Optional: empty is fine, anything given must look like a phone number.
      if (!value) return null;
      if (value.length > LEAD_LIMITS.phone.max || !isPlausiblePhone(value)) {
        return "Please enter a valid phone number, or leave it blank.";
      }
      return null;
  }
}

/** Validate a whole sanitized draft. An empty object means it is good to send. */
export function validateLead(draft: LeadDraft): LeadErrors {
  const errors: LeadErrors = {};
  for (const field of LEAD_FIELDS) {
    const error = validateLeadField(field, draft[field]);
    if (error) errors[field] = error;
  }
  return errors;
}
