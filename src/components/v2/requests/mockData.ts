// Sample data until the paperwork-request API exists. The /requests page runs
// entirely on this in local React state; dates are generated relative to
// today so the Open / Overdue split always looks realistic.

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

/** ISO timestamp for now + `days` at a given hour. */
function isoOffset(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const MOCK_MISSING_TRANSACTIONS: MissingPaperworkTransaction[] = [
  { id: "t-1", payee: "Delta Air Lines", amount: 642.3, date: ymdOffset(-21), account: "Business card ••1008" },
  { id: "t-2", payee: "Uber", amount: 38.75, date: ymdOffset(-18), account: "Business card ••1008" },
  { id: "t-3", payee: "Staples", amount: 129.99, date: ymdOffset(-15), account: "Operating account ••4410" },
  { id: "t-4", payee: "Adobe", amount: 59.99, date: ymdOffset(-12), account: "Business card ••1008" },
  { id: "t-5", payee: "Hilton Garden Inn", amount: 412.0, date: ymdOffset(-9), account: "Business card ••1008" },
  { id: "t-6", payee: "Summit Logistics", amount: 1180.0, date: ymdOffset(-6), account: "Operating account ••4410" },
];

export const MOCK_REQUESTS: PaperworkRequest[] = [
  {
    id: "rq-1",
    title: "Receipts for September card spend",
    type: "card_receipts",
    assigneeName: "Priya Raman",
    assigneeEmail: "priya@brightside.co",
    dueDate: ymdOffset(5),
    sentAt: isoOffset(-6, 10, 12),
    message: "Hi Priya, could you send receipts for these card charges when you get a moment?",
    remindersOn: true,
    status: "open",
    items: [
      { id: "i-1", description: "Delta Air Lines", amount: 642.3, date: ymdOffset(-21), status: "received", matchedDoc: "delta-eticket.pdf" },
      { id: "i-2", description: "Uber", amount: 38.75, date: ymdOffset(-18), status: "received", matchedDoc: "IMG_2231.jpg" },
      { id: "i-3", description: "Adobe", amount: 59.99, date: ymdOffset(-12), status: "waiting" },
      { id: "i-4", description: "Hilton Garden Inn", amount: 412.0, date: ymdOffset(-9), status: "waiting" },
    ],
    activity: [
      { id: "a-1", at: isoOffset(-6, 10, 12), kind: "sent", text: "Request emailed to priya@brightside.co" },
      { id: "a-2", at: isoOffset(-5, 10, 12), kind: "reminder", text: "Reminder sent (1 day after sending)" },
      { id: "a-3", at: isoOffset(-3, 16, 40), kind: "reply", text: "Reply received with 2 attachments" },
      { id: "a-4", at: isoOffset(-3, 16, 41), kind: "matched", text: "Delta Air Lines matched to delta-eticket.pdf" },
      { id: "a-5", at: isoOffset(-3, 16, 41), kind: "matched", text: "Uber matched to IMG_2231.jpg" },
    ],
  },
  {
    id: "rq-2",
    title: "Operating account statement — September",
    type: "bank_statement",
    assigneeName: "Marco Diaz",
    assigneeEmail: "marco@brightside.co",
    dueDate: ymdOffset(12),
    sentAt: isoOffset(-2, 9, 5),
    message: "",
    remindersOn: true,
    status: "open",
    items: [{ id: "i-1", description: "Operating account ••4410 statement, September", status: "waiting" }],
    activity: [
      { id: "a-1", at: isoOffset(-2, 9, 5), kind: "sent", text: "Request emailed to marco@brightside.co" },
      { id: "a-2", at: isoOffset(-1, 9, 5), kind: "reminder", text: "Reminder sent (1 day after sending)" },
    ],
  },
  {
    id: "rq-3",
    title: "Missing invoices from Summit Logistics",
    type: "missing_invoices",
    assigneeName: "Accounts team",
    assigneeEmail: "accounts@summitlogistics.com",
    dueDate: ymdOffset(-4),
    sentAt: isoOffset(-18, 11, 30),
    message: "Hello, our records show these charges without an invoice. Please reply with copies.",
    remindersOn: true,
    status: "open",
    items: [
      { id: "i-1", description: "SL-7781", amount: 1180.0, date: ymdOffset(-25), status: "waiting" },
      { id: "i-2", description: "SL-7794", amount: 860.0, date: ymdOffset(-20), status: "received", matchedDoc: "SL-7794.pdf" },
      { id: "i-3", description: "SL-7802", amount: 245.5, date: ymdOffset(-19), status: "waiting" },
    ],
    activity: [
      { id: "a-1", at: isoOffset(-18, 11, 30), kind: "sent", text: "Request emailed to accounts@summitlogistics.com" },
      { id: "a-2", at: isoOffset(-17, 11, 30), kind: "reminder", text: "Reminder sent (1 day after sending)" },
      { id: "a-3", at: isoOffset(-11, 11, 30), kind: "reminder", text: "Reminder sent (7 days before due)" },
      { id: "a-4", at: isoOffset(-9, 14, 2), kind: "reply", text: "Reply received with 1 attachment" },
      { id: "a-5", at: isoOffset(-9, 14, 3), kind: "matched", text: "SL-7794 matched to SL-7794.pdf" },
      { id: "a-6", at: isoOffset(-6, 11, 30), kind: "reminder", text: "Reminder sent (2 days before due)" },
      { id: "a-7", at: isoOffset(-5, 11, 30), kind: "reminder", text: "Reminder sent (1 day before due)" },
      { id: "a-8", at: isoOffset(-3, 11, 30), kind: "reminder", text: "Reminder sent (1 day after due)" },
    ],
  },
  {
    id: "rq-4",
    title: "Staples receipt",
    type: "other",
    assigneeName: "Jordan Lee",
    assigneeEmail: "jordan@brightside.co",
    dueDate: ymdOffset(-1),
    sentAt: isoOffset(-8, 15, 0),
    message: "",
    remindersOn: false,
    status: "open",
    items: [{ id: "i-1", description: "Staples", amount: 129.99, date: ymdOffset(-15), status: "waiting" }],
    activity: [{ id: "a-1", at: isoOffset(-8, 15, 0), kind: "sent", text: "Request emailed to jordan@brightside.co (reminders off)" }],
  },
  {
    id: "rq-5",
    title: "Missing invoices from Office Depot",
    type: "missing_invoices",
    assigneeName: "Office Depot billing",
    assigneeEmail: "billing@officedepot.example",
    dueDate: ymdOffset(-10),
    sentAt: isoOffset(-24, 9, 45),
    message: "",
    remindersOn: true,
    status: "completed",
    items: [
      { id: "i-1", description: "INV-1031", amount: 318.4, date: ymdOffset(-40), status: "received", matchedDoc: "INV-1031.pdf" },
      { id: "i-2", description: "INV-1036", amount: 92.0, date: ymdOffset(-36), status: "received", matchedDoc: "INV-1036.pdf" },
    ],
    activity: [
      { id: "a-1", at: isoOffset(-24, 9, 45), kind: "sent", text: "Request emailed to billing@officedepot.example" },
      { id: "a-2", at: isoOffset(-23, 9, 45), kind: "reminder", text: "Reminder sent (1 day after sending)" },
      { id: "a-3", at: isoOffset(-20, 13, 10), kind: "reply", text: "Reply received with 2 attachments" },
      { id: "a-4", at: isoOffset(-20, 13, 11), kind: "matched", text: "INV-1031 matched to INV-1031.pdf" },
      { id: "a-5", at: isoOffset(-20, 13, 11), kind: "matched", text: "INV-1036 matched to INV-1036.pdf" },
      { id: "a-6", at: isoOffset(-20, 13, 11), kind: "completed", text: "All items received — request completed automatically" },
    ],
  },
];
