// SERVER-ONLY. Attachment validation. Every byte here is hostile input (§20).
//
// A `.pdf` extension is not evidence of anything, and neither is the MIME type the
// provider reports — both come from the sender. The only trustworthy signal is the
// leading bytes of the file itself, so the declared type is cross-checked against
// them and a mismatch is a rejection rather than a warning.
import { createHash } from "node:crypto";

import type { NormalizedAttachment, RejectionCode, ValidationOutcome } from "./types";

/** Matches manual upload's `accept="image/*,.pdf"` (DashboardContent.tsx:127). */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/heic",
  "image/heif",
] as const;

export interface AttachmentLimits {
  maxAttachments: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/**
 * Tighter than manual upload on purpose: a signed-in user pressing Upload has
 * already authenticated, whereas inbound mail is unauthenticated until §8 says
 * otherwise, and the sender chooses the payload.
 */
export const DEFAULT_LIMITS: AttachmentLimits = {
  maxAttachments: 10,
  maxFileBytes: 15 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
};

/** Leading-byte signatures. Order matters only in that the first hit wins. */
const MAGIC: ReadonlyArray<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/gif",
    test: (b) => {
      const s = b.subarray(0, 6).toString("latin1");
      return s === "GIF87a" || s === "GIF89a";
    },
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    mime: "image/tiff",
    test: (b) => {
      const s = b.subarray(0, 4);
      return (
        s.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || s.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
      );
    },
  },
  {
    // ISO-BMFF: `....ftyp<brand>`; heic/heif/mif1/msf1 brands.
    mime: "image/heic",
    test: (b) => {
      if (b.subarray(4, 8).toString("latin1") !== "ftyp") return false;
      const brand = b.subarray(8, 12).toString("latin1");
      return ["heic", "heix", "heif", "mif1", "msf1", "hevc"].includes(brand);
    },
  },
];

