// Types and product config for the /requests page. Requests are listed by
// the backend (not wired yet); the page starts empty and only shows requests
// created in this session.

export type RequestType = "missing_invoices" | "bank_statement" | "card_receipts" | "other";
export type RequestStatus = "open" | "completed" | "cancelled";
export type ItemStatus = "waiting" | "received";
export type ActivityKind = "sent" | "reminder" | "reply" | "matched" | "received" | "completed" | "cancelled";

export interface RequestItem {
  id: string;
  description: string;
  amount?: number;
  date?: string; // YYYY-MM-DD
  status: ItemStatus;
  /** File the reply was matched to, once received. */
  matchedDoc?: string;
}

export interface ActivityEvent {
  id: string;
  at: string; // ISO timestamp
  kind: ActivityKind;
  text: string;
}

export interface PaperworkRequest {
  id: string;
  title: string;
  type: RequestType;
  assigneeName: string;
  assigneeEmail: string;
  dueDate: string; // YYYY-MM-DD
  sentAt: string; // ISO timestamp
  message: string;
  remindersOn: boolean;
  status: RequestStatus;
  items: RequestItem[];
  activity: ActivityEvent[];
}

export interface MissingPaperworkTransaction {
  id: string;
  payee: string;
  amount: number;
  date: string;
  account: string;
}

export const REQUEST_TYPES: { value: RequestType; label: string; defaultTitle: string }[] = [
  { value: "missing_invoices", label: "Missing invoices", defaultTitle: "Missing invoices" },
  { value: "bank_statement", label: "Bank statement", defaultTitle: "Bank statement" },
  { value: "card_receipts", label: "Receipts for card spend", defaultTitle: "Receipts for card spend" },
  { value: "other", label: "Other", defaultTitle: "Paperwork request" },
];

export const requestTypeLabel = (type: RequestType) => REQUEST_TYPES.find((t) => t.value === type)?.label ?? "Other";

/** YYYY-MM-DD for today + `days` (negative for the past), in local time. */
export function ymdOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
