// SERVER-ONLY. The I/O half of the Resend adapter (the pure half is resend.ts).
//
// Three calls against api.resend.com, in the order the pipeline needs them:
//
//   GET /emails/receiving/{id}              -> headers, received_for, message_id
//   GET /emails/receiving/{id}/attachments  -> per-file download_url + expires_at
//   GET <download_url>                      -> the bytes themselves
//
// WHY WE RE-FETCH INSTEAD OF TRUSTING THE WEBHOOK. The webhook body carries only
// `email_id`, `from`, `to`, `cc`, `bcc`, `received_for`, `message_id`, `subject`
// and a thin attachment list (id, filename, content_type). No headers, no
// authentication results, and no download URLs. Everything the authorization
// decision needs therefore comes from these calls — which is also what makes
// Resend's 8-attempt redelivery usable as our retry mechanism: `download_url` is
// a signed URL with an `expires_at`, so a URL captured 10 hours ago would be
// dead, whereas re-listing on each attempt always yields a fresh one.
import { classifyHttpFailure } from "../idempotency";
import { InboundTransientError } from "../types";

const API_BASE = "https://api.resend.com";
const API_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;

/**
 * Hosts a download URL may point at. An allow-list is the primary control here
 * because, unlike the MCP connector's `assertFetchableUrl` (which must accept
 * arbitrary user-supplied links and can only deny-list), we know exactly who is
 * supposed to be serving these files. The deny-list below is kept as well:
 * defence in depth costs nothing, and it catches a provider that ever starts
 * handing out URLs pointing somewhere unexpected.
 */
const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = ["inbound-cdn.resend.com", "api.resend.com"];

function allowedDownloadHosts(): string[] {
  const configured = process.env.INBOUND_DOWNLOAD_HOST_ALLOWLIST?.trim();
  if (!configured) return DEFAULT_ALLOWED_DOWNLOAD_HOSTS;
  const hosts = configured
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_ALLOWED_DOWNLOAD_HOSTS;
}

/** IPv4-mapped IPv6 (`::ffff:169.254.169.254`) must not slip past the v4 rules. */
function toIpv4IfMapped(host: string): string {
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : host;
}

function isPrivateHost(host: string): boolean {
  const value = toIpv4IfMapped(host.toLowerCase().replace(/^\[|\]$/g, ""));
  return (
    value === "localhost" ||
    value === "::1" ||
    value.endsWith(".localhost") ||
    value.endsWith(".internal") ||
    /^127\./.test(value) ||
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value) ||
    /^169\.254\./.test(value) ||
    /^0\./.test(value) ||
    /^f[cd][0-9a-f]{2}:/.test(value)
  );
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Exported for tests: the allow-list decision is the SSRF boundary, so it is
 * worth asserting directly rather than only through a network call.
 */
export function checkDownloadUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }
  // https only. An http download URL would expose the signed token in transit.
  if (url.protocol !== "https:") return { ok: false, reason: "non-https" };

  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) return { ok: false, reason: "private-host" };

  const allowed = allowedDownloadHosts().some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  if (!allowed) return { ok: false, reason: "host-not-allowed" };

  return { ok: true, url };
}

// ==============================
// FETCHED EMAIL
// ==============================

export interface ResendAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  contentDisposition: string | null;
  contentId: string | null;
  sizeBytes: number;
  /** Signed and short-lived. Never persisted, never logged (§24). */
  downloadUrl: string | null;
  expiresAt: string | null;
}

export interface FetchedEmail {
  id: string;
  from: string | null;
  to: string[];
  cc: string[];
  receivedFor: string[];
  subject: string | null;
  messageId: string | null;
  createdAt: string | null;
  /** Object form, per Resend's schema. Duplicates are already collapsed. */
  headers: Record<string, string | string[]>;
  attachments: ResendAttachmentMeta[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  const single = asString(value);
  return single ? [single] : [];
}

function normalizeAttachmentMeta(entry: unknown): ResendAttachmentMeta | null {
  const item = asRecord(entry);
  if (!item) return null;
  const id = asString(item.id);
  if (!id) return null;
  return {
    id,
    filename: asString(item.filename) ?? "attachment",
    contentType: asString(item.content_type) ?? "application/octet-stream",
    contentDisposition: asString(item.content_disposition),
    contentId: asString(item.content_id),
    sizeBytes: typeof item.size === "number" && item.size >= 0 ? item.size : 0,
    downloadUrl: asString(item.download_url),
    expiresAt: asString(item.expires_at),
  };
}

async function apiGet(path: string, apiKey: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // Network error or timeout — always worth another delivery attempt.
    throw new InboundTransientError("resend-unreachable", error);
  }

