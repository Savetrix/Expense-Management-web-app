"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DataTable, Modal, ModalDefinitionRow } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

import { ActorCell, formatTimestamp, withProvider } from "./format";
import { EVENT_TYPE_LABELS, ITEM_LINK_LABELS, type AuditEvent, type FieldChange } from "./mockData";

interface AuditEventModalProps {
  event: AuditEvent | null;
  providerName: string;
  onClose: () => void;
}

const changeColumns: DataTableColumn<FieldChange>[] = [
  { key: "field", header: "Field", width: "30%", render: (c) => <span className="block truncate font-semibold">{c.field}</span> },
  {
    key: "before",
    header: "Before",
    width: "35%",
    render: (c) => <span className="block truncate text-content-secondary line-through decoration-content-muted">{c.before}</span>,
  },
  {
    key: "after",
    header: "After",
    width: "35%",
    render: (c) => (
      <span className="flex min-w-0 items-center gap-[var(--space-xs)]">
        <ArrowRight size={12} strokeWidth={2.25} className="shrink-0 text-content-muted" />
        <span className="truncate font-semibold">{c.after}</span>
      </span>
    ),
  },
];

export function AuditEventModal({ event, providerName, onClose }: AuditEventModalProps) {
  if (!event) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={EVENT_TYPE_LABELS[event.type]}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {event.type !== "deleted" && (
            <Link
              href={event.item.href}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-[var(--space-sm)] text-body-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
            >
              <ExternalLink size={16} strokeWidth={2.25} />
              {ITEM_LINK_LABELS[event.item.kind]}
            </Link>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-lg)]">
        <div className="rounded-md border border-border px-[var(--space-md)]">
          <ModalDefinitionRow label="When">{formatTimestamp(event.at)}</ModalDefinitionRow>
          <ModalDefinitionRow label="By">
            <ActorCell event={event} />
          </ModalDefinitionRow>
          {event.actorEmail && <ModalDefinitionRow label="Email">{event.actorEmail}</ModalDefinitionRow>}
          <ModalDefinitionRow label="Item">
            <span className="truncate">{event.item.label}</span>
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Source">{event.source === "MCP" ? "MCP (AI chat)" : event.source}</ModalDefinitionRow>
          <ModalDefinitionRow label="Details">
            <span className="text-right">{withProvider(event.details, providerName)}</span>
          </ModalDefinitionRow>
        </div>

        <div>
          <p className="text-body-sm font-bold text-content-primary">Changes</p>
          <div className="mt-[var(--space-xs)]">
            {event.changes.length === 0 ? (
              <p className="rounded-md border border-border bg-page p-[var(--space-md)] text-center text-body-sm text-content-secondary">
                No field changes recorded for this event.
              </p>
            ) : (
              <DataTable columns={changeColumns} rows={event.changes} getRowKey={(c) => c.field} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
