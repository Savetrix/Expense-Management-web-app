// POST /api/paperwork/:id/upload — multipart { lineId, file }: the person asked
// uploads the receipt for one line of their request (paperwork.ts attachToLine).
import { can } from "@/lib/bankFeeds/door";
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { attachToLine, MAX_ATTACHMENT_BYTES } from "@/lib/bankFeeds/paperwork";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "paperwork");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the file as a form upload.");
  }
  const lineId = form.get("lineId");
  const file = form.get("file");
  if (typeof lineId !== "string" || !(file instanceof File)) return fail(400, "Pick the line and the file.");
  if (file.size > MAX_ATTACHMENT_BYTES) return fail(413, "That file is over 4 MB. Take a smaller photo or a PDF.");
  try {
    const result = await attachToLine(ctx.db, {
      qbConnectionId: ctx.connection.id,
      requestId: id,
      lineId,
      uploader: { userId: ctx.caller.userId, name: "", email: null },
      canCode: can(ctx.connection.role, "code"),
      file: { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
    });
    if (!result.ok) return fail(result.status, result.error);
    return json({ status: result.request.status, attachment: { id: result.attachment.id, name: result.attachment.name } }, 201);
  } catch (error) {
    return errorResponse("paperwork upload", error);
  }
}
