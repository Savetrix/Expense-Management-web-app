// SERVER-ONLY. Opaque inbound aliases: mint, hash, verify, format.
//
// The alias decides WHICH WORKSPACE an invoice lands in (§7), so it has to be
// unguessable — otherwise anyone could aim invoices at someone else's books. It
// deliberately encodes nothing: no user id, workspace id, email, or company name.
// Only the SHA-256 hash is stored, so a database leak does not hand over working
// receiving addresses.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 20 bytes -> 32 base32 chars, ~100 bits. Long enough that guessing is hopeless,
 *  short enough that a human can paste the address without wrapping. */
const TOKEN_BYTES = 20;
const PREFIX = "inv-";

/** Crockford-style alphabet minus i/l/o/u: avoids characters people misread when
 *  copying an address out of a support ticket by hand. */
const ALPHABET = "abcdefghjkmnpqrstvwxyz0123456789";

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export interface MintedAlias {
  /** Show once, then never again — only the hash is persisted. */
  token: string;
  tokenHash: string;
  localPart: string;
}

export function mintAliasToken(): MintedAlias {
  const token = base32(randomBytes(TOKEN_BYTES));
  return { token, tokenHash: hashAliasToken(token), localPart: `${PREFIX}${token}` };
}

/**
 * Hash of the bare token. Lookup is by this value with a unique index, which keeps
 * resolution O(1) while leaving the raw token absent from the database — the
 * "prefer storing a hash when lookup requirements permit" case in the brief.
 */
export function hashAliasToken(token: string): string {
  return createHash("sha256").update(`savetrix-inbound-alias:${token}`).digest("hex");
}

/** Strips the `inv-` prefix. Returns null when the local-part is not one of ours. */
export function extractAliasToken(localPart: string | null | undefined): string | null {
  if (typeof localPart !== "string") return null;
  const value = localPart.trim().toLowerCase();
  if (!value.startsWith(PREFIX)) return null;
  const token = value.slice(PREFIX.length);
  // Length and alphabet are fixed, so anything else cannot be a token we minted.
  if (token.length !== 32) return null;
  for (const ch of token) if (!ALPHABET.includes(ch)) return null;
  return token;
}

/** Hash comparison in constant time — the comparison input is attacker-supplied. */
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

/**
 * Resolve an incoming local-part to a stored alias hash, without touching a
 * database. The caller does the lookup; this owns the parsing and the comparison
 * so both stay in one tested place.
 */
export function resolveAliasHash(localPart: string | null | undefined): string | null {
  const token = extractAliasToken(localPart);
  if (!token) return null;
  return hashAliasToken(token);
}
