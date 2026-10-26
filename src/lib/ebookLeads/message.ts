// SERVER-ONLY (pure, so the tests exercise it directly).
//
// The notification the support inbox receives when someone unlocks an e-book.
//
// Same two rules as lib/customPlanEnquiry/message.ts: every interpolated value
// is attacker-controlled (it comes from a public form), so the HTML part
// escapes all five entities and the subject is length-capped; and both a text
// and an HTML part always ship, because a multipart message with only HTML
// scores worse with spam filters.
import type { EbookIntent, LeadDraft } from "./fields";

const MAX_SUBJECT_SUFFIX = 90;

const INTENT_LABEL: Record<EbookIntent, string> = {
  read: "Started reading online",
  download: "Downloaded the PDF",
};

export interface LeadContext {
  ebookTitle: string;
  intent: EbookIntent;
  /** ISO timestamp of receipt, injected so tests are deterministic. */
  receivedAt: string;
}

export interface BuiltLeadMessage {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** "New e-book lead – Ada Lovelace (AI Invoice Processing for Accountants)". */
export function buildLeadSubject(draft: LeadDraft, ebookTitle: string): string {
  return `New e-book lead – ${truncate(`${draft.firstName} ${draft.lastName} (${ebookTitle})`, MAX_SUBJECT_SUFFIX)}`;
}

export function buildLeadMessage(draft: LeadDraft, context: LeadContext): BuiltLeadMessage {
  const phone = draft.phone || "—";
  const action = INTENT_LABEL[context.intent];

  const text = [
    "Someone unlocked an e-book on scantrix.ai.",
    "",
    `E-book: ${context.ebookTitle}`,
    `Action: ${action}`,
    "",
    `First name: ${draft.firstName}`,
    `Last name: ${draft.lastName}`,
    `Email: ${draft.email}`,
    `Phone: ${phone}`,
    "",
    `Received: ${context.receivedAt}`,
    "",
    "Reply to this email to reach them directly.",
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#475569;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0;color:#06332F"><strong>${escapeHtml(value)}</strong></td></tr>`;

  const html = [
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#06332F">',
    "<p>Someone unlocked an e-book on scantrix.ai.</p>",
    '<table role="presentation" style="border-collapse:collapse">',
    row("E-book", context.ebookTitle),
    row("Action", action),
    row("First name", draft.firstName),
    row("Last name", draft.lastName),
    row("Email", draft.email),
    row("Phone", phone),
    row("Received", context.receivedAt),
    "</table>",
    '<p style="color:#475569">Reply to this email to reach them directly.</p>',
    "</div>",
  ].join("");

  return { subject: buildLeadSubject(draft, context.ebookTitle), text, html };
}
