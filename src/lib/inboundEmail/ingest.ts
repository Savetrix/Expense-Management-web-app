// SERVER-ONLY. Turning validated bytes into an invoice, as the alias's owner.
//
// ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
// An inbound email has no browser session, but the invoice it carries must be
// created AS the accountant who owns the receiving address: same permissions,
// same company, same audit trail, same duplicate checks, same review rules. The
// architecture doc's preferred answer was a trusted server-to-server endpoint
// (`POST /internal/invoices/ingest` with a service credential) — but that lives
// in the Savetrix backend, which is not in this workspace, so nothing could ship
// while we waited for it.
//
// ── WHAT WE DO INSTEAD ───────────────────────────────────────────────────────
// Delegation. When the accountant enables forwarding for a company they are
// signed in, so the browser hands us its refresh token once; we seal it
// (secretBox.ts) against the alias and store it. Ingestion then mints a
// short-lived access token from it via the SAME `/auth/refresh-token` call
// src/lib/api.ts's interceptor already uses, and posts to the SAME
// `POST /invoices` the Upload button posts to, with the SAME `X-QB-Id`.
//
// So this is emphatically NOT a second ingestion pipeline. It is the existing
// one, called from a webhook instead of from a click. Nothing about OCR,
// extraction, vendor matching, duplicate detection, review, or QuickBooks
// posting is reimplemented or bypassed — the backend cannot tell the difference,
// which is exactly the property §22 asks for.
//
// ── THE SEAM ─────────────────────────────────────────────────────────────────
// `IngestAuthority` exists so the credential story can change without touching
// the pipeline. Swapping to a backend service credential later means writing a
// second implementation of this one interface; pipeline.ts never learns of it.
import { SAVETRIX_API_BASE_URL } from "./config";
import { classifyHttpFailure } from "./idempotency";
import { openSecret } from "./secretBox";

const REFRESH_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;

export type MintOutcome =
  | { ok: true; accessToken: string }
  /** The delegation is dead. A human must re-enable forwarding. */
  | { ok: false; reason: "credential_expired" }
  /** Upstream problem. Worth another delivery attempt. */
  | { ok: false; reason: "transient"; detail: string };

export type UploadOutcome =
  | { ok: true; invoiceId: string | null }
  | { ok: false; transient: boolean; detail: string };

export interface IngestFile {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * How the pipeline obtains authority to create an invoice for one alias.
 *
 * Deliberately narrow: given an alias's stored credential, produce an access
 * token; given a token, upload one file. Any future implementation (service
 * credential, signed assertion, backend-internal call) satisfies the same two
 * operations.
 */
export interface IngestAuthority {
  mintAccessToken(sealedRefreshToken: string, aliasTokenHash: string): Promise<MintOutcome>;
  uploadInvoice(
    file: IngestFile,
    accessToken: string,
    qbConnectionId: string,
  ): Promise<UploadOutcome>;
}

/** Probe the shapes the API is known to use, rather than assuming one. */
function pickString(payload: unknown, keys: readonly string[]): string | null {
  const record = payload as Record<string, unknown> | null;
  if (!record || typeof record !== "object") return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Dig an invoice id out of the upload response.
 *
 * The API wraps payloads as `{success, message, data}` and `data` may be the
 * invoice, `{invoice}`, or `{invoices: [...]}` — the same uncertainty
 * getInvoiceDetails already handles by probing. A null result is NOT a failure:
 * the upload succeeded, we simply could not name the invoice, and inventing an
 * id would be worse than recording none.
 */
export function extractInvoiceId(payload: unknown): string | null {
  const root = payload as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return null;

  const data = root.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data?.invoice,
    Array.isArray(data?.invoices) ? data?.invoices[0] : undefined,
    data,
    Array.isArray(root.invoices) ? root.invoices[0] : undefined,
    root.invoice,
    root,
  ];

  for (const candidate of candidates) {
    const id = pickString(candidate, ["_id", "id", "invoiceId"]);
    if (id) return id;
  }
  return null;
}

export class RefreshTokenAuthority implements IngestAuthority {
  constructor(private readonly encryptionKey: Buffer) {}

  /**
   * Open the sealed refresh token and trade it for an access token.
   *
   * A 401/403 from `/auth/refresh-token` is the signal that the delegation is
   * over — the owner signed out everywhere, rotated their password, or an admin
   * revoked the session. That is permanent until a human acts, so it must not be
   * retried for 32 hours; it becomes `credential_expired`, which the settings
   * screen renders as "reconnect email forwarding".
   */
  async mintAccessToken(sealedRefreshToken: string, aliasTokenHash: string): Promise<MintOutcome> {
    const refreshToken = openSecret(sealedRefreshToken, this.encryptionKey, aliasTokenHash);
    if (!refreshToken) {
      // Wrong key, tampered record, or a blob moved between aliases. Not
      // retryable, and never explained further — see secretBox.openSecret.
      return { ok: false, reason: "credential_expired" };
    }

    let response: Response;
    try {
      response = await fetch(`${SAVETRIX_API_BASE_URL}/auth/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, reason: "transient", detail: "refresh-unreachable" };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "credential_expired" };
    }
    if (!response.ok) {
      if (classifyHttpFailure(response.status) === "retryable") {
        return { ok: false, reason: "transient", detail: `refresh-${response.status}` };
      }
      // A 400 from the refresh endpoint means it did not like the token itself.
      return { ok: false, reason: "credential_expired" };
    }

    const payload = await response.json().catch(() => null);
    const record = payload as Record<string, unknown> | null;
    const accessToken =
      pickString(record, ["accessToken"]) ??
      pickString(record?.data as Record<string, unknown> | undefined, ["accessToken", "token"]);

    if (!accessToken) {
      // 2xx with no token is a contract violation, not a dead credential — do
      // not burn the delegation over it.
      return { ok: false, reason: "transient", detail: "refresh-no-token" };
    }
    return { ok: true, accessToken };
  }

  /**
   * Post one file to `POST /invoices`, byte-for-byte the request the browser
   * makes.
   *
   * ONE file per request, even though multer accepts up to 10: attachments are
   * independent (§20), so a single unreadable file must not take the others down
   * with it, and per-attachment records need per-attachment outcomes.
   *
   * Content-Type is deliberately NOT set — `fetch` derives it from the FormData
   * along with the multipart boundary, and setting it by hand omits the boundary
   * and breaks server-side parsing. This is the same trap invoiceApi.ts's
   * scanInvoice documents.
   */
  async uploadInvoice(
    file: IngestFile,
    accessToken: string,
    qbConnectionId: string,
  ): Promise<UploadOutcome> {
    const form = new FormData();
    // Field name "files" is what multer's upload.array("files", 10) collects.
    form.append(
      "files",
      new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
      file.filename,
    );

    let response: Response;
    try {
      response = await fetch(`${SAVETRIX_API_BASE_URL}/invoices`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-QB-Id": qbConnectionId,
          Accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, transient: true, detail: "upload-unreachable" };
    }

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      return { ok: true, invoiceId: extractInvoiceId(payload) };
    }

    // A 401 here means the freshly minted token was rejected — treat as
    // transient so the next attempt mints a new one, rather than concluding the
    // delegation is dead on what may be a clock-skew or replication blip.
    const transient = response.status === 401 || classifyHttpFailure(response.status) === "retryable";
    return { ok: false, transient, detail: `upload-${response.status}` };
  }
}
