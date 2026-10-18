// Audit-trail types and fixed option labels. Events come from the audit-log
// API once it exists; the page starts empty. "{provider}" in a details string
// is replaced with the active accounting software's name at render time.

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
