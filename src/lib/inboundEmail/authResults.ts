// SERVER-ONLY. Recovering SPF/DKIM/DMARC verdicts from fetched headers (§9).
//
// WHY THIS FILE EXISTS AT ALL. The original design assumed the provider would
// hand us authentication results on the webhook event. It does not: Resend's
// `email.received` payload carries `email_id`, `from`, `to`, `cc`, `bcc`,
// `received_for`, `message_id`, `subject` and `attachments` — no SPF/DKIM/DMARC,
// no spam score, no envelope sender (verified against their API reference).
// So the verdicts have to come from the `Authentication-Results` header on the
// message we fetch back with GET /emails/receiving/{id}.
//
// ── THE TRUST PROBLEM, STATED PLAINLY ────────────────────────────────────────
// `Authentication-Results` is only trustworthy when it was written by the MTA
// that actually performed the checks — here, the receiving provider. A forwarded
// invoice arrives carrying the ORIGINAL hop's headers too, and those are
// sender-controlled: anyone can type `Authentication-Results: x; dmarc=pass`
// into a message they send. Per RFC 7601 the receiving MTA prepends its own, so
// the topmost occurrence is the authentic one.
//
// But Resend returns `headers` as a JSON OBJECT, and an object cannot hold two
// entries with the same key. Duplicate `Authentication-Results` headers are
// therefore collapsed before we ever see them, and we cannot tell whether the
// survivor is the provider's or the attacker's.
//
// This is handled honestly rather than papered over:
//
//   1. Each header carries an `authserv-id` naming the server that authenticated
//      the message. Set INBOUND_EXPECTED_AUTHSERV_ID to the provider's id (read
//      it off the diagnostics panel after one test forward) and only a header
//      bearing that id is believed. That is the configuration that makes these
//      verdicts genuinely trustworthy.
//   2. Until it is pinned, verdicts are marked `advisory` and the raw header is
//      surfaced in diagnostics. `advisory` is reported, never silently upgraded.
//   3. The actual security gate is elsewhere and does not depend on any of this:
//      a message only becomes an invoice if its sender resolves to a REGISTERED
//      user with a VERIFIED email who is a member of the alias's QuickBooks
//      company (authorization.ts). Email authentication raises the bar on
//      spoofing; it is not the thing standing between a stranger and your books.
import type { AuthVerdict, EmailAuthResults, InboundAuthResultsDiagnostics } from "./types";

/** Header values as the provider returns them: object, or array of pairs. */
export type FetchedHeaders = Readonly<Record<string, string | string[]>>;

/** Defined in types.ts so the store can persist it without importing this module. */
export type AuthResultsDiagnostics = InboundAuthResultsDiagnostics;

export interface DerivedAuthResults {
  results: EmailAuthResults;
  /** True when no verdict could be established — feeds `authResultsMissing`. */
  missing: boolean;
  diagnostics: AuthResultsDiagnostics;
}

const MAX_DIAGNOSTIC_CHARS = 500;

function truncate(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_DIAGNOSTIC_CHARS ? `${value.slice(0, MAX_DIAGNOSTIC_CHARS)}…` : value;
}

/** Case-insensitive header read that tolerates both provider shapes. */
function readHeader(headers: FetchedHeaders, name: string): string[] {
  const wanted = name.toLowerCase();
  const out: string[] = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
    } else if (typeof value === "string" && value.trim()) {
      out.push(value.trim());
    }
  }
  return out;
}

/**
 * Map one `method=result` verdict onto our closed union.
 *
 * RFC 7601 defines more results than we distinguish. `softfail` and `permerror`
 * collapse to "fail" only for SPF; a DKIM `temperror` is not a failure, it is an
 * absence, because treating a transient DNS problem as a forgery would reject
 * legitimate mail during someone else's outage.
 */
export function mapVerdict(raw: string | null | undefined): AuthVerdict {
  const value = raw?.trim().toLowerCase();
  if (!value) return "none";
  if (value === "pass") return "pass";
  if (value === "fail" || value === "softfail" || value === "permerror") return "fail";
  if (value === "none") return "none";
  // neutral, policy, temperror, unknown, and anything unrecognised.
  return "neutral";
}

interface ParsedHeader {
  authservId: string | null;
  results: EmailAuthResults;
  /** Did the header actually state any of the three methods? */
  stated: boolean;
}

/**
 * Parse one `Authentication-Results` header.
 *
 * Shape (RFC 7601): `authserv-id; method=result reason=... (comment); method=result`
 * Real-world values are messy — comments in parentheses, quoted strings, extra
 * `header.d=` / `smtp.mailfrom=` properties, arbitrary whitespace and folding.
 * So rather than a strict grammar, comments and quoted strings are stripped and
 * then `method=result` pairs are matched, which is robust to the variation.
 */
