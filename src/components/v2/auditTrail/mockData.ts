// Sample data until the audit-log API exists. The /audit-trail page filters
// this list in the browser; timestamps are generated relative to now so the
// date-range filter behaves realistically. "{provider}" in a string is
// replaced with the active accounting software's name at render time.

export type ActorType = "person" | "autopilot" | "assistant";
export type AuditEventType =
  | "uploaded"
  | "edited"
  | "published"
  | "archived"
  | "unarchived"
  | "deleted"
  | "approved"
  | "paid"
  | "reconciled"
  | "period_closed"
  | "settings_changed"
  | "member_invited";
export type AuditSource = "Web" | "Email" | "WhatsApp" | "Mobile" | "MCP";
export type ItemKind = "bill" | "vendor" | "statement" | "period" | "settings" | "member" | "request";

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface AuditEvent {
  id: string;
  at: string; // ISO timestamp
  actorType: ActorType;
  /** Person's name; "Autopilot" / "AI assistant" for automated actors. */
  actorName: string;
  actorEmail?: string;
  type: AuditEventType;
  item: { kind: ItemKind; label: string; href: string };
  source: AuditSource;
  details: string;
  changes: FieldChange[];
}

export const EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  uploaded: "Uploaded",
  edited: "Edited",
  published: "Published",
  archived: "Archived",
  unarchived: "Unarchived",
  deleted: "Deleted",
  approved: "Approved",
  paid: "Paid",
  reconciled: "Reconciled",
  period_closed: "Period closed",
  settings_changed: "Settings changed",
  member_invited: "Member invited",
};

