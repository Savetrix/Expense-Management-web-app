import { getInvoiceTitle, getUserDisplayName } from "@/lib/invoiceDisplay";
import type { InvoiceRecord, PopulatedUserRef } from "@/store/invoice/invoiceSlice";

import type { AuditEvent, AuditEventType } from "./types";

// Real activity, built from what every invoice already records: when it was
// uploaded and by whom, each status change in its history, and who posted it.
// Edits, archive, approvals and settings changes are not recorded anywhere the
// app can read yet, so they appear once the audit-log API exists (BE).

const SYSTEM_ACTOR = "Scantrix";

function actorOf(user: string | PopulatedUserRef | undefined | null) {
  const name = getUserDisplayName(user);
  const email = user && typeof user !== "string" ? user.email : undefined;
  return { name, email };
}

function statusEvent(status: string | undefined): { type: AuditEventType; verb: string } {
  switch (status) {
    case "auto":
      return { type: "published", verb: "Posted automatically" };
    case "manual":
      return { type: "published", verb: "Posted after review" };
    case "failed":
      return { type: "edited", verb: "Marked as failed" };
    case "pending":
      return { type: "edited", verb: "Moved to review" };
    case "processing":
      return { type: "edited", verb: "Started processing" };
    default:
      return { type: "edited", verb: "Status changed" };
  }
}

function timeOf(value?: string): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

export function buildInvoiceAuditEvents(invoices: InvoiceRecord[], emailInvoiceIds: string[]): AuditEvent[] {
  const emailIds = new Set(emailInvoiceIds);
  const events: AuditEvent[] = [];

  for (const invoice of invoices) {
    const label = getInvoiceTitle(invoice);
    const item = { kind: "bill" as const, label, href: `/invoices/${invoice._id}` };
    const source = emailIds.has(invoice._id) ? ("Email" as const) : ("Web" as const);

    if (invoice.createdAt && timeOf(invoice.createdAt)) {
      const uploader = actorOf(invoice.uploadedBy);
      events.push({
        id: `${invoice._id}-uploaded`,
        at: invoice.createdAt,
        actorType: "person",
        actorName: uploader.name || (source === "Email" ? "Email forwarding" : SYSTEM_ACTOR),
        actorEmail: uploader.email,
        type: "uploaded",
        item,
        source,
        details: source === "Email" ? "Received by email and read automatically" : "Uploaded and read automatically",
        changes: [],
      });
    }

    const history = (invoice.statusHistory ?? []).filter((h) => timeOf(h.changedAt));
    let sawPost = false;
    history.forEach((h, index) => {
      const { type, verb } = statusEvent(h.postedStatus);
      const who = actorOf(h.changedBy);
      const autoPosted = h.postedStatus === "auto";
      if (type === "published") sawPost = true;
      events.push({
        id: `${invoice._id}-status-${index}`,
        at: h.changedAt as string,
        actorType: autoPosted ? "autopilot" : "person",
        actorName: autoPosted ? "Autopilot" : who.name || SYSTEM_ACTOR,
        actorEmail: autoPosted ? undefined : who.email,
        type,
        item,
        source,
        details: h.reason ? `${verb}: ${h.reason}` : verb,
        changes: [],
      });
    });

    // Older invoices may have a post time but no matching history entry.
    if (!sawPost && invoice.quickbooks?.postedAt && timeOf(invoice.quickbooks.postedAt)) {
      const who = actorOf(invoice.quickbooks.postedBy);
      const auto = invoice.postedStatus === "auto";
      events.push({
        id: `${invoice._id}-posted`,
        at: invoice.quickbooks.postedAt,
        actorType: auto ? "autopilot" : "person",
        actorName: auto ? "Autopilot" : who.name || SYSTEM_ACTOR,
        actorEmail: auto ? undefined : who.email,
        type: "published",
        item,
        source,
        details: "Posted to {provider}",
        changes: [],
      });
    }
  }

  return events.sort((a, b) => timeOf(b.at) - timeOf(a.at));
}
