// /api/paperwork — paperwork requests for bank lines with no receipt (paperwork.ts).
//   GET   the company's requests with their lines (someone who can see bank
//         lines sees all; anyone else only the requests addressed to them).
//   POST  { lineIds, assigneeUserId, note?, requesterName? } asks a team member
//         for the receipts, and emails them a link when this server can send email.
import { can } from "@/lib/bankFeeds/door";
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { createRequest, hasPaperwork, listRequests, paperworkEmail, paperworkEmailConfig, teamMembers, type PaperworkRequestDoc } from "@/lib/bankFeeds/paperwork";
import type { Db } from "@/lib/bankFeeds/db";
import { sendEmail } from "@/lib/email/send";

export const runtime = "nodejs";
export const maxDuration = 30;

async function withLines(db: Db, qbConnectionId: string, requests: PaperworkRequestDoc[]) {
  const ids = [...new Set(requests.flatMap((r) => r.lineIds))];
  const lines = await db.txns.find({ qbConnectionId, _id: { $in: ids } }, { projection: { date: 1, description: 1, amountCents: 1, currency: 1, attachments: 1, matchedInvoiceId: 1, removedAt: 1 } }).toArray();
  const byId = new Map(lines.map((l) => [l._id, l]));
  return requests.map((r) => ({
    id: r._id,
    requestedBy: r.requestedBy,
    assignee: r.assignee,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    emailed: r.emailed,
    lines: r.lineIds.map((id) => {
      const l = byId.get(id);
      return l
        ? { id, date: l.date, description: l.description, amount: l.amountCents / 100, currency: l.currency ?? null, done: hasPaperwork(l), attachments: (l.attachments ?? []).map((a) => ({ id: a.id, name: a.name })) }
        : { id, date: "", description: "This line was removed", amount: 0, currency: null, done: true, attachments: [] };
    }),
  }));
}

export async function GET(request: Request) {
  const ctx = await bankContext(request, "paperwork");
  if (ctx instanceof Response) return ctx;
  try {
    const all = can(ctx.connection.role, "view");
    const requests = await listRequests(ctx.db, ctx.connection.id, all ? undefined : { assigneeId: ctx.caller.userId });
    return json({ me: ctx.caller.userId, canRequest: can(ctx.connection.role, "code"), requests: await withLines(ctx.db, ctx.connection.id, requests) });
  } catch (error) {
    return errorResponse("paperwork", error);
  }
}

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const lineIds = Array.isArray(body?.lineIds) ? body.lineIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  const assigneeUserId = typeof body?.assigneeUserId === "string" ? body.assigneeUserId : "";
  if (!assigneeUserId) return fail(400, "Pick who should send the receipts.");
  try {
    const team = await teamMembers(ctx.caller.accessToken, ctx.connection.id).catch(() => null);
    if (!team) return fail(503, "ScanTrix couldn't load the team just now. Try again.");
    const assignee = team.find((m) => m.userId === assigneeUserId && m.askable);
    if (!assignee) return fail(400, "That person isn't on this company's team, or hasn't joined ScanTrix yet.");
    const requesterName = typeof body?.requesterName === "string" && body.requesterName.trim() ? body.requesterName.trim().slice(0, 80) : "A teammate";
    const created = await createRequest(ctx.db, {
      qbConnectionId: ctx.connection.id,
      requestedBy: { userId: ctx.caller.userId, name: requesterName, email: null },
      assignee: { userId: assignee.userId, name: assignee.name, email: assignee.email },
      lineIds,
      note: typeof body?.note === "string" ? body.note : null,
    });
    if (!created.ok) return fail(400, created.error);

    // A short email with a link, when this server can send email; else in the app only.
    const config = paperworkEmailConfig();
    let emailed: boolean | null = null;
    if (config && assignee.email) {
      const lines = await ctx.db.txns.find({ qbConnectionId: ctx.connection.id, _id: { $in: created.request.lineIds } }, { projection: { date: 1, description: 1, amountCents: 1, currency: 1 } }).toArray();
      const link = `${new URL(request.url).origin}/bank-transactions?tab=requests`;
      const mail = paperworkEmail({ request: created.request, companyName: ctx.connection.name, link, lines });
      const sent = await sendEmail({ from: config.from, to: [assignee.email], ...mail }, config.apiKey);
      emailed = sent.ok;
      if (!sent.ok) console.error("[bank] paperwork email", sent.reason);
      await ctx.db.paperwork.updateOne({ _id: created.request._id }, { $set: { emailed } });
    }
    const [view] = await withLines(ctx.db, ctx.connection.id, [{ ...created.request, emailed }]);
    return json({ request: view }, 201);
  } catch (error) {
    return errorResponse("paperwork request", error);
  }
}
