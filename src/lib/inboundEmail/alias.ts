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
export function mintAliasForCompany(
  companyName: string | null | undefined,
  options: { plain?: boolean } = {},
): MintedAlias {
  const slug = slugifyCompanyName(companyName);

  // FIRST CHOICE: the bare company slug, no random noise —
  // `acme-corp@invoice.scantrix.ai` rather than `acme-corp-7k2m9x@…`.
  //
  // The suffix was never decoration: company names are not unique across
  // customers, so two clients both called "Acme Corp" would collide on one
  // address. That is still true — which is why the caller retries with
  // `plain: false` on a collision rather than this function guessing. The
  // global namespace is enforced by a create-only write, so a collision is
  // detected against every address that exists, not just this account's.
  if (options.plain) {
    const localPart = slug.slice(0, MAX_LOCAL_PART_LENGTH).replace(/-+$/, "") || "company";
    return { localPart, tokenHash: hashAliasLocalPart(localPart), slug, suffix: "" };
  }

  const suffix = randomSuffix();
  let localPart = `${slug}-${suffix}`;

  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    const room = MAX_LOCAL_PART_LENGTH - suffix.length - 1;
    localPart = `${slug.slice(0, room).replace(/-$/, "")}-${suffix}`;
  }
  return { localPart, tokenHash: hashAliasLocalPart(localPart), slug, suffix };
}

/**
 * An alias record for a username the user chose themselves.
 *
 * Shape is validated by the caller via checkUsernameShape; uniqueness is
 * enforced where it belongs — the create-only write in the store.
 */
export function mintAliasForUsername(username: string): MintedAlias {
  const localPart = normalizeUsername(username);
  return { localPart, tokenHash: hashAliasLocalPart(localPart), slug: localPart, suffix: "" };
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

/**
 * The ONE rule that decides both what a user may claim and what we will resolve.
 *
 * Deliberately a single constant. If claiming were more permissive than
 * resolving, a user could take a username, be told it is theirs, and then have
 * every invoice sent to it silently rejected as `unknown_alias` — the worst
 * possible outcome, because nothing looks broken until invoices go missing.
 *
 * The product decision is that usernames are NOT format-restricted: no minimum
 * length, no reserved words, no house style. What remains is only what email
 * delivery physically requires, because an address that cannot be delivered to
 * is not a username, it is a dead end:
 *
 *   - lower-case letters, digits, dot, underscore, plus, hyphen
 *   - must start and end alphanumeric (a leading or trailing dot is rejected by
 *     real mail servers)
 *   - no consecutive dots (address parsing rejects them — see address.ts)
 *   - at most 64 characters, the RFC 5321 local-part limit
 *
 * Anything outside this cannot be delivered to by ANY mail server, so refusing
 * it up front is the honest behaviour rather than a restriction we invented.
 */
const LOCAL_PART_SHAPE = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/;

/**
 * Normalize and hash an incoming local-part, or null when it cannot be one of ours.
 *
 * A null here means `unknown_alias` — the same answer an unrecognised address gets,
 * so a probe cannot tell a malformed address from a real one it does not own.
 */
export function resolveAliasHash(localPart: string | null | undefined): string | null {
  if (typeof localPart !== "string") return null;
  const value = localPart.trim().toLowerCase();
  // NOTE: no lower length bound and NO hyphen requirement. Both used to exist —
  // the hyphen rule assumed every address carried a random suffix, which stopped
  // being true once users could choose their own username. It would have made
  // `mrkalpasi@…` unresolvable while the UI happily reported it as claimed.
  if (value.length === 0 || value.length > MAX_LOCAL_PART_LENGTH) return null;
  if (!LOCAL_PART_SHAPE.test(value)) return null;
  if (value.includes("..")) return null;
  return hashAliasLocalPart(value);
}

/** Constant-time: the left side is attacker-supplied. */
export function aliasHashMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Why a username cannot be used. Null means it is acceptable. */
export type UsernameProblem = "empty" | "too_long" | "invalid_characters";

export const MAX_USERNAME_LENGTH = MAX_LOCAL_PART_LENGTH;

/** Usernames are case-insensitive, like the handles they are modelled on. */
export function normalizeUsername(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Judge a username on deliverability alone.
 *
 * Uses the SAME regex `resolveAliasHash` uses, so "you may have this" and "mail
 * to this will arrive" can never disagree.
 */
export function checkUsernameShape(raw: string | null | undefined): UsernameProblem | null {
  const value = normalizeUsername(raw);
  if (value.length === 0) return "empty";
  if (value.length > MAX_USERNAME_LENGTH) return "too_long";
  if (!LOCAL_PART_SHAPE.test(value) || value.includes("..")) return "invalid_characters";
  return null;
}

export function formatAliasAddress(localPart: string, inboundDomain: string): string {
  const domain = inboundDomain.trim().toLowerCase().replace(/^@/, "");
  return `${localPart}@${domain}`;
}
