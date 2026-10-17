"use client";

import { BellRing, CheckCircle2, CircleSlash, FileCheck2, Inbox, Mail, PackageCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar, Modal, ModalDefinitionRow, ProgressBar } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";

import { ROW_ACTION_CLASS, dueText, formatDate, formatDateTime, isOverdue, money, receivedCount } from "./format";
import { requestTypeLabel, type ActivityEvent, type ActivityKind, type PaperworkRequest } from "./mockData";

const ACTIVITY_ICON: Record<ActivityKind, ReactNode> = {
  sent: <Mail size={14} strokeWidth={2} />,
  reminder: <BellRing size={14} strokeWidth={2} />,
  reply: <Inbox size={14} strokeWidth={2} />,
  matched: <FileCheck2 size={14} strokeWidth={2} />,
  received: <PackageCheck size={14} strokeWidth={2} />,
  completed: <CheckCircle2 size={14} strokeWidth={2} />,
  cancelled: <CircleSlash size={14} strokeWidth={2} />,
};

interface RequestDetailModalProps {
  request: PaperworkRequest | null;
  onClose: () => void;
  onChange: (id: string, update: (request: PaperworkRequest) => PaperworkRequest) => void;
}

const event = (kind: ActivityKind, text: string): ActivityEvent => ({
  id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  at: new Date().toISOString(),
  kind,
  text,
});

export function RequestDetailModal({ request, onClose, onChange }: RequestDetailModalProps) {
  if (!request) return null;

  const open = request.status === "open";
  const received = receivedCount(request);
  const total = request.items.length;
  const overdue = isOverdue(request);

  const sendReminder = () => {
    notifyBackendPending("Send reminder now");
    onChange(request.id, (r) => ({ ...r, activity: [...r.activity, event("reminder", `Reminder sent manually to ${r.assigneeEmail}`)] }));
  };

  const markItemReceived = (itemId: string) => {
    notifyBackendPending("Mark item received");
    onChange(request.id, (r) => {
      const item = r.items.find((i) => i.id === itemId);
      return {
        ...r,
        items: r.items.map((i) => (i.id === itemId ? { ...i, status: "received", matchedDoc: "Marked received manually" } : i)),
        activity: [...r.activity, event("received", `${item?.description ?? "Item"} marked as received`)],
      };
    });
  };

  const markComplete = async () => {
    if (received < total) {
      const ok = await confirmDialog({
        title: "Complete with items outstanding?",
        message: `${total - received} of ${total} items haven't been received. Completing stops all reminders for this request.`,
        confirmLabel: beLabel("Mark complete"),
      });
      if (!ok) return;
    }
    notifyBackendPending("Mark complete");
    onChange(request.id, (r) => ({ ...r, status: "completed", activity: [...r.activity, event("completed", "Request marked complete")] }));
    showToast(`"${request.title}" completed.`, "success");
  };

  const cancelRequest = async () => {
    const ok = await confirmDialog({
      title: "Cancel this request?",
      message: `${request.assigneeName} won't get any more reminders, and replies will no longer be matched to this request.`,
      confirmLabel: beLabel("Cancel request"),
      cancelLabel: "Keep request",
      tone: "destructive",
    });
    if (!ok) return;
    notifyBackendPending("Cancel request");
    onChange(request.id, (r) => ({ ...r, status: "cancelled", activity: [...r.activity, event("cancelled", "Request cancelled")] }));
    showToast("Request cancelled.", "info");
  };

  const statusBadge =
    request.status === "completed" ? (
      <Badge variant="success">Completed</Badge>
    ) : request.status === "cancelled" ? (
      <Badge variant="neutral">Cancelled</Badge>
    ) : overdue ? (
      <Badge variant="error">Overdue</Badge>
    ) : (
      <Badge variant="warning">Open</Badge>
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={request.title}
      widthClassName="max-w-2xl"
      footer={
        open ? (
          <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
            <Button variant="outline" size="sm" onClick={cancelRequest} className="text-status-danger-text sm:mr-auto">
              {beLabel("Cancel request")}
            </Button>
            <Button variant="outline" size="sm" onClick={sendReminder}>
              <BellRing size={16} strokeWidth={2.25} />
              {beLabel("Send reminder now")}
            </Button>
            <Button size="sm" onClick={markComplete}>
              <CheckCircle2 size={16} strokeWidth={2.25} />
              {beLabel("Mark complete")}
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-[var(--space-lg)]">
        <div>
          <div className="flex items-center gap-[var(--space-sm)]">
            <Avatar name={request.assigneeName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-content-primary">{request.assigneeName}</p>
              <p className="truncate text-caption text-content-secondary">{request.assigneeEmail}</p>
            </div>
            {statusBadge}
          </div>
          <div className="mt-[var(--space-sm)] rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Type">{requestTypeLabel(request.type)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Sent">{formatDateTime(request.sentAt)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Due">
              {formatDate(request.dueDate)}
              {open && <span className={overdue ? "text-error" : "text-content-secondary"}> · {dueText(request.dueDate)}</span>}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Reminders">{request.remindersOn ? "Automatic" : "Off"}</ModalDefinitionRow>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-[var(--space-sm)]">
            <p className="text-body-sm font-bold text-content-primary">Items</p>
            <p className="text-caption font-semibold text-content-secondary">
              {received} of {total} received
            </p>
          </div>
          <div className="mt-[var(--space-xs)]">
            <ProgressBar percent={total ? (received / total) * 100 : 0} colorClassName="bg-accent" label="Items received" />
          </div>
          <ul className="mt-[var(--space-sm)] divide-y divide-border overflow-hidden rounded-md border border-border">
            {request.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-semibold text-content-primary">{item.description}</p>
                  <p className="truncate text-caption text-content-secondary">
                    {[item.amount !== undefined ? money(item.amount) : "", item.date ? formatDate(item.date) : ""].filter(Boolean).join(" · ") || "No amount or date"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-[var(--space-xs)]">
                  {item.status === "received" ? (
                    <Badge variant="success" title={item.matchedDoc}>
                      Received{item.matchedDoc ? ` — ${item.matchedDoc === "Marked received manually" ? "marked manually" : `matched to ${item.matchedDoc}`}` : ""}
                    </Badge>
                  ) : (
                    <>
                      <Badge variant="warning">Waiting</Badge>
                      {open && (
                        <button type="button" className={ROW_ACTION_CLASS} onClick={() => markItemReceived(item.id)}>
                          {beLabel("Mark item received")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {open && received === total && total > 0 && (
            <p className="mt-[var(--space-xs)] text-caption font-semibold text-success">Everything has been received — you can mark this request complete.</p>
          )}
        </div>

        {request.message && (
          <div>
            <p className="text-body-sm font-bold text-content-primary">Message</p>
            <p className="mt-[var(--space-xs)] whitespace-pre-line rounded-md bg-page p-[var(--space-sm)] text-body-sm text-content-secondary">{request.message}</p>
          </div>
        )}

        <div>
          <p className="text-body-sm font-bold text-content-primary">Activity</p>
          <ol className="mt-[var(--space-sm)] flex flex-col">
            {[...request.activity].reverse().map((a, idx, list) => (
              <li key={a.id} className="relative flex gap-[var(--space-sm)] pb-[var(--space-md)] last:pb-0">
                {idx < list.length - 1 && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-alt text-content-secondary">{ACTIVITY_ICON[a.kind]}</span>
                <div className="min-w-0 pt-[3px]">
                  <p className="text-body-sm text-content-primary">{a.text}</p>
                  <p className="text-caption text-content-muted">{formatDateTime(a.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
