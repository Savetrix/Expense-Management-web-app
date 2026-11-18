// SERVER-ONLY. Paperwork requests (Saurabh, 18 Nov, after Briefcase): a bank
// line posted without a bill behind it has no copy of the receipt, and someone
// on the team has it.
//
//   a person picks lines with no attachment → "Request paperwork" → picks a
//   team member of the company (and maybe a note) → that person sees the
//   request, uploads the receipt against each line → the file attaches to the
//   line → when every line has a file, the request is done.
//
// Kept in the bank database with the lines (requests in `paperwork_requests`,
// files in GridFS bucket `bank_attachments`), not in the backend: the backend
// has no such endpoints, and uploading a receipt there as an invoice would put
// it in the bills list, where it could be posted a second time.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { GridFSBucket, type GridFSFile } from "mongodb";

import { SAVETRIX_API_BASE_URL } from "./config";
import type { Db } from "./db";
import type { AttachmentRef, TxnDoc } from "./schema";
import { logEvent } from "./store";

/** Vercel refuses request bodies over 4.5 MB; a phone photo of a receipt fits. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export interface Person {
  userId: string;
  name: string;
  email: string | null;
}

export interface PaperworkRequestDoc {
  _id: string;
  qbConnectionId: string;
  requestedBy: Person;
  assignee: Person;
  note: string | null;
  lineIds: string[];
  status: "open" | "done";
  createdAt: Date;
  doneAt: Date | null;
  /** The email to the assignee went out (null: email isn't set up on this server). */
  emailed: boolean | null;
}

export interface TeamMember extends Person {
  role: string;
}

const bucket = (db: Db) => new GridFSBucket(db.database, { bucketName: "bank_attachments" });

/** A line counts as having paperwork when a file is attached to it, or it is matched to a bill (scanned bills always carry their file). */
export const hasPaperwork = (t: Pick<TxnDoc, "attachments" | "matchedInvoiceId">) => Boolean(t.attachments?.length || t.matchedInvoiceId);

/**
 * The company's team members who can open Bank Transactions: owners, admins
 * and accountants, and contributors whose page access includes it (a
 * contributor without it couldn't reach the request). Pending invites and the
 * email-forwarding service account are left out. The backend's list leaves
 * out the person asking.
 */
