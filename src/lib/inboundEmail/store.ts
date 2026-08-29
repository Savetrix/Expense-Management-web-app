// SERVER-ONLY. Durable state for inbound-email ingestion, on Vercel Blob.
//
// The original design said this had to live in the Savetrix backend because this
// repo "has no datastore". That is not true any more: src/lib/chatHistory/store.ts
// already runs a private, precondition-guarded document store on Vercel Blob, and
// the discipline it established (private access, useCache:false, ETag
// preconditions, fresh-read-and-merge, a narrow IO seam for tests) is exactly
// what this feature needs. The volumes are tiny — an accountant forwards a
// handful of invoices a day, and nothing here stores attachment bytes.
//
// LAYOUT
//   inbound-email/v1/aliases/<tokenHash>.json
//       One document per receiving address. The pathname IS the lookup key, so
//       the webhook resolves an address in a single read with no scan. The
//       tokenHash is a SHA-256 of the normalized local-part (alias.ts), so the
//       store listing cannot be walked by company-name prefix.
//   inbound-email/v1/users/<sha256(userId)>.json
//       Everything the settings screen needs in one read: which aliases this
//       user owns, plus a capped recent-activity log for diagnostics.
//   inbound-email/v1/messages/<sha256(providerEventId)>.json
//       One document per delivered webhook event. Doubles as the idempotency
//       record and the per-message audit trail.
//
// IDEMPOTENCY, AND WHY IT IS NOT JUST "DOES THE RECORD EXIST"
//   Resend redelivers a failed webhook 8 times over ~32 hours. A create-only
//   write (allowOverwrite:false) is an atomic "I am the first to claim this
//   event" — but treating any existing record as "already done" would break
//   retries: the first attempt may have created the record and then died
//   half-way. So the record carries a status, and only a TERMINAL status means
//   "no more work". A non-terminal record means we are resuming.
import { createHash } from "node:crypto";

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  get,
  // Aliased: this module's IO seam has its own `list` method.
  list as blobList,
  put,
} from "@vercel/blob";

import type { InboundAuthResultsDiagnostics } from "./types";
import type { InboundAttachmentStatus, InboundMessageStatus, RejectionCode } from "./types";

const ALIAS_PREFIX = "inbound-email/v1/aliases/";
const USER_PREFIX = "inbound-email/v1/users/";
const MESSAGE_PREFIX = "inbound-email/v1/messages/";
const DOCUMENT_VERSION = 1 as const;

/** Conditional write attempts before giving up on a contended document. */
const WRITE_ATTEMPTS = 3;
const WRITE_RETRY_DELAY_MS = 120;
/** Recent-activity entries kept per user for the diagnostics panel. */
export const MAX_ACTIVITY_ENTRIES = 25;
/** Aliases one user may hold. Generous: an accountant may manage many clients. */
export const MAX_ALIASES_PER_USER = 50;
/**
 * Email-sourced invoice ids remembered per user. Bounded because the list is
 * only used to badge rows the user can actually still see; the invoice list
 * itself is paginated and old invoices scroll out of reach long before this.
 */
export const MAX_EMAIL_INVOICE_IDS = 500;

// ==============================
// ERRORS
// ==============================

/** Store unreachable or misconfigured. Callers map this to a RETRYABLE 503. */
export class InboundStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "InboundStoreError";
  }
}

/** A precondition was not met — another writer got there first. */
export class InboundWriteConflictError extends Error {
  constructor(readonly cause?: unknown) {
    super("inbound-write-conflict");
    this.name = "InboundWriteConflictError";
  }
}

// ==============================
// DOCUMENT SHAPES
// ==============================

