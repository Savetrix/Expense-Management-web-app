// SERVER-ONLY. Environment configuration for Custom Plan enquiries.
//
// Same shape and the same reasoning as lib/inboundEmail/config.ts: reading
// config is separated from using it so a misconfigured deployment produces one
// clear diagnostic ("which variables are missing") instead of a confusing
// failure deep inside the send path.
//
// None of these may ever take a NEXT_PUBLIC_ prefix. A NEXT_PUBLIC_ variable is
// inlined into the browser bundle, which would publish the provider API key to
// anyone who opens devtools. The recipient address is not a secret, but it stays
// server-side too — a sales inbox in the client bundle is a scraping target.
import { normalizeEmailAddress, parseEmailAddress } from "../inboundEmail/address";

/**
 * Where enquiries go when CUSTOM_PLAN_ENQUIRY_TO_EMAIL is unset.
 *
 * This is the support address the app already publishes in the profile screen
 * (src/components/profile/ProfileContent.tsx) — a real, verified Scantrix
 * mailbox rather than a guess, which is why it is safe as a fallback. Point the
 * env var at a dedicated sales inbox when one exists; until then enquiries land
 * somewhere a human actually reads.
 */
export const DEFAULT_ENQUIRY_RECIPIENT = "support@scantrix.ai";

export interface EnquiryConfig {
  /** Canonicalized recipient address. */
  recipient: string;
  /** Raw `from` value — may carry a display name, so it is NOT canonicalized. */
  fromAddress: string;
  providerApiKey: string;
}

export type EnquiryConfigOutcome =
  | { ok: true; config: EnquiryConfig }
  | { ok: false; missing: string[]; detail?: string };

export function readEnquiryConfig(): EnquiryConfigOutcome {
  const missing: string[] = [];

  // The sending key. Falls back to the inbound key because on most deployments
  // they are the same Resend account and a full-access key covers both — but it
  // is a SEPARATE variable so an installation running a read-scoped inbound key
  // can hand sending its own credential without weakening the inbound one.
  const providerApiKey =
    process.env.OUTBOUND_EMAIL_API_KEY?.trim() || process.env.INBOUND_PROVIDER_API_KEY?.trim();
  if (!providerApiKey) missing.push("OUTBOUND_EMAIL_API_KEY");

  // No fallback here on purpose. Guessing a sender means guessing which domain
  // is verified for sending, and a wrong guess fails at the provider with a 403
  // that looks like an outage rather than a missing setting.
  const fromAddress = process.env.CUSTOM_PLAN_ENQUIRY_FROM_EMAIL?.trim();
  if (!fromAddress) missing.push("CUSTOM_PLAN_ENQUIRY_FROM_EMAIL");

  const recipientRaw = process.env.CUSTOM_PLAN_ENQUIRY_TO_EMAIL?.trim() || DEFAULT_ENQUIRY_RECIPIENT;
  const recipient = normalizeEmailAddress(recipientRaw);

  if (missing.length > 0) return { ok: false, missing };

  // Shape problems are reported as a `detail` rather than a missing variable:
  // the operator set something, it just is not usable, and saying which is the
  // difference between a five-second fix and a hunt.
  if (!recipient) {
    return {
      ok: false,
      missing: [],
      detail: "CUSTOM_PLAN_ENQUIRY_TO_EMAIL is not a valid email address",
    };
  }
  if (!parseEmailAddress(fromAddress as string)) {
    return {
      ok: false,
      missing: [],
      detail:
        'CUSTOM_PLAN_ENQUIRY_FROM_EMAIL is not a valid address (use "a@b.com" or "Name <a@b.com>")',
    };
  }

  return {
    ok: true,
    config: {
      recipient,
      fromAddress: fromAddress as string,
      providerApiKey: providerApiKey as string,
    },
  };
}