export async function teamMembers(userToken: string, qbConnectionId: string): Promise<TeamMember[]> {
  const res = await fetch(`${SAVETRIX_API_BASE_URL}/qb-connections/${encodeURIComponent(qbConnectionId)}/members`, {
    headers: { Authorization: `Bearer ${userToken}`, "X-QB-Id": qbConnectionId, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`members ${res.status}`);
  const body = (await res.json().catch(() => null)) as { data?: { members?: unknown[]; owner?: { userId?: unknown } } } | null;
  return readTeam(body?.data ?? {});
}

type RawUser = { _id?: unknown; firstName?: unknown; lastName?: unknown; email?: unknown };
const person = (u: RawUser | null | undefined): Person | null => {
  if (!u || typeof u._id !== "string") return null;
  const name = [u.firstName, u.lastName].filter((x) => typeof x === "string" && x.trim()).join(" ").trim();
  const email = typeof u.email === "string" ? u.email.toLowerCase() : null;
  return { userId: u._id, name: name || email || "Team member", email };
};

/** Pure: the backend's members answer → who may be asked for paperwork. */
export function readTeam(data: { members?: unknown[]; owner?: { userId?: unknown } }): TeamMember[] {
  const out: TeamMember[] = [];
  const owner = person(data.owner?.userId as RawUser | undefined);
  if (owner) out.push({ ...owner, role: "owner" });
  for (const raw of data.members ?? []) {
    const m = raw as { userId?: RawUser; role?: unknown; inviteStatus?: unknown; isForwardingService?: unknown; pageAccess?: unknown };
    const p = person(m.userId);
    if (!p || m.isForwardingService === true || (typeof m.inviteStatus === "string" && m.inviteStatus !== "accepted")) continue;
    const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
    const pages = Array.isArray(m.pageAccess) ? m.pageAccess : null;
    if (role === "contributor" && !(pages ?? []).includes("bank-transactions")) continue;
    if (!["admin", "accountant", "contributor"].includes(role)) continue;
    if (!out.some((x) => x.userId === p.userId)) out.push({ ...p, role });
  }
  return out;
}

export async function createRequest(
  db: Db,
  args: { qbConnectionId: string; requestedBy: Person; assignee: Person; lineIds: string[]; note: string | null },
): Promise<{ ok: true; request: PaperworkRequestDoc } | { ok: false; error: string }> {
  const ids = [...new Set(args.lineIds)];
  if (ids.length === 0) return { ok: false, error: "Pick the lines that need paperwork." };
  const lines = await db.txns.find({ qbConnectionId: args.qbConnectionId, _id: { $in: ids }, removedAt: null }).toArray();
  if (lines.length !== ids.length) return { ok: false, error: "Some of those lines aren't here any more. Reload and try again." };
  const covered = lines.filter(hasPaperwork);
  if (covered.length > 0) return { ok: false, error: `${covered.length === 1 ? "One line already has" : `${covered.length} lines already have`} a receipt or bill. Leave ${covered.length === 1 ? "it" : "them"} out.` };
  const request: PaperworkRequestDoc = {
    _id: randomUUID(),
    qbConnectionId: args.qbConnectionId,
    requestedBy: args.requestedBy,
    assignee: args.assignee,
    note: args.note?.trim().slice(0, 500) || null,
    lineIds: ids,
    status: "open",
    createdAt: new Date(),
    doneAt: null,
    emailed: null,
  };
  await db.paperwork.insertOne(request);
  await logEvent(db, { qbConnectionId: args.qbConnectionId, transactionId: null, actor: args.requestedBy.userId, action: "bank.paperwork_requested", detail: { requestId: request._id, assignee: args.assignee.userId, lines: ids.length } });
  return { ok: true, request };
}

export async function listRequests(db: Db, qbConnectionId: string, only?: { assigneeId: string }): Promise<PaperworkRequestDoc[]> {
  return db.paperwork
    .find({ qbConnectionId, ...(only ? { "assignee.userId": only.assigneeId } : {}) })
    .sort({ status: -1, createdAt: -1 })
    .limit(200)
    .toArray();
}

/**
 * Saves a receipt against one line of a request and attaches it to the line.
 * Only the person asked (or someone who may code the company's lines) uploads.
 * The request is done once every line has a receipt or bill.
 */
export async function attachToLine(
  db: Db,
  args: { qbConnectionId: string; requestId: string; lineId: string; uploader: Person; canCode: boolean; file: { name: string; type: string; bytes: Uint8Array } },
): Promise<{ ok: true; request: PaperworkRequestDoc; attachment: AttachmentRef } | { ok: false; status: number; error: string }> {
  const request = await db.paperwork.findOne({ _id: args.requestId, qbConnectionId: args.qbConnectionId });
  if (!request) return { ok: false, status: 404, error: "That request isn't here any more." };
  if (request.assignee.userId !== args.uploader.userId && !args.canCode) return { ok: false, status: 403, error: "This request is for someone else." };
  if (!request.lineIds.includes(args.lineId)) return { ok: false, status: 400, error: "That line isn't part of this request." };
  if (!ATTACHMENT_TYPES.has(args.file.type)) return { ok: false, status: 400, error: "Upload a PDF or a photo (JPG, PNG, HEIC or WEBP)." };
  if (args.file.bytes.byteLength === 0) return { ok: false, status: 400, error: "That file is empty." };
  if (args.file.bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, status: 413, error: "That file is over 4 MB. Take a smaller photo or a PDF." };

  const fileId = randomUUID();
  const name = args.file.name.replace(/[^\w .()-]/g, "_").slice(0, 120) || "receipt";
  await new Promise<void>((resolve, reject) => {
    Readable.from(Buffer.from(args.file.bytes))
      .pipe(bucket(db).openUploadStreamWithId(fileId as never, name, { metadata: { qbConnectionId: args.qbConnectionId, txnId: args.lineId, requestId: request._id, contentType: args.file.type } }))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  const attachment: AttachmentRef = { id: fileId, name, mimeType: args.file.type, size: args.file.bytes.byteLength, uploadedBy: args.uploader.userId, uploadedAt: new Date(), requestId: request._id };
  await db.txns.updateOne({ _id: args.lineId, qbConnectionId: args.qbConnectionId }, { $push: { attachments: attachment }, $set: { updatedAt: new Date() } });
  await logEvent(db, { qbConnectionId: args.qbConnectionId, transactionId: args.lineId, actor: args.uploader.userId, action: "bank.attachment_added", detail: { requestId: request._id, fileId, name } });

  const lines = await db.txns.find({ qbConnectionId: args.qbConnectionId, _id: { $in: request.lineIds } }, { projection: { attachments: 1, matchedInvoiceId: 1, removedAt: 1 } }).toArray();
  const done = lines.every((l) => l.removedAt || hasPaperwork(l));
  const updated = done && request.status === "open" ? await db.paperwork.findOneAndUpdate({ _id: request._id }, { $set: { status: "done", doneAt: new Date() } }, { returnDocument: "after" }) : request;
  return { ok: true, request: updated ?? request, attachment };
}

/** May this person read the files on this line? Anyone who can see bank lines, or the person asked for them. */
export async function canReadAttachment(db: Db, args: { qbConnectionId: string; lineId: string; userId: string; canView: boolean }): Promise<boolean> {
  if (args.canView) return true;
  return Boolean(await db.paperwork.findOne({ qbConnectionId: args.qbConnectionId, lineIds: args.lineId, "assignee.userId": args.userId }, { projection: { _id: 1 } }));
}

export async function readAttachment(db: Db, args: { qbConnectionId: string; lineId: string; fileId: string }): Promise<{ file: GridFSFile; stream: NodeJS.ReadableStream } | null> {
  const [file] = await bucket(db).find({ _id: args.fileId as never, "metadata.qbConnectionId": args.qbConnectionId, "metadata.txnId": args.lineId }).toArray();
  if (!file) return null;
  return { file, stream: bucket(db).openDownloadStream(file._id) };
}

/** Email set-up for the note to the assignee; null when this server can't send email. */
export function paperworkEmailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.OUTBOUND_EMAIL_API_KEY?.trim() || process.env.INBOUND_PROVIDER_API_KEY?.trim();
  const from = process.env.PAPERWORK_FROM_EMAIL?.trim() || process.env.CUSTOM_PLAN_ENQUIRY_FROM_EMAIL?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Pure: the short email to the person asked, with a link to their requests. */
export function paperworkEmail(args: { request: PaperworkRequestDoc; companyName: string; link: string; lines: Pick<TxnDoc, "date" | "description" | "amountCents" | "currency">[] }) {
  const { request } = args;
  const list = args.lines.map((l) => `${l.date}  ${l.description}  ${(Math.abs(l.amountCents) / 100).toFixed(2)}${l.currency ? ` ${l.currency}` : ""}`);
  const intro = `${request.requestedBy.name} asked you for the receipts for ${args.lines.length === 1 ? "this bank line" : `these ${args.lines.length} bank lines`} in ${args.companyName}:`;
  const text = [`Hi ${request.assignee.name},`, "", intro, "", ...list, "", ...(request.note ? [`Note: ${request.note}`, ""] : []), `Upload them here: ${args.link}`, "", "ScanTrix"].join("\n");
  const html = `<p>Hi ${esc(request.assignee.name)},</p><p>${esc(intro)}</p><ul>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${request.note ? `<p>Note: ${esc(request.note)}</p>` : ""}<p><a href="${esc(args.link)}">Upload the receipts in ScanTrix</a></p>`;
  return { subject: `Receipts needed for ${args.lines.length} bank line${args.lines.length === 1 ? "" : "s"} (${args.companyName})`, text, html };
}
