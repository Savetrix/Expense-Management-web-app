// SERVER-ONLY. Who is allowed to turn an email into an invoice (§8, §9).
//
// Pure decision functions: the caller supplies facts it has already looked up, and
// this returns a verdict. Keeping the policy free of I/O is what makes the whole
// decision table testable without a database, and it means the backend can reuse it
// verbatim regardless of framework.
import { normalizeEmailAddress, sameDomain } from "./address";
import type { EmailAuthResults, RejectionCode } from "./types";

/** Facts about the alias the mail was addressed to. */
export interface AliasFacts {
  active: boolean;
  workspaceId: string;
  /** Tenant-level switch, independent of the global flag. */
  tenantEnabled: boolean;
}

/** Facts about the account matching the parsed sender, as the backend reports them. */
export interface SenderFacts {
  userId: string;
  /** Canonical, already-normalized addresses this user has on file. */
  verifiedEmails: readonly string[];
  unverifiedEmails?: readonly string[];
  active: boolean;
  suspended?: boolean;
  deleted?: boolean;
  /** Workspaces this user may upload invoices into. */
  uploadableWorkspaceIds: readonly string[];
}

export interface AuthorizationInput {
  /** Global kill switch (`INBOUND_EMAIL_ENABLED`). */
  featureEnabled: boolean;
  alias: AliasFacts | null;
  /** Provider-validated envelope sender, when the provider exposes one. */
  envelopeSender: string | null;
  /** Parsed outer `From`. */
  from: string | null;
  /** null when no account matches the resolved sender. */
  sender: SenderFacts | null;
  authResults: EmailAuthResults;
  /** Provider reported no authentication information at all. */
  authResultsMissing?: boolean;
  requireEmailAuth: boolean;
  /** false when subscription/usage rules already say no. */
  withinUsageLimits: boolean;
  /** Match `a+tag@d` to `a@d`. Per-tenant; see NormalizeOptions. */
  stripPlusTag?: boolean;
}

export type AuthorizationDecision =
  | { authorized: true; userId: string; workspaceId: string; senderEmail: string }
  | { authorized: false; code: RejectionCode; detail?: string };

/**
 * The order is the security property, not a style choice: alias before sender, so a
 * probe with a bogus address never reveals whether a sender is registered; and the
 * verified-email check before the permission check, so an unverified address cannot
 * be used to enumerate workspaces.
 */
export function authorizeInboundSender(input: AuthorizationInput): AuthorizationDecision {
  if (!input.featureEnabled) return deny("feature_disabled");

  if (!input.alias) return deny("unknown_alias");
  if (!input.alias.active) return deny("unknown_alias", "revoked");
  if (!input.alias.tenantEnabled) return deny("feature_disabled", "tenant");

  // Prefer the envelope sender: it is what the provider actually validated. The
  // outer From is a fallback, and only ever after RFC parsing.
  const opts = { stripPlusTag: input.stripPlusTag };
  const claimed =
    normalizeEmailAddress(input.envelopeSender, opts) ?? normalizeEmailAddress(input.from, opts);
  if (!claimed) return deny("sender_not_registered", "unparseable sender");

  if (!input.sender) return deny("sender_not_registered");

  const verified = input.sender.verifiedEmails.map((e) => normalizeEmailAddress(e, opts));
  if (!verified.includes(claimed)) {
    const unverified = (input.sender.unverifiedEmails ?? []).map((e) => normalizeEmailAddress(e, opts));
    // Distinguishing these two matters operationally: "verify your email" is
    // actionable for the user, "not registered" is not.
    return deny(unverified.includes(claimed) ? "sender_not_verified" : "sender_not_registered");
  }

  if (input.sender.deleted || input.sender.suspended || !input.sender.active) {
    return deny("account_inactive");
  }

  if (!input.sender.uploadableWorkspaceIds.includes(input.alias.workspaceId)) {
    return deny("sender_not_authorized");
  }

  const auth = evaluateEmailAuthentication({
    results: input.authResults,
    missing: input.authResultsMissing ?? false,
    requireEmailAuth: input.requireEmailAuth,
    envelopeSender: input.envelopeSender,
    from: input.from,
  });
  if (!auth.acceptable) return deny("authentication_failed", auth.reason);

  // Quota last: it is the only check whose answer can change minute to minute, and
  // reporting it to an already-authorized user is safe.
  if (!input.withinUsageLimits) return deny("usage_limit_exceeded");

  return {
    authorized: true,
    userId: input.sender.userId,
    workspaceId: input.alias.workspaceId,
    senderEmail: claimed,
  };
}

export interface EmailAuthInput {
  results: EmailAuthResults;
  missing: boolean;
  requireEmailAuth: boolean;
  envelopeSender: string | null;
  from: string | null;
}

/**
 * §9's table. DKIM-only is accepted deliberately: forwarding from your own mailbox
 * routinely breaks SPF while DKIM survives, so rejecting on SPF alone would break
 * the feature's primary use case. SPF-only is accepted only when the envelope and
 * From domains agree, which is what makes it meaningful.
 */
export function evaluateEmailAuthentication(
  input: EmailAuthInput,
): { acceptable: boolean; reason?: string } {
  if (input.missing) {
    return input.requireEmailAuth
      ? { acceptable: false, reason: "no provider auth results" }
      : { acceptable: true };
  }

  const { spf, dkim, dmarc } = input.results;

  if (dmarc === "pass") return { acceptable: true };
  if (dmarc === "fail") return { acceptable: false, reason: "dmarc fail" };

  if (dkim === "pass" && spf === "pass") return { acceptable: true };
  if (dkim === "pass") return { acceptable: true };

  if (spf === "pass") {
    return sameDomain(input.envelopeSender, input.from)
      ? { acceptable: true }
      : { acceptable: false, reason: "spf pass but domain mismatch" };
  }

  return { acceptable: false, reason: "no passing mechanism" };
}

function deny(code: RejectionCode, detail?: string): AuthorizationDecision {
  return { authorized: false, code, detail };
}

/**
 * Loop and auto-responder suppression (§16). Checked before authorization so a
 * bounce storm never reaches the decision table at all.
 */
export function isAutomatedMessage(headers: Readonly<Record<string, string>>): boolean {
  const get = (name: string): string => {
    const key = Object.keys(headers).find((h) => h.toLowerCase() === name);
    return key ? String(headers[key] ?? "").toLowerCase() : "";
  };

  if (get("auto-submitted") && get("auto-submitted") !== "no") return true;
  if (get("x-autoreply")) return true;
  if (get("x-autorespond")) return true;
  if (get("precedence").match(/bulk|junk|list|auto_reply/)) return true;
  if (get("x-auto-response-suppress")) return true;
  if (get("list-id") || get("list-unsubscribe")) return true;
  // A delivery report is a bounce, not an invoice.
  if (get("content-type").includes("multipart/report")) return true;
  if (get("x-failed-recipients")) return true;
  // Our own notification sender must never re-enter the pipeline.
  if (get("x-savetrix-correlation-id")) return true;
  return false;
}