  if (response.ok) return response.json().catch(() => null);

  // A 4xx here means the request itself is wrong (bad key, unknown email id)
  // and repeating it verbatim will fail identically, so it is NOT transient.
  // Anything else is. Never log the response body — it echoes request context.
  if (classifyHttpFailure(response.status) === "retryable") {
    throw new InboundTransientError(`resend-${response.status}`);
  }
  throw new Error(`resend-permanent-${response.status}`);
}

export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
): Promise<FetchedEmail | null> {
  const payload = await apiGet(`/emails/receiving/${encodeURIComponent(emailId)}`, apiKey);
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;

  const headers: Record<string, string | string[]> = {};
  const rawHeaders = asRecord(data.headers);
  if (rawHeaders) {
    for (const [name, value] of Object.entries(rawHeaders)) {
      if (typeof value === "string") headers[name] = value;
      else if (Array.isArray(value)) {
        headers[name] = value.filter((v): v is string => typeof v === "string");
      }
    }
  }

  return {
    id: asString(data.id) ?? emailId,
    from: asString(data.from),
    to: asStringArray(data.to),
    cc: asStringArray(data.cc),
    receivedFor: asStringArray(data.received_for),
    subject: asString(data.subject),
    messageId: asString(data.message_id),
    createdAt: asString(data.created_at),
    headers,
    attachments: Array.isArray(data.attachments)
      ? data.attachments
          .map(normalizeAttachmentMeta)
          .filter((a): a is ResendAttachmentMeta => a !== null)
      : [],
  };
}

/**
 * Attachment metadata WITH fresh download URLs. Paginated by the API; we follow
 * `has_more` up to the envelope cap so a message with many parts is not silently
 * truncated to the first page.
 */
export async function listAttachments(
  emailId: string,
  apiKey: string,
  maxEntries: number,
): Promise<ResendAttachmentMeta[]> {
  const out: ResendAttachmentMeta[] = [];
  let after: string | null = null;

  // +1 so the caller can still detect "more attachments than the cap allows"
  // and reject the envelope, rather than quietly processing a subset.
  const ceiling = maxEntries + 1;

  for (let page = 0; page < 10 && out.length < ceiling; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const payload = await apiGet(
      `/emails/receiving/${encodeURIComponent(emailId)}/attachments?${query.toString()}`,
      apiKey,
    );
    const root = asRecord(payload);
    if (!root) break;
    const entries = Array.isArray(root.data) ? root.data : [];
    const normalized = entries
      .map(normalizeAttachmentMeta)
      .filter((a): a is ResendAttachmentMeta => a !== null);
    out.push(...normalized);

    if (root.has_more !== true || normalized.length === 0) break;
    after = normalized[normalized.length - 1].id;
  }

  return out.slice(0, ceiling);
}

export type DownloadOutcome =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: string; transient: boolean };

/**
 * Download one attachment under strict controls.
 *
 * The byte cap is enforced WHILE STREAMING, not after: checking
 * `bytes.length > cap` once the whole body is buffered means a hostile 2 GB
 * response has already been read into memory, which is the denial-of-service
 * the cap exists to prevent. Redirects are refused outright rather than
 * followed, for the reason spelled out in the MCP connector's
 * `assertFetchableUrl`: only the first URL is ever checked, so a public host
 * answering `302 -> http://169.254.169.254/` would walk straight past the
 * allow-list.
 */
export async function downloadAttachment(
  downloadUrl: string,
  maxBytes: number,
): Promise<DownloadOutcome> {
  const check = checkDownloadUrl(downloadUrl);
  if (!check.ok) return { ok: false, reason: check.reason, transient: false };

  let response: Response;
  try {
    response = await fetch(check.url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "download-unreachable", transient: true };
  }

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, reason: "download-redirected", transient: false };
  }
  if (!response.ok) {
    // 403/404 here usually means the signed URL expired between listing and
    // download. Transient: the next delivery attempt re-lists and gets a fresh
    // URL, which is exactly the recovery path.
    const transient = classifyHttpFailure(response.status) === "retryable" || response.status === 403;
    return { ok: false, reason: `download-${response.status}`, transient };
  }

  // Trust the declared length only as an early reject; the real enforcement is
  // the running total below, because Content-Length can lie or be absent.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large-declared", transient: false };
  }

  const body = response.body;
  if (!body) return { ok: false, reason: "empty-body", transient: true };

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large-streamed", transient: false };
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { ok: false, reason: "download-interrupted", transient: true };
  }

  return { ok: true, bytes: Buffer.concat(chunks, total) };
}
