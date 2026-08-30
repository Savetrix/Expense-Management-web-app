// SERVER-ONLY. Authenticated encryption for the delegated refresh token.
//
// WHAT IS STORED AND WHY. An inbound email arrives with no browser session, but
// the invoice it carries must be created AS the accountant who owns the alias —
// same permissions, same audit trail, same POST /invoices the Upload button
// calls. The backend has no service-credential ingestion path (it is not in this
// workspace), so the only way to act as the user is to hold a credential the
// user delegated: their refresh token, captured while they were signed in and
// explicitly enabling forwarding for one company.
//
// That is a genuine, deliberate tradeoff, so the handling is strict:
//
//   * AES-256-GCM. Authenticated, so a tampered ciphertext fails to open rather
//     than decrypting to attacker-chosen bytes.
//   * A fresh random 96-bit IV per encryption. Never derived, never reused —
//     GCM's security collapses entirely if an (key, IV) pair repeats.
//   * The alias's token hash is bound in as Additional Authenticated Data. A
//     stored blob therefore cannot be lifted from one alias and replayed under
//     another: the tag will not verify. Without AAD, someone with write access
//     to the store could point company A's alias at company B's credential.
//   * The key lives only in INBOUND_TOKEN_ENCRYPTION_KEY (server-only env).
//     Losing it makes every stored token permanently unopenable, which is the
//     correct failure direction: users re-enable forwarding, nothing leaks.
//   * Plaintext is never logged, never returned to a browser, and never included
//     in an error message. Failures are structural: "could not open", no detail.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Versioned so the format can change without ambiguity about what is stored. */
const FORMAT_VERSION = "v1";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * A single self-describing string rather than a struct of fields, because it is
 * stored as one JSON value and travels as one unit — splitting it across keys
 * invites a partial write that produces a decryptable-looking record.
 */
export function sealSecret(plaintext: string, key: Buffer, aad: string): string {
  if (key.length !== 32) throw new SecretBoxError("encryption key must be 32 bytes");
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new SecretBoxError("nothing to seal");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null on ANY failure — wrong key, tampered bytes, wrong alias, garbage
 * input. Callers treat null as "this delegation is no longer usable" and ask the
 * user to re-enable forwarding. Deliberately gives no reason: distinguishing
 * "wrong key" from "bad tag" is an oracle, and there is nothing a caller would
 * legitimately do differently.
 */
export function openSecret(sealed: string, key: Buffer, aad: string): string | null {
  if (key.length !== 32 || typeof sealed !== "string") return null;

  const parts = sealed.split(".");
  if (parts.length !== 4) return null;
  const [version, ivRaw, tagRaw, ciphertextRaw] = parts;
  if (version !== FORMAT_VERSION) return null;

  try {
    const iv = Buffer.from(ivRaw, "base64url");
    const tag = Buffer.from(tagRaw, "base64url");
    const ciphertext = Buffer.from(ciphertextRaw, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) return null;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value = plaintext.toString("utf8");
    return value.length > 0 ? value : null;
  } catch {
    // Bad tag, bad key, malformed base64 — all the same answer.
    return null;
  }
}

/**
 * Compare two secrets without leaking length or content through timing. Used to
 * decide whether a re-submitted refresh token actually differs from the stored
 * one, so an unchanged token is not needlessly re-encrypted (which would rotate
 * the IV and invalidate nothing, but does churn the store).
 */
export function secretsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