export interface AliasRecord {
  version: typeof DOCUMENT_VERSION;
  /** SHA-256 of the normalized local-part. Matches the pathname. */
  tokenHash: string;
  localPart: string;
  /** Plaintext, because the settings screen must display it (§7). */
  receivingAddress: string;
  /** Owner. Every ingested invoice is created as this user. */
  userId: string;
  /**
   * The owner's account email, read SERVER-SIDE from their profile when the
   * alias was created — never accepted from the browser, because a client that
   * could name its own authorized sender could authorize anyone.
   *
   * This is the sender allow-list. There is no "find a user by email" endpoint
   * on the Savetrix API, so the set of people who may forward into this company
   * is captured at enable time rather than looked up per message.
   */
  ownerEmail: string;
  /**
   * Did `ownerEmail` come from the backend, or from the browser?
   *
   * This backend exposes no /users/me and its tokens carry no email claim, so in
   * practice it is usually the browser — accepted deliberately (see
   * identity.ts's ABOUT THE EMAIL note). Recorded rather than assumed so the
   * distinction stays visible in audit, and so a later backend that CAN answer
   * lets us tell the two populations apart.
   */
  ownerEmailVerified?: boolean;
  /**
   * Extra addresses allowed to forward here — a colleague, or the owner's second
   * mailbox. Opt-in per alias and settable only by the owner.
   */
  additionalSenders: string[];
  /** The QuickBooks connection this address posts into — becomes X-QB-Id. */
  qbConnectionId: string;
  /** Denormalized for display; a later rename in QuickBooks does not break the address. */
  companyName: string;
  companySlug: string;
  active: boolean;
  /** Increments on every regenerate, for audit. */
  rotationVersion: number;
  /**
   * The owner's refresh token, sealed with AES-256-GCM and bound to this
   * alias's tokenHash as AAD (secretBox.ts). Null once revoked.
   */
  sealedRefreshToken: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface ActivityEntry {
  correlationId: string;
  receivedAt: string;
  /** Truncated. Never a body. */
  subject: string | null;
  senderEmail: string | null;
  status: InboundMessageStatus;
  rejectionCode: RejectionCode | null;
  /** Safe structural detail, e.g. "3 of 4 accepted". */
  detail: string | null;
  invoiceCount: number;
  companyName: string | null;
  /** What the auth headers actually looked like — the whole point of the panel. */
  authDiagnostics: InboundAuthResultsDiagnostics | null;
}

export interface UserRecord {
  version: typeof DOCUMENT_VERSION;
  /** Token hashes of aliases this user owns, newest first. */
  aliasHashes: string[];
  recentActivity: ActivityEntry[];
  /**
   * Invoice ids this user received by email, newest first and capped.
   *
   * Why we keep this at all: emailed invoices go through the SAME
   * `POST /invoices` a manual upload uses, so the backend has no `source`
   * column and genuinely cannot tell the two apart. We can, because we created
   * them — so the "Email" badge on the invoice list is driven from here rather
   * than from a backend field that does not exist.
   */
  emailInvoiceIds: string[];
}

export interface MessageAttachmentRecord {
  sha256: string | null;
  providerAttachmentId: string;
  sanitizedFilename: string;
  status: InboundAttachmentStatus;
  rejectionCode: RejectionCode | null;
  detail: string | null;
  invoiceId: string | null;
}

export interface MessageRecord {
  version: typeof DOCUMENT_VERSION;
  provider: string;
  providerEventId: string;
  providerEmailId: string;
  rfcMessageId: string | null;
  correlationId: string;
  aliasHash: string | null;
  userId: string | null;
  qbConnectionId: string | null;
  senderEmail: string | null;
  /** Truncated at 200 chars. Bodies are never stored (§25). */
  subjectRedacted: string | null;
  receivedAt: string;
  status: InboundMessageStatus;
  rejectionCode: RejectionCode | null;
  detail: string | null;
  attempts: number;
  attachments: MessageAttachmentRecord[];
  authDiagnostics: InboundAuthResultsDiagnostics | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Statuses that mean "this event is finished; a redelivery is a duplicate". */
const TERMINAL_STATUSES: ReadonlySet<InboundMessageStatus> = new Set<InboundMessageStatus>([
  "completed",
  "partially_completed",
  "rejected",
  "dead_lettered",
]);

export const isTerminalStatus = (status: InboundMessageStatus): boolean =>
  TERMINAL_STATUSES.has(status);

// ==============================
// THE STORAGE SEAM
// ==============================

export type WritePrecondition =
  | { kind: "match"; etag: string }
  | { kind: "create" }
  | { kind: "none" };

/**
 * The whole of this module's dependency on blob storage. Narrow on purpose, for
 * the same two reasons as the chat-history store: Vercel specifics stay in one
 * adapter, and the tests run against an in-memory implementation with no store
 * credentials.
 */
export interface InboundBlobIo {
  read(pathname: string): Promise<{ text: string; etag: string } | null>;
  /** Throws InboundWriteConflictError when `precondition` is not met. */
  write(pathname: string, text: string, precondition: WritePrecondition): Promise<void>;
  remove(pathname: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

function assertConfigured(): void {
  // Mirrors the SDK's credential resolution exactly as chatHistory/store.ts
  // documents it: OIDC needs BOTH a token and a store id, otherwise the
  // read/write token is required.
  const hasOidc = Boolean(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID);
  if (!process.env.BLOB_READ_WRITE_TOKEN && !hasOidc) {
    throw new InboundStoreError("blob-store-not-configured");
  }
}

const vercelBlobIo: InboundBlobIo = {
  async read(pathname) {
    assertConfigured();
    try {
      // useCache:false is required, not an optimisation — we overwrite the same
      // pathnames, and a cached private read can serve a stale document along
      // with a stale etag, which would corrupt the merge below.
      const result = await get(pathname, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return { text: await new Response(result.stream).text(), etag: result.blob.etag };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      if (error instanceof InboundStoreError) throw error;
      throw new InboundStoreError("blob-read-failed", error);
    }
  },

  async write(pathname, text, precondition) {
    assertConfigured();
    try {
      await put(pathname, text, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // allowOverwrite:false IS the create-only precondition; the SDK rejects
        // combining it with ifMatch.
        allowOverwrite: precondition.kind !== "create",
        ...(precondition.kind === "match" ? { ifMatch: precondition.etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new InboundWriteConflictError(error);
      // A rejected allowOverwrite:false does not surface as
      // BlobPreconditionFailedError (see chatHistory/store.ts for the SDK
      // details), so classify by observation instead of by error message.
      if (precondition.kind === "create") {
        const exists = await vercelBlobIo.read(pathname).catch(() => null);
        if (exists) throw new InboundWriteConflictError(error);
      }
      throw new InboundStoreError("blob-write-failed", error);
    }
  },

  async remove(pathname) {
    assertConfigured();
    try {
      await del(pathname);
    } catch (error) {
      if (error instanceof BlobNotFoundError) return;
      if (error instanceof InboundStoreError) throw error;
      throw new InboundStoreError("blob-delete-failed", error);
    }
  },

  async list(prefix) {
    assertConfigured();
    try {
      // Paginated: the default page is 1000 entries, and pruning must not
      // silently stop at the first page and report "nothing older to delete".
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await blobList({ prefix, mode: "expanded", cursor });
        for (const blob of result.blobs) out.push(blob.pathname);
        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);
      return out;
    } catch (error) {
      throw new InboundStoreError("blob-list-failed", error);
    }
  },
};

let blobIoOverride: InboundBlobIo | null = null;
const blobIo = (): InboundBlobIo => blobIoOverride ?? vercelBlobIo;

/** Test seam. Pass null to restore the real Vercel Blob adapter. */
export function __setInboundBlobIoForTests(io: InboundBlobIo | null): void {
  blobIoOverride = io;
}

// ==============================
// PATHS
// ==============================

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const aliasPath = (tokenHash: string): string => `${ALIAS_PREFIX}${tokenHash}.json`;
/** Hashed so user ids (and email-shaped ids) stay out of blob pathnames. */
const userPath = (userId: string): string => `${USER_PREFIX}${sha256Hex(userId)}.json`;
const messagePath = (providerEventId: string): string =>
  `${MESSAGE_PREFIX}${sha256Hex(providerEventId)}.json`;

const nowIso = (): string => new Date().toISOString();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Fresh-read, apply a delta, conditional-write, retry on conflict.
 *
 * Identical in spirit to chatHistory's mutateDocument and for the same reason:
 * every write is rebuilt from a document read moments earlier, so a concurrent
 * writer's changes survive rather than being clobbered by a stale snapshot.
 * `mutate` returns null to abort the write (nothing to change).
 */
async function mutate<T>(
  pathname: string,
  empty: () => T,
  mutator: (current: T) => T | null,
): Promise<T | null> {
  let lastConflict: unknown = null;

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const existing = await blobIo().read(pathname);
    const current = existing ? (parseJson<T>(existing.text) ?? empty()) : empty();
    const next = mutator(current);
    if (next === null) return null;

    const precondition: WritePrecondition = existing
      ? // A weak validator (W/"…") can never satisfy If-Match's strong
        // comparison, so it is not a usable precondition. These documents are
        // small and single-writer in practice, so an unconditional write is
        // acceptable here — unlike chat history, we are not rewriting a large
        // growing document where a lost update destroys user content.
        existing.etag.startsWith("W/")
        ? { kind: "none" }
        : { kind: "match", etag: existing.etag }
      : { kind: "create" };

    try {
      await blobIo().write(pathname, JSON.stringify(next), precondition);
      return next;
    } catch (error) {
      if (!(error instanceof InboundWriteConflictError)) throw error;
      lastConflict = error;
      await sleep(WRITE_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw new InboundStoreError("write-contended", lastConflict);
}

// ==============================
// ALIASES
// ==============================

export async function readAlias(tokenHash: string): Promise<AliasRecord | null> {
  const found = await blobIo().read(aliasPath(tokenHash));
  if (!found) return null;
  const record = parseJson<AliasRecord>(found.text);
  return record && record.tokenHash === tokenHash ? record : null;
}

/**
 * Create-only write. A conflict means the freshly minted suffix collided with an
 * existing alias, and the caller re-mints rather than overwriting somebody
 * else's address — the collision-safety property §7 claims.
 */
export async function createAlias(record: AliasRecord): Promise<void> {
  await blobIo().write(aliasPath(record.tokenHash), JSON.stringify(record), { kind: "create" });
}

export async function updateAlias(
  tokenHash: string,
  mutator: (current: AliasRecord) => AliasRecord | null,
): Promise<AliasRecord | null> {
  const path = aliasPath(tokenHash);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const existing = await blobIo().read(path);
    if (!existing) return null;
    const current = parseJson<AliasRecord>(existing.text);
    if (!current) return null;
    const next = mutator(current);
    if (next === null) return null;

    const precondition: WritePrecondition = existing.etag.startsWith("W/")
      ? { kind: "none" }
      : { kind: "match", etag: existing.etag };
    try {
      await blobIo().write(path, JSON.stringify(next), precondition);
      return next;
    } catch (error) {
      if (!(error instanceof InboundWriteConflictError)) throw error;
      await sleep(WRITE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new InboundStoreError("alias-write-contended");
}

/**
 * Revocation deletes the sealed credential immediately rather than merely
 * flipping `active`. Leaving a decryptable refresh token behind after the user
 * asked us to stop would be the wrong reading of "revoke".
 */
export async function revokeAlias(tokenHash: string): Promise<AliasRecord | null> {
  return updateAlias(tokenHash, (current) => ({
    ...current,
    active: false,
    sealedRefreshToken: null,
    revokedAt: nowIso(),
  }));
}

export async function deleteAlias(tokenHash: string): Promise<void> {
  await blobIo().remove(aliasPath(tokenHash));
}

export async function touchAliasUsed(tokenHash: string): Promise<void> {
  // Best-effort: failing to stamp "last used" must never fail an ingestion.
  try {
    await updateAlias(tokenHash, (current) => ({ ...current, lastUsedAt: nowIso() }));
  } catch {
    // structural only, nothing to report
  }
}

// ==============================
// PER-USER DOCUMENT
// ==============================

const emptyUserRecord = (): UserRecord => ({
  version: DOCUMENT_VERSION,
  aliasHashes: [],
  recentActivity: [],
  emailInvoiceIds: [],
});

export async function readUserRecord(userId: string): Promise<UserRecord> {
  const found = await blobIo().read(userPath(userId));
  if (!found) return emptyUserRecord();
  return parseJson<UserRecord>(found.text) ?? emptyUserRecord();
}

export async function addAliasToUser(userId: string, tokenHash: string): Promise<void> {
  await mutate<UserRecord>(userPath(userId), emptyUserRecord, (current) => {
    if (current.aliasHashes.includes(tokenHash)) return null;
    return {
      ...current,
      version: DOCUMENT_VERSION,
      aliasHashes: [tokenHash, ...current.aliasHashes].slice(0, MAX_ALIASES_PER_USER),
    };
  });
}

export async function removeAliasFromUser(userId: string, tokenHash: string): Promise<void> {
  await mutate<UserRecord>(userPath(userId), emptyUserRecord, (current) => {
    if (!current.aliasHashes.includes(tokenHash)) return null;
    return {
      ...current,
      version: DOCUMENT_VERSION,
      aliasHashes: current.aliasHashes.filter((hash) => hash !== tokenHash),
    };
  });
}

/**
 * Append one activity entry, newest first, capped.
 *
 * Best-effort by contract: diagnostics are for humans, and losing a log line
 * must never turn a successfully ingested invoice into a failed webhook.
 */
export async function appendActivity(userId: string, entry: ActivityEntry): Promise<void> {
  try {
    await mutate<UserRecord>(userPath(userId), emptyUserRecord, (current) => {
      const withoutSame = current.recentActivity.filter(
        (existing) => existing.correlationId !== entry.correlationId,
      );
      return {
        ...current,
        version: DOCUMENT_VERSION,
        recentActivity: [entry, ...withoutSame].slice(0, MAX_ACTIVITY_ENTRIES),
      };
    });
  } catch {
    // structural only
  }
}

/**
 * Remember that these invoices arrived by email. Best-effort, like
 * appendActivity: a lost badge is cosmetic, and must never fail an ingestion
 * that already succeeded upstream.
 */
export async function recordEmailInvoiceIds(userId: string, invoiceIds: string[]): Promise<void> {
  const fresh = invoiceIds.filter((id) => typeof id === "string" && id.trim());
  if (fresh.length === 0) return;
  try {
    await mutate<UserRecord>(userPath(userId), emptyUserRecord, (current) => {
      const existing = current.emailInvoiceIds ?? [];
      const added = fresh.filter((id) => !existing.includes(id));
      if (added.length === 0) return null;
      return {
        ...current,
        version: DOCUMENT_VERSION,
        emailInvoiceIds: [...added, ...existing].slice(0, MAX_EMAIL_INVOICE_IDS),
      };
    });
  } catch {
    // structural only
  }
}

/** Every alias a user owns, skipping any dangling hash. */
export async function listUserAliases(userId: string): Promise<AliasRecord[]> {
  const record = await readUserRecord(userId);
  const found = await Promise.all(record.aliasHashes.map((hash) => readAlias(hash).catch(() => null)));
  return found.filter((alias): alias is AliasRecord => alias !== null);
}

// ==============================
// MESSAGES (IDEMPOTENCY + AUDIT)
// ==============================

export type ClaimOutcome =
  /** We are the first to see this event, or resuming an unfinished attempt. */
  | { kind: "claimed"; record: MessageRecord }
  /** Already finished. The webhook answers 200 and does no work. */
  | { kind: "duplicate"; record: MessageRecord };

/**
 * Atomically claim a webhook event.
 *
 * The create-only write is the idempotency primitive: exactly one caller can
 * create the record. A caller that loses the race re-reads and decides on
 * STATUS, not on existence — a record left in a non-terminal state belongs to an
 * attempt that died, and this delivery is the retry that should finish it.
 */
export async function claimMessage(seed: MessageRecord): Promise<ClaimOutcome> {
  const path = messagePath(seed.providerEventId);
  try {
    await blobIo().write(path, JSON.stringify(seed), { kind: "create" });
    return { kind: "claimed", record: seed };
  } catch (error) {
    if (!(error instanceof InboundWriteConflictError)) throw error;
  }

  const existing = await blobIo().read(path);
  const record = existing ? parseJson<MessageRecord>(existing.text) : null;
  if (!record) {
    // Present but unreadable. Treat as claimable rather than stranding the
    // message: overwriting an unparseable record loses nothing of value.
    await blobIo().write(path, JSON.stringify(seed), { kind: "none" });
    return { kind: "claimed", record: seed };
  }

  if (isTerminalStatus(record.status)) return { kind: "duplicate", record };

  const resumed: MessageRecord = { ...record, attempts: record.attempts + 1, updatedAt: nowIso() };
  await blobIo().write(path, JSON.stringify(resumed), { kind: "none" });
  return { kind: "claimed", record: resumed };
}

export async function readMessage(providerEventId: string): Promise<MessageRecord | null> {
  const found = await blobIo().read(messagePath(providerEventId));
  if (!found) return null;
  return parseJson<MessageRecord>(found.text);
}

/**
 * Persist message progress. Unconditional by design: within one delivery this is
 * the only writer, and a precondition failure here would abort work that has
 * already partly happened (an invoice may already exist upstream).
 */
export async function saveMessage(record: MessageRecord): Promise<void> {
  await blobIo().write(
    messagePath(record.providerEventId),
    JSON.stringify({ ...record, updatedAt: nowIso() }),
    { kind: "none" },
  );
}

/**
 * Delete message records older than `retentionDays` (§25).
 *
 * Not wired to a schedule in this repo — call it from a Vercel Cron route when
 * volume justifies it. Metadata-only records are small, so this is housekeeping
 * rather than a correctness requirement.
 */
export async function pruneMessages(retentionDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const paths = await blobIo().list(MESSAGE_PREFIX);
  let removed = 0;

  for (const path of paths) {
    const found = await blobIo().read(path).catch(() => null);
    if (!found) continue;
    const record = parseJson<MessageRecord>(found.text);
    if (!record) continue;
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(created) || created >= cutoff) continue;
    await blobIo().remove(path).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

export const __paths = { aliasPath, userPath, messagePath };