/** Formats we refuse outright, even if something else about them looks fine. */
const FORBIDDEN_MAGIC: ReadonlyArray<{ label: string; test: (b: Buffer) => boolean }> = [
  { label: "zip/office-macro/archive", test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { label: "legacy-office", test: (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
  { label: "elf", test: (b) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) },
  { label: "windows-pe", test: (b) => b[0] === 0x4d && b[1] === 0x5a },
  { label: "mach-o", test: (b) => [0xfeedface, 0xfeedfacf, 0xcafebabe].includes(b.readUInt32BE(0)) },
  { label: "rar", test: (b) => b.subarray(0, 4).toString("latin1") === "Rar!" },
  { label: "gzip", test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { label: "7z", test: (b) => b.subarray(0, 2).toString("latin1") === "7z" },
  { label: "shebang-script", test: (b) => b.subarray(0, 2).toString("latin1") === "#!" },
];

export function detectMimeType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  for (const entry of MAGIC) {
    try {
      if (entry.test(bytes)) return entry.mime;
    } catch {
      // A malformed buffer failing a probe is simply "not this type".
    }
  }
  return null;
}

export function detectForbiddenFormat(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  for (const entry of FORBIDDEN_MAGIC) {
    try {
      if (entry.test(bytes)) return entry.label;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Filename fit for storage and display.
 *
 * Drops any directory component (`../../etc/passwd` becomes `passwd`), control
 * characters, and Unicode bidi overrides — the last of these is what makes
 * `invoice[U+202E]fdp.exe` render as `invoice.pdf` to a human.
 */
export function sanitizeFilename(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.trim()) return "attachment";

  let name = raw.replace(/\\/g, "/");
  name = name.slice(name.lastIndexOf("/") + 1);
  // Control chars, and the bidi overrides used for extension spoofing.
  name = name.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "");
  name = name.replace(/[/:*?"<>|]/g, "_");
  name = name.replace(/^\.+/, "").trim();
  if (!name) return "attachment";

  if (name.length > 180) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Does this look like a signature logo or tracking pixel rather than an invoice?
 *
 * Judged on disposition, content-id, size and dimensions — never on the filename,
 * which the sender controls. PDFs are exempt: a small PDF is still an invoice, and
 * wrongly skipping one is worse than processing a stray graphic.
 */
/** A signature logo or tracking pixel is small. A receipt photo is not. */
const DEFINITELY_DECORATIVE_BYTES = 25 * 1024;
/** Inline images below this are treated as decorative; above it, as content. */
const INLINE_DECORATIVE_CEILING = 150 * 1024;

export function isLikelyInlineAsset(
  attachment: NormalizedAttachment,
  dimensions?: { width: number; height: number } | null,
): boolean {
  if (attachment.reportedMimeType === "application/pdf") return false;

  // SIZE IS THE SIGNAL, NOT DISPOSITION.
  //
  // This previously discarded anything marked `inline` with a content-id, on
  // the theory that only signature logos are referenced from the body. That is
  // no longer how mail clients behave: dragging a photo into a Gmail message
  // produces exactly that shape, and it is one of the most natural ways to
  // send a receipt — especially from a phone. A real 1.6 MB receipt photo was
  // silently rejected as "only inline assets" because of it.
  //
  // Failure directions are asymmetric, so the rule is deliberately biased:
  // wrongly DROPPING an invoice loses a document silently, while wrongly
  // ACCEPTING a logo costs one click at review. Size separates the two cases
  // far better than disposition does.
  const size = attachment.sizeBytes;

  if (size > 0 && size < DEFINITELY_DECORATIVE_BYTES) return true;

  // Being inline-and-referenced still counts for something — it just needs the
  // image to be plausibly decorative in size too, rather than on its own.
  const inlineReferenced = attachment.disposition === "inline" && Boolean(attachment.contentId);
  if (inlineReferenced && size > 0 && size < INLINE_DECORATIVE_CEILING) return true;

  if (dimensions) {
    if (dimensions.width <= 1 || dimensions.height <= 1) return true;
    if (dimensions.width < 200 || dimensions.height < 200) return true;
  }
  return false;
}

export interface ValidatedAttachment {
  sanitizedFilename: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Full per-file gate. Ordered so the cheapest checks run first and so a rejection
 * reports the most specific reason available (a forbidden archive reads as
 * `unsupported_file_type`, not `content_type_mismatch`).
 */
export function validateAttachment(
  attachment: NormalizedAttachment,
  bytes: Buffer,
  limits: AttachmentLimits = DEFAULT_LIMITS,
): ValidationOutcome<ValidatedAttachment> {
  if (bytes.length === 0) return fail("unsupported_file_type", "empty file");
  if (bytes.length > limits.maxFileBytes) return fail("file_too_large");

  // A provider that under-reports size must not be able to smuggle a large file
  // past the cap, so the real byte length is authoritative above.
  const forbidden = detectForbiddenFormat(bytes);
  if (forbidden) return fail("unsupported_file_type", forbidden);

  const detected = detectMimeType(bytes);
  if (!detected) return fail("unsupported_file_type", "unrecognized signature");
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(detected)) {
    return fail("unsupported_file_type", detected);
  }

  const reported = normalizeMime(attachment.reportedMimeType);
  if (reported && !mimeAgrees(reported, detected)) {
    return fail("content_type_mismatch", `${reported} vs ${detected}`);
  }

  return {
    ok: true,
    value: {
      sanitizedFilename: sanitizeFilename(attachment.filename),
      detectedMimeType: detected,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    },
  };
}

function normalizeMime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base || null;
}

/** heic/heif share a container, and jpg aliases are common in the wild. */
function mimeAgrees(reported: string, detected: string): boolean {
  if (reported === detected) return true;
  const equivalent: Record<string, readonly string[]> = {
    "image/heic": ["image/heif"],
    "image/heif": ["image/heic"],
    "image/jpg": ["image/jpeg"],
    "image/jpeg": ["image/jpg"],
    "image/tif": ["image/tiff"],
    "image/tiff": ["image/tif"],
  };
  return (equivalent[reported] ?? []).includes(detected);
}

function fail(code: RejectionCode, detail?: string): ValidationOutcome<never> {
  return { ok: false, code, detail };
}

/**
 * Envelope-level gate applied before anything is downloaded, so an email designed
 * to exhaust bandwidth is refused on metadata alone.
 */
export function checkEnvelopeLimits(
  attachments: readonly NormalizedAttachment[],
  limits: AttachmentLimits = DEFAULT_LIMITS,
): ValidationOutcome<null> {
  if (attachments.length === 0) return fail("no_supported_attachments");
  if (attachments.length > limits.maxAttachments) return fail("too_many_attachments");
  const total = attachments.reduce((sum, a) => sum + Math.max(0, a.sizeBytes), 0);
  if (total > limits.maxTotalBytes) return fail("file_too_large", "total size");
  return { ok: true, value: null };
}

/** Candidates worth downloading: right declared family, not an inline asset. */
export function selectCandidateAttachments(
  attachments: readonly NormalizedAttachment[],
): NormalizedAttachment[] {
  return attachments.filter((a) => {
    const mime = normalizeMime(a.reportedMimeType);
    const plausible =
      mime !== null &&
      (mime === "application/pdf" ||
        mime.startsWith("image/") ||
        mime === "application/octet-stream");
    if (!plausible) return false;
    return !isLikelyInlineAsset(a);
  });
}
