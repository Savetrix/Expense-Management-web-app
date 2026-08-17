// SERVER-ONLY. Inbound aliases: readable prefix + random suffix.
//
//   acme-corp-7k2m9x@invoice.scantrix.ai
//   devyani-international-9p3xkt@invoice.scantrix.ai
//
// The prefix comes from the QuickBooks company name so an accountant managing
// several clients can tell five saved contacts apart. The suffix is what makes the
// address unique and non-enumerable.
//
// Why not the company name alone: QuickBooks company names are not unique across
// Scantrix customers, so two accounts both managing an "Acme Corp" would collide on
// one address. The suffix removes that entirely, and also survives a company being
// renamed — the address is minted once and never re-derived, so a rename cannot
// invalidate a contact the user has already saved.
//
// What the alias is and is not: it selects WHICH WORKSPACE an invoice lands in. It
// is an identifier, not a credential — it is displayed in the UI, pasted into mail
// clients, and therefore stored in plaintext so it can be shown again. Authority to
// create an invoice comes from the sender check in authorization.ts, never from
// knowing an address. The random suffix raises the cost of discovering valid
// addresses; it is not a secret.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Suffix length. 6 chars over a 32-char alphabet is ~30 bits — about a billion
 *  possibilities, so addresses cannot be walked, while staying short enough to read
 *  aloud. Drop to 4 if the shorter form matters more than enumeration resistance. */
const SUFFIX_LENGTH = 6;

/** Keeps the whole local-part comfortably inside the 64-char RFC limit. */
const MAX_SLUG_LENGTH = 40;
const MAX_LOCAL_PART_LENGTH = 64;

/** No i/l/o/u: avoids the characters people misread when copying by hand. */
const ALPHABET = "abcdefghjkmnpqrstvwxyz0123456789";

/**
 * QuickBooks company name -> address-safe prefix.
 *
 * "Devyani International Limited"  -> devyani-international-limited
 * "O'Brien & Sons, LLC."           -> obrien-sons-llc
 * "1001679542 ONTARIO INC."        -> 1001679542-ontario-inc
 * "Café München GmbH"              -> cafe-munchen-gmbh
 */
export function slugifyCompanyName(name: string | null | undefined): string {
  if (typeof name !== "string" || !name.trim()) return "company";

  // Decompose accents so "é" becomes "e" rather than being dropped entirely —
  // losing the letter would mangle names like "Café" into "caf".
  const decomposed = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");

  let slug = decomposed
    .toLowerCase()
    // Apostrophes join words ("O'Brien" -> obrien); everything else separates.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) return "company";

  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH);
    // Prefer cutting at a word boundary, but only if a reasonable prefix survives.
    const lastDash = slug.lastIndexOf("-");
    if (lastDash >= 8) slug = slug.slice(0, lastDash);
    slug = slug.replace(/-$/, "");
  }
  return slug || "company";
}

function randomSuffix(length: number = SUFFIX_LENGTH): string {
  // Rejection-free because 32 divides 256 evenly, so no modulo bias.
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return out;
}

export interface MintedAlias {
  /** Local-part, e.g. "acme-corp-7k2m9x". */
  localPart: string;
  /** Indexed lookup key. Unique constraint lives on this column. */
  tokenHash: string;
  slug: string;
  suffix: string;
}

/**
 * Mint an alias for one workspace.
 *
 * `attempt` exists for the (very unlikely) unique-index collision: the caller
 * retries with attempt+1 to get a fresh suffix rather than failing the request.
 */
export function mintAliasForCompany(companyName: string | null | undefined): MintedAlias {
  const slug = slugifyCompanyName(companyName);
  const suffix = randomSuffix();
  let localPart = `${slug}-${suffix}`;

  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    const room = MAX_LOCAL_PART_LENGTH - suffix.length - 1;
    localPart = `${slug.slice(0, room).replace(/-$/, "")}-${suffix}`;
  }
  return { localPart, tokenHash: hashAliasLocalPart(localPart), slug, suffix };
}

/**
 * Lookup key for a local-part.
 *
 * Hashed rather than compared directly so the index cannot be walked by prefix and
 * a stray log line carrying a hash reveals nothing usable. Lowercased first because
 * mail clients rewrite case freely and `Acme-Corp-7K2M9X` must resolve.
 */
export function hashAliasLocalPart(localPart: string): string {
  return createHash("sha256")
    .update(`savetrix-inbound-alias:${localPart.trim().toLowerCase()}`)
    .digest("hex");
}

/** Shape a local-part must have before it is worth a database round trip. */
const LOCAL_PART_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalize and hash an incoming local-part, or null when it cannot be one of ours.
 *
 * A null here means `unknown_alias` — the same answer an unrecognised address gets,
 * so a probe cannot tell a malformed address from a real one it does not own.
 */
export function resolveAliasHash(localPart: string | null | undefined): string | null {
  if (typeof localPart !== "string") return null;
  const value = localPart.trim().toLowerCase();
  if (value.length < 3 || value.length > MAX_LOCAL_PART_LENGTH) return null;
  if (!LOCAL_PART_SHAPE.test(value)) return null;
  // Must carry a suffix; a bare company slug was never issued as an address.
  if (!value.includes("-")) return null;
  return hashAliasLocalPart(value);
}

/** Constant-time: the left side is attacker-supplied. */
export function aliasHashMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function formatAliasAddress(localPart: string, inboundDomain: string): string {
  const domain = inboundDomain.trim().toLowerCase().replace(/^@/, "");
  return `${localPart}@${domain}`;
}
