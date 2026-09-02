// SERVER-ONLY (pure, so the tests exercise it directly).
//
// Turns a validated enquiry into the notification the sales inbox receives.
//
// Two rules govern everything here:
//
//   1. EVERY interpolated value is attacker-controlled. Name, company and
//      message come from an unauthenticated public form, so the HTML part
//      escapes all five entities and the subject is length-capped. The fields
//      have already had control characters stripped (fields.ts), which is what
//      keeps a newline in "name" from becoming a forged header.
//   2. Both parts always ship. A text/plain alternative is not decoration — a
//      multipart message with only HTML scores materially worse with spam
//      filters, and this mail must not land in junk.
import type { EnquiryDraft, EnquirySurface } from "./fields";

/**
 * Subject ceiling. RFC 5322 recommends folding beyond 78 characters and most
 * clients truncate somewhere past 100; capping the interpolated half keeps the
 * meaningful part visible in an inbox list.
 */
const MAX_SUBJECT_SUFFIX = 80;

const SURFACE_LABEL: Record<EnquirySurface, string> = {
  app: "In-app plans page (/plans)",
  landing: "Public pricing section (scantrix.ai)",
};

export interface EnquiryContext {
  surface: EnquirySurface;
  /** ISO timestamp of receipt, injected so tests are deterministic. */
  receivedAt: string;
  /**
   * The signed-in user's id, when the enquiry came from inside the app.
   *
   * Included because it lets sales tie the enquiry to an existing account
   * without asking. It is an opaque id, not personal data beyond what the form
   * already carries.
   */
  userId?: string | null;
}

export interface BuiltMessage {
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

/**
 * "New Custom Plan Enquiry – Acme Ltd".
 *
 * Company wins over name when present: sales triage by account, and two people
 * from the same company should sort together in an inbox.
 */
export function buildSubject(draft: EnquiryDraft): string {
  const who = truncate(draft.company || draft.name, MAX_SUBJECT_SUFFIX);
  return `New Custom Plan Enquiry – ${who}`;
}

export function buildEnquiryMessage(draft: EnquiryDraft, context: EnquiryContext): BuiltMessage {
  const company = draft.company || "—";
  const source = SURFACE_LABEL[context.surface];
  const account = context.userId ? context.userId : "Not signed in";

  const text = [
    "New Custom Plan enquiry from the Scantrix pricing page.",
    "",
    `Name:      ${draft.name}`,
    `Email:     ${draft.email}`,
    `Company:   ${company}`,
    `Source:    ${source}`,
    `Account:   ${account}`,
    `Received:  ${context.receivedAt}`,
    "",
    "Requirements",
    "------------",
    draft.message,
    "",
    "--",
    `Reply directly to this email to reach ${draft.name}.`,
  ].join("\n");

  // Table-based layout and inline styles, because email clients strip <style>
  // blocks and support neither flexbox nor grid reliably. The palette is the
  // app's own tokens (globals.css): teal #1fb6aa, navy #1f3a5f, ink #0f172a.
  const rows = [
    ["Name", escapeHtml(draft.name)],
    // mailto so the address is one click away in clients that do not linkify.
    ["Email", `<a href="mailto:${escapeHtml(draft.email)}" style="color:#0f8074;">${escapeHtml(draft.email)}</a>`],
    ["Company", escapeHtml(company)],
    ["Source", escapeHtml(source)],
    ["Account", escapeHtml(account)],
    ["Received", escapeHtml(context.receivedAt)],
  ]
    .map(
      ([label, value]) => `
          <tr>
            <td style="padding:6px 16px 6px 0;color:#475569;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>
            <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${value}</td>
          </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
      <tr>
        <td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#1fb6aa;">Scantrix</p>
          <h1 style="margin:0;font-size:20px;line-height:1.3;color:#1f3a5f;">New Custom Plan enquiry</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 28px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">Requirements</p>
          <div style="padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(draft.message)}</div>
          <p style="margin:16px 0 0;font-size:12.5px;color:#475569;">Reply directly to this email to reach ${escapeHtml(draft.name)}.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: buildSubject(draft), text, html };
}