export function parseAuthenticationResults(raw: string): ParsedHeader {
  // Unfold (a folded header arrives with embedded CRLF + leading whitespace).
  let value = raw.replace(/\r?\n[ \t]+/g, " ");
  // Drop comments, which may legally contain semicolons and '='.
  value = value.replace(/\((?:[^()\\]|\\.)*\)/g, " ");
  // Drop quoted strings for the same reason.
  value = value.replace(/"(?:[^"\\]|\\.)*"/g, '""');

  const firstSemi = value.indexOf(";");
  const head = (firstSemi >= 0 ? value.slice(0, firstSemi) : value).trim();
  // The authserv-id is the first token; a version number may follow it.
  const authservId = head.split(/\s+/)[0]?.trim().toLowerCase() || null;

  const results: EmailAuthResults = { spf: "none", dkim: "none", dmarc: "none" };
  let stated = false;

  // Match `method = result`, where method is one of the three we care about.
  // `[a-z0-9-]+` for the result covers pass/fail/softfail/temperror/permerror.
  const pairs = value.matchAll(/\b(spf|dkim|dmarc)\s*=\s*([a-z0-9-]+)/gi);
  for (const match of pairs) {
    const method = match[1].toLowerCase() as "spf" | "dkim" | "dmarc";
    const verdict = mapVerdict(match[2]);
    stated = true;
    // Multiple DKIM signatures are common (one per signing domain) and any pass
    // is a pass, so never let a later `dkim=fail` demote an earlier `dkim=pass`.
    if (results[method] === "pass") continue;
    results[method] = verdict;
  }

  return { authservId: authservId === "" ? null : authservId, results, stated };
}

/**
 * `Received-SPF: pass (domain of x designates ...)` — the older, SPF-only
 * header. Used only to fill an SPF verdict that `Authentication-Results` did not
 * state, never to overrule one.
 */
export function parseReceivedSpf(raw: string): AuthVerdict {
  const cleaned = raw.replace(/\((?:[^()\\]|\\.)*\)/g, " ").trim();
  return mapVerdict(cleaned.split(/[\s;]+/)[0]);
}

export interface DeriveOptions {
  /**
   * Provider's `authserv-id`. When set, ONLY a header bearing this id is
   * believed — which is what makes a forwarded message's inherited headers
   * unusable by an attacker.
   */
  expectedAuthservId?: string | null;
}

export function deriveAuthResults(
  headers: FetchedHeaders,
  options: DeriveOptions = {},
): DerivedAuthResults {
  const authHeaders = readHeader(headers, "authentication-results");
  const receivedSpfHeaders = readHeader(headers, "received-spf");
  const returnPath = readHeader(headers, "return-path")[0] ?? null;
  const expected = options.expectedAuthservId?.trim().toLowerCase() || null;

  const parsedAll = authHeaders.map((h) => ({ raw: h, parsed: parseAuthenticationResults(h) }));

  // With a pin configured, only a matching header counts. Without one, the
  // first header wins: RFC 7601 has the receiving MTA prepend its own, so the
  // topmost is the provider's whenever the provider preserved order.
  const matching = expected
    ? parsedAll.find((entry) => entry.parsed.authservId === expected)
    : parsedAll[0];

  const chosen = matching ?? null;
  let trust: AuthResultsDiagnostics["trust"];
  if (chosen && expected) trust = "verified";
  else if (chosen) trust = "advisory";
  else if (parsedAll.length > 0 && expected) trust = "rejected";
  else trust = "absent";

  const results: EmailAuthResults = chosen
    ? { ...chosen.parsed.results }
    : { spf: "none", dkim: "none", dmarc: "none" };

  // Fill an unstated SPF verdict from Received-SPF, but never overwrite one.
  if (results.spf === "none" && receivedSpfHeaders.length > 0) {
    results.spf = parseReceivedSpf(receivedSpfHeaders[0]);
  }

  const stated = Boolean(chosen?.parsed.stated) || results.spf !== "none";
  // A pin that matched nothing is treated as "no verdict", NOT as a pass: the
  // only header present is one we have decided not to believe.
  const missing = trust === "rejected" || !stated;

  return {
    results,
    missing,
    diagnostics: {
      authenticationResults: truncate(chosen?.raw ?? parsedAll[0]?.raw ?? null),
      receivedSpf: truncate(receivedSpfHeaders[0] ?? null),
      returnPath: truncate(returnPath),
      authservId: chosen?.parsed.authservId ?? parsedAll[0]?.parsed.authservId ?? null,
      trust,
    },
  };
}