export const ITEM_LINK_LABELS: Record<ItemKind, string> = {
  bill: "Open bill",
  vendor: "Open vendor",
  statement: "Open statement",
  period: "Open dashboard",
  settings: "Open settings",
  member: "Open team",
  request: "Open request",
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const H = 60;
const D = 24 * H;

const PEOPLE = {
  saurabh: { actorName: "Saurabh Kalpasi", actorEmail: "saurabh@example.com" },
  priya: { actorName: "Priya Raman", actorEmail: "priya@brightside.co" },
  marco: { actorName: "Marco Diaz", actorEmail: "marco@brightside.co" },
  jordan: { actorName: "Jordan Lee", actorEmail: "jordan@brightside.co" },
};
const AUTOPILOT = { actorType: "autopilot" as const, actorName: "Autopilot" };
const ASSISTANT = { actorType: "assistant" as const, actorName: "AI assistant" };

const bill = (label: string) => ({ kind: "bill" as const, label, href: "/invoices" });

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: "ev-30", at: minutesAgo(4), ...AUTOPILOT, type: "uploaded", item: bill("Bill INV-1092 · Office Depot"), source: "Email", details: "Received at the Scantrix inbox and read automatically", changes: [] },
  { id: "ev-29", at: minutesAgo(9), ...AUTOPILOT, type: "edited", item: bill("Bill INV-1092 · Office Depot"), source: "Email", details: "Coded from vendor history", changes: [{ field: "GL account", before: "—", after: "Office Supplies" }, { field: "Tax code", before: "—", after: "Standard rate" }] },
  { id: "ev-28", at: minutesAgo(26), actorType: "person", ...PEOPLE.priya, type: "approved", item: bill("Bill NW-5561 · Northwind Traders"), source: "Mobile", details: "Approved from the mobile app", changes: [{ field: "Status", before: "Pending approval", after: "Approved" }] },
  { id: "ev-27", at: minutesAgo(41), ...ASSISTANT, type: "edited", item: bill("Bill BT-20261001 · Bluewave Telecom"), source: "MCP", details: "Changed via chat: “move Bluewave to Telephone & Internet”", changes: [{ field: "GL account", before: "Utilities", after: "Telephone & Internet" }] },
  { id: "ev-26", at: minutesAgo(1 * H + 5), actorType: "person", ...PEOPLE.saurabh, type: "published", item: bill("Bill NW-5561 · Northwind Traders"), source: "Web", details: "Posted to {provider}", changes: [{ field: "Status", before: "Approved", after: "Published" }] },
  { id: "ev-25", at: minutesAgo(2 * H + 12), actorType: "person", ...PEOPLE.marco, type: "uploaded", item: bill("Receipt · Uber"), source: "WhatsApp", details: "Photo sent over WhatsApp", changes: [] },
  { id: "ev-24", at: minutesAgo(3 * H + 30), ...AUTOPILOT, type: "reconciled", item: { kind: "statement", label: "Statement · Acme Packaging, Aug", href: "/supplier-statements" }, source: "Web", details: "All lines matched to bills", changes: [{ field: "Status", before: "Needs matching", after: "Reconciled" }] },
  { id: "ev-23", at: minutesAgo(5 * H), actorType: "person", ...PEOPLE.saurabh, type: "settings_changed", item: { kind: "settings", label: "Auto-publish rules", href: "/preferences" }, source: "Web", details: "Raised the auto-publish limit", changes: [{ field: "Auto-publish up to", before: "250.00", after: "500.00" }, { field: "Requires matched vendor", before: "No", after: "Yes" }] },
  { id: "ev-22", at: minutesAgo(8 * H), ...ASSISTANT, type: "archived", item: bill("Bill INV-1063 · Office Depot (duplicate)"), source: "MCP", details: "Archived as a duplicate of INV-1063 after confirmation in chat", changes: [{ field: "Status", before: "Draft", after: "Archived" }] },
  { id: "ev-21", at: minutesAgo(1 * D + 2 * H), actorType: "person", ...PEOPLE.jordan, type: "paid", item: bill("Bill AP-88164 · Acme Packaging"), source: "Web", details: "Marked paid from Operating account ••4410", changes: [{ field: "Payment status", before: "Unpaid", after: "Paid" }, { field: "Paid on", before: "—", after: "Oct 16, 2026" }] },
  { id: "ev-20", at: minutesAgo(1 * D + 5 * H), actorType: "person", ...PEOPLE.saurabh, type: "member_invited", item: { kind: "member", label: "Member · jordan@brightside.co", href: "/team" }, source: "Web", details: "Invited as Contributor", changes: [{ field: "Role", before: "—", after: "Contributor" }] },
  { id: "ev-19", at: minutesAgo(1 * D + 9 * H), ...AUTOPILOT, type: "published", item: bill("Bill INV-1078 · Office Depot"), source: "Email", details: "Auto-published to {provider} under the auto-publish rule", changes: [{ field: "Status", before: "Ready", after: "Published" }] },
  { id: "ev-18", at: minutesAgo(2 * D), actorType: "person", ...PEOPLE.priya, type: "edited", item: bill("Bill NW-5544 · Northwind Traders"), source: "Web", details: "Corrected the total after a credit", changes: [{ field: "Total", before: "1,500.75", after: "1,450.75" }, { field: "Tax", before: "125.06", after: "120.90" }] },
  { id: "ev-17", at: minutesAgo(2 * D + 3 * H), actorType: "person", ...PEOPLE.marco, type: "unarchived", item: bill("Bill GC-3302 · Greenleaf Cleaning"), source: "Web", details: "Restored from the archive", changes: [{ field: "Status", before: "Archived", after: "Draft" }] },
  { id: "ev-16", at: minutesAgo(3 * D), ...ASSISTANT, type: "uploaded", item: bill("Bill SL-7794 · Summit Logistics"), source: "MCP", details: "Attached from a chat upload", changes: [] },
  { id: "ev-15", at: minutesAgo(3 * D + 6 * H), actorType: "person", ...PEOPLE.saurabh, type: "deleted", item: bill("Bill TEST-001 · Sample Vendor"), source: "Web", details: "Deleted a test upload", changes: [{ field: "Status", before: "Draft", after: "Deleted" }] },
  { id: "ev-14", at: minutesAgo(4 * D), ...AUTOPILOT, type: "edited", item: { kind: "vendor", label: "Vendor · Summit Logistics", href: "/vendors" }, source: "Email", details: "Created from a new invoice sender", changes: [{ field: "Name", before: "—", after: "Summit Logistics" }, { field: "Default GL account", before: "—", after: "Freight & Delivery" }] },
  { id: "ev-13", at: minutesAgo(5 * D), actorType: "person", ...PEOPLE.jordan, type: "uploaded", item: bill("Receipt · Hilton Garden Inn"), source: "Mobile", details: "Scanned with the mobile camera", changes: [] },
  { id: "ev-12", at: minutesAgo(6 * D), actorType: "person", ...PEOPLE.priya, type: "approved", item: bill("Bill INV-1071 · Office Depot"), source: "Web", details: "Approved in bulk (4 bills)", changes: [{ field: "Status", before: "Pending approval", after: "Approved" }] },
  { id: "ev-11", at: minutesAgo(8 * D), ...ASSISTANT, type: "settings_changed", item: { kind: "settings", label: "Default tax code", href: "/preferences" }, source: "MCP", details: "Changed via chat after confirmation", changes: [{ field: "Default tax code", before: "Exempt", after: "Standard rate" }] },
  { id: "ev-10", at: minutesAgo(10 * D), actorType: "person", ...PEOPLE.saurabh, type: "period_closed", item: { kind: "period", label: "Period · September 2026", href: "/dashboard" }, source: "Web", details: "Closed the books for September", changes: [{ field: "Lock date", before: "Aug 31, 2026", after: "Sep 30, 2026" }] },
  { id: "ev-09", at: minutesAgo(12 * D), ...AUTOPILOT, type: "paid", item: bill("Bill BT-20260901 · Bluewave Telecom"), source: "Web", details: "Matched to a bank payment in {provider}", changes: [{ field: "Payment status", before: "Unpaid", after: "Paid" }] },
  { id: "ev-08", at: minutesAgo(15 * D), actorType: "person", ...PEOPLE.marco, type: "archived", item: bill("Receipt · Starbucks"), source: "Mobile", details: "Personal expense, archived", changes: [{ field: "Status", before: "Draft", after: "Archived" }] },
  { id: "ev-07", at: minutesAgo(18 * D), actorType: "person", ...PEOPLE.saurabh, type: "edited", item: { kind: "vendor", label: "Vendor · Office Depot", href: "/vendors" }, source: "Web", details: "Updated vendor defaults", changes: [{ field: "Default GL account", before: "Office Expenses", after: "Office Supplies" }, { field: "Email", before: "—", after: "billing@officedepot.example" }] },
  { id: "ev-06", at: minutesAgo(21 * D), ...AUTOPILOT, type: "reconciled", item: { kind: "statement", label: "Statement · Northwind Traders, Aug", href: "/supplier-statements" }, source: "Email", details: "All lines matched automatically", changes: [{ field: "Status", before: "Needs matching", after: "Reconciled" }] },
  { id: "ev-05", at: minutesAgo(26 * D), actorType: "person", ...PEOPLE.priya, type: "published", item: bill("Bill AP-88120 · Acme Packaging"), source: "Web", details: "Posted to {provider}", changes: [{ field: "Status", before: "Approved", after: "Published" }] },
  { id: "ev-04", at: minutesAgo(33 * D), ...ASSISTANT, type: "edited", item: bill("Bill NW-5530 · Northwind Traders"), source: "MCP", details: "Split into two lines via chat", changes: [{ field: "Line items", before: "1", after: "2" }, { field: "Line 2 GL account", before: "—", after: "Freight & Delivery" }] },
  { id: "ev-03", at: minutesAgo(40 * D), actorType: "person", ...PEOPLE.saurabh, type: "member_invited", item: { kind: "member", label: "Member · marco@brightside.co", href: "/team" }, source: "Web", details: "Invited as Accountant", changes: [{ field: "Role", before: "—", after: "Accountant" }] },
  { id: "ev-02", at: minutesAgo(52 * D), actorType: "person", ...PEOPLE.saurabh, type: "settings_changed", item: { kind: "settings", label: "Email forwarding", href: "/preferences" }, source: "Web", details: "Turned on the invoice inbox", changes: [{ field: "Inbox forwarding", before: "Off", after: "On" }] },
  { id: "ev-01", at: minutesAgo(95 * D), actorType: "person", ...PEOPLE.saurabh, type: "period_closed", item: { kind: "period", label: "Period · June 2026", href: "/dashboard" }, source: "Web", details: "Closed the books for June", changes: [{ field: "Lock date", before: "May 31, 2026", after: "Jun 30, 2026" }] },
];
