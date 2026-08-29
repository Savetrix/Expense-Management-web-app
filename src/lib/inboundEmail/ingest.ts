// SERVER-ONLY. Turning validated bytes into an invoice.
//
// ── WHO CREATES THE INVOICE ──────────────────────────────────────────────────
// An inbound email has no browser session, so something has to hold authority to
// call the same `POST /invoices` the Upload button calls.
//
// The first implementation stored the accountant's own refresh token and acted
// as them. Measurement killed it: this backend permits exactly ONE live session
// per account, so that stored credential and the person's own browser fought
// over a single slot — signing in anywhere broke forwarding, and forwarding
// risked signing them out.
//
// It is now a dedicated service account (serviceAccount.ts), invited as a
// Contributor to each forwarding-enabled company. No user credential is stored
// anywhere.
//
// Either way this is NOT a second ingestion pipeline. It is the existing one,
// called from a webhook instead of from a click: same endpoint, same `X-QB-Id`,
// same OCR, extraction, vendor matching, duplicate detection, review and
// posting rules. The backend cannot tell the two channels apart, which is
// exactly the property §22 asks for.
//
// ── THE SEAM ─────────────────────────────────────────────────────────────────
// `IngestAuthority` exists so the credential story can change without touching
// the pipeline — and it has now earned that twice over. Swapping to a backend
// service credential later means writing one more implementation of these two
// methods; pipeline.ts never learns of it.
import { SAVETRIX_API_BASE_URL } from "./config";
import { classifyHttpFailure } from "./idempotency";
import { getServiceAccessToken, type ServiceCredentials } from "./serviceAccount";

const UPLOAD_TIMEOUT_MS = 60_000;

export type AcquireOutcome =
  | { ok: true; accessToken: string }
  /**
   * Nobody can act for this company until a human fixes something — a wrong
   * service password, a disabled account, a lost membership. Permanent, so it
   * must not be retried for 32 hours.
   */
  | { ok: false; reason: "unauthorized"; detail: string }
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
 * How the pipeline obtains authority to create an invoice in one company.
 *
 * Deliberately narrow, and deliberately says nothing about HOW the token is
 * obtained: any future mechanism (service credential, signed assertion, a
 * backend-internal call) satisfies the same two operations.
 */
export interface IngestAuthority {
  /** A token able to upload into this company. */
  acquire(qbConnectionId: string): Promise<AcquireOutcome>;
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

export class ServiceAccountAuthority implements IngestAuthority {
  constructor(private readonly credentials: ServiceCredentials) {}

  /**
   * A service access token, cached for days at a time.
   *
   * Membership in the company is established when the user turns forwarding on
   * (serviceAccount.ensureServiceMembership), not here — inviting needs the
   * OWNER's token, and the owner is only present at that moment. If membership
   * were later removed, the upload below returns 403 and reports itself; there
   * is no point paying for a membership probe on every message to discover
   * something the upload tells us anyway.
   */
  async acquire(_qbConnectionId: string): Promise<AcquireOutcome> {
    const outcome = await getServiceAccessToken(this.credentials);
    if (outcome.ok) return { ok: true, accessToken: outcome.accessToken };
    return outcome.reason === "unauthorized"
      ? { ok: false, reason: "unauthorized", detail: outcome.detail }
      : { ok: false, reason: "transient", detail: outcome.detail };
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
    const send = async (token: string): Promise<Response | null> => {
      const form = new FormData();
      // Field name "files" is what multer's upload.array("files", 10) collects.
      form.append(
        "files",
        new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
        file.filename,
      );
      try {
        return await fetch(`${SAVETRIX_API_BASE_URL}/invoices`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-QB-Id": qbConnectionId,
            Accept: "application/json",
          },
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        return null;
      }
    };

    let response = await send(accessToken);
    if (!response) return { ok: false, transient: true, detail: "upload-unreachable" };

    // A 401 means the cached token was refused. Sign in once more and retry —
    // this is the whole self-healing story, and it is safe because a refused
    // request never reached the invoice pipeline, so nothing can be duplicated.
    if (response.status === 401) {
      const refreshed = await getServiceAccessToken(this.credentials, { forceRefresh: true });
      if (!refreshed.ok) {
        return {
          ok: false,
          transient: refreshed.reason === "transient",
          detail: `reauth-${refreshed.detail}`,
        };
      }
      response = await send(refreshed.accessToken);
      if (!response) return { ok: false, transient: true, detail: "upload-unreachable" };
    }

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      return { ok: true, invoiceId: extractInvoiceId(payload) };
    }

    // 403 here almost always means the service account is not a member of this
    // company — surfaced rather than retried, because no amount of waiting adds
    // a membership.
    const transient = classifyHttpFailure(response.status) === "retryable";
    return { ok: false, transient, detail: `upload-${response.status}` };
  }
}
