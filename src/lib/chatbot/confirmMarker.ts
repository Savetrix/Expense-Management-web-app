// Shared between systemPrompt.ts (instructs the model to emit this exact
// sentence when it wants the user to confirm a destructive action) and
// ChatPanel.tsx (detects the sentence in a completed assistant message to
// trigger the app's real confirmDialog() instead of relying on the user
// noticing it and typing "yes" back). Plain string, safe in both the server
// and client bundles.
export const CONFIRM_MARKER = "Reply yes to confirm, or no to cancel.";

// Out-of-band channel for the consent ticket, server -> client. Deliberately
// NOT part of any tool schema and never shown to the model: the ticket is the
// thing that proves "the user was shown exactly this operation", so letting
// the model hold it would let it mint and spend its own consent. U+001F (unit
// separator) cannot occur in model prose, so the client can strip the line
// unambiguously before rendering.
export const CONSENT_FRAME_PREFIX = "\u001fSAVETRIX_CONSENT:";
export const CONSENT_FRAME_SUFFIX = "\u001f";

const CONSENT_FRAME_RE = new RegExp(`${CONSENT_FRAME_PREFIX}([^${CONSENT_FRAME_SUFFIX}]*)${CONSENT_FRAME_SUFFIX}`);

/** The consent ticket from a reply, if the server attached one. */
export function extractConsentTicket(text: string): string | undefined {
  return CONSENT_FRAME_RE.exec(text)?.[1] || undefined;
}

/**
 * The reply as the user should see it: no consent frame, complete or partial.
 *
 * Cuts at the first U+001F rather than at the full prefix. A frame still
 * arriving may have sent only "\u001fSAVET" so far, which doesn't match the
 * prefix; U+001F never occurs in prose, so everything from it on is control
 * data. Must be applied to the WHOLE reply so far, not to each chunk: a frame
 * split across chunks leaves its second half without any marker at all.
 */
export function stripConsentFrame(text: string): string {
  return text.replace(CONSENT_FRAME_RE, "").split(CONSENT_FRAME_SUFFIX)[0];
}
