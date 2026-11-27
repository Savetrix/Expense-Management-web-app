// GET /api/bank-transactions/:id/attachments/:fileId — a receipt attached to a
// bank line (paperwork.ts). Anyone who can see bank lines, or the person who
// was asked for it.
import { Readable } from "node:stream";

import { can } from "@/lib/bankFeeds/door";
import { bankContext, errorResponse, fail } from "@/lib/bankFeeds/http";
import { canReadAttachment, readAttachment } from "@/lib/bankFeeds/paperwork";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const ctx = await bankContext(request, "paperwork");
  if (ctx instanceof Response) return ctx;
  const { id, fileId } = await params;
  try {
    if (!(await canReadAttachment(ctx.db, { qbConnectionId: ctx.connection.id, lineId: id, userId: ctx.caller.userId, canView: can(ctx.connection.role, "view") }))) {
      return fail(403, "You can't open this file.");
    }
    const found = await readAttachment(ctx.db, { qbConnectionId: ctx.connection.id, lineId: id, fileId });
    if (!found) return fail(404, "That file isn't here any more.");
    const type = String((found.file.metadata as { contentType?: string } | undefined)?.contentType ?? "application/octet-stream");
    return new Response(Readable.toWeb(found.stream as Readable) as ReadableStream, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `inline; filename="${found.file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse("attachment", error);
  }
}
