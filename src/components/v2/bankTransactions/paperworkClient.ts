// Browser calls for paperwork requests (routes under /api/paperwork). Every
// call goes through authFetch, never a token read from Redux.
import { authFetch } from "@/lib/authFetch";

export interface PaperworkPerson {
  userId: string;
  name: string;
  email: string | null;
}
export interface TeamMemberDto extends PaperworkPerson {
  role: string;
}
export interface PaperworkLineDto {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string | null;
  done: boolean;
  attachments: { id: string; name: string }[];
}
export interface PaperworkRequestDto {
  id: string;
  requestedBy: PaperworkPerson;
  assignee: PaperworkPerson;
  note: string | null;
  status: "open" | "done";
  createdAt: string;
  doneAt: string | null;
  /** The email to the assignee went out; null when this server doesn't send email. */
  emailed: boolean | null;
  lines: PaperworkLineDto[];
}

const headers = (qbConnectionId: string, json = false) => ({ "X-QB-Id": qbConnectionId, ...(json ? { "Content-Type": "application/json" } : {}) });

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "ScanTrix couldn't do that just now. Try again.");
  return body as T;
}

export async function fetchPaperwork(qbConnectionId: string): Promise<{ me: string; canRequest: boolean; requests: PaperworkRequestDto[] }> {
  return read(await authFetch("/api/paperwork", { headers: headers(qbConnectionId) }));
}

export async function fetchPaperworkTeam(qbConnectionId: string): Promise<TeamMemberDto[]> {
  return (await read<{ members: TeamMemberDto[] }>(await authFetch("/api/paperwork/team", { headers: headers(qbConnectionId) }))).members;
}

export async function requestPaperwork(qbConnectionId: string, body: { lineIds: string[]; assigneeUserId: string; note: string; requesterName: string }): Promise<PaperworkRequestDto> {
  return (await read<{ request: PaperworkRequestDto }>(await authFetch("/api/paperwork", { method: "POST", headers: headers(qbConnectionId, true), body: JSON.stringify(body) }))).request;
}

export async function uploadReceipt(qbConnectionId: string, requestId: string, lineId: string, file: File): Promise<{ status: "open" | "done" }> {
  const form = new FormData();
  form.set("lineId", lineId);
  form.set("file", file);
  return read(await authFetch(`/api/paperwork/${encodeURIComponent(requestId)}/upload`, { method: "POST", headers: headers(qbConnectionId), body: form }));
}

/** Opens an attached receipt in a new tab (the file needs the sign-in, so it is fetched first). */
export async function openAttachment(qbConnectionId: string, lineId: string, fileId: string): Promise<void> {
  const tab = window.open("", "_blank");
  const res = await authFetch(`/api/bank-transactions/${encodeURIComponent(lineId)}/attachments/${encodeURIComponent(fileId)}`, { headers: headers(qbConnectionId) });
  if (!res.ok) {
    tab?.close();
    throw new Error((await res.json().catch(() => null))?.error || "ScanTrix couldn't open that file.");
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
}
