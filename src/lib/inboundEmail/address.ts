// SERVER-ONLY. RFC 5322 address extraction and normalization.
//
// The whole authorization story rests on comparing the right string. A header of
// `"Nikhil" <attacker@evil.com>` must evaluate as attacker@evil.com, never as the
// display name, and `USER@Example.COM` must match a stored `user@example.com`.
// Getting either wrong turns §8's decision table into theatre.

/**
 * Pulls the addr-spec out of one address field.
 *
 * Handles `Display <a@b>`, bare `a@b`, quoted display names containing an @ or a
 * comma, and angle brackets with surrounding whitespace. Returns null rather than
 * guessing when the input is not a single usable address — callers treat null as
 * "unidentified sender", which fails closed.
 */
export function parseEmailAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;

  // A quoted display name may legally contain '<', '>', '@' and ','. Strip it
  // first so those characters cannot be mistaken for structure.
  value = value.replace(/"(?:[^"\\]|\\.)*"/g, "").trim();

  // Angle-bracketed form wins when present: the addr-spec is unambiguous there.
  const angled = value.match(/<([^<>]+)>/);
  if (angled) value = angled[1].trim();

  // Reject anything that still looks like a list — we are parsing ONE address.
  if (value.includes(",")) return null;

  // Strip a trailing/leading stray bracket or whitespace left by odd headers.
  value = value.replace(/^[<\s]+|[>\s]+$/g, "");
  if (!isPlausibleAddress(value)) return null;
  return value;
}

/**
 * Deliberately conservative: exactly one '@', a non-empty local-part with no
 * whitespace or control characters, and a domain with at least one dot and no
 * consecutive dots. This is not a full RFC validator — it is a gate that rejects
 * the shapes that cause trouble downstream (header injection, empty domains).
 */
function isPlausibleAddress(value: string): boolean {
  if (value.length < 3 || value.length > 320) return false;
  // Control characters would allow header smuggling if this string is ever echoed.
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

export interface NormalizeOptions {
  /**
   * Strip a `+tag` suffix from the local-part. Off by default: for most providers
   * `a+x@d` and `a@d` are the same mailbox, but that is a provider convention and
   * not universal, so treating them as equal is a per-tenant decision, not ours.
   */
  stripPlusTag?: boolean;
}

/**
 * Canonical form for comparison and storage.
 *
 * Domain is lowercased (DNS is case-insensitive). Local-part case is PRESERVED,
 * because RFC 5321 makes it case-sensitive and lowercasing it would let
 * `Admin@corp` match a different real mailbox `admin@corp` on a strict server.
 * Callers that know their user store is case-insensitive can lowercase on both
 * sides; this function refuses to make that assumption for them.
 */
export function normalizeEmailAddress(
  raw: string | null | undefined,
  options: NormalizeOptions = {},
): string | null {
  const parsed = parseEmailAddress(raw);
  if (!parsed) return null;

  const at = parsed.lastIndexOf("@");
  let local = parsed.slice(0, at);
  const domain = parsed.slice(at + 1).toLowerCase();

  if (options.stripPlusTag) {
    const plus = local.indexOf("+");
    if (plus > 0) local = local.slice(0, plus);
    if (!local) return null;
  }
  return `${local}@${domain}`;
}

/** Case-insensitive domain comparison, used by the SPF-only rule in §9. */
export function sameDomain(a: string | null, b: string | null): boolean {
  const da = domainOf(a);
  const db = domainOf(b);
  return da !== null && db !== null && da === db;
}

export function domainOf(address: string | null | undefined): string | null {
  const parsed = parseEmailAddress(address);
  if (!parsed) return null;
  return parsed.slice(parsed.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * Extracts the alias local-part from a recipient list.
 *
 * Only recipients on the configured inbound domain are considered, so a message
 * CC'd to the inbound address alongside unrelated recipients still resolves, and
 * an address on any other domain can never select a workspace.
 */
export function findInboundLocalPart(
  recipients: readonly string[],
  inboundDomain: string,
): string | null {
  const wanted = inboundDomain.trim().toLowerCase().replace(/^@/, "");
  if (!wanted) return null;

  for (const recipient of recipients) {
    const parsed = parseEmailAddress(recipient);
    if (!parsed) continue;
    const at = parsed.lastIndexOf("@");
    if (parsed.slice(at + 1).toLowerCase() !== wanted) continue;
    return parsed.slice(0, at);
  }
  return null;
}
