"use client";

import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { PendingDocument } from "./mockData";
import { date, money } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

const TYPE_LABEL: Record<PendingDocument["type"], string> = {
  invoice: "Invoice",
  claim: "Expense claim",
  credit_note: "Credit note",
};

// Section 1 — every scanned document dated on or before period end that has
// not been posted yet must be posted or archived before the period can close.
export function PendingInvoicesSection({ paper, onUpdate }: CloseSectionProps) {
  const provider = useActiveProvider();

  const remove = (id: string) => onUpdate((wp) => ({ ...wp, documents: wp.documents.filter((d) => d.id !== id) }));

  const handlePost = (doc: PendingDocument) => {
    notifyBackendPending("Post");
    remove(doc.id);
    showToast(`${doc.number} posted to ${provider.name}.`, "success");
  };

  const handleArchive = async (doc: PendingDocument) => {
    const ok = await confirmDialog({
      title: "Archive document?",
      message: `${doc.number} from ${doc.contact} will be archived and won't be posted to your accounting software.`,
      confirmLabel: beLabel("Archive"),
    });
    if (!ok) return;
    notifyBackendPending("Archive");
    remove(doc.id);
  };

  const columns: DataTableColumn<PendingDocument>[] = [
    { key: "number", header: "Document", width: "18%", render: (d) => <span className="font-semibold">{d.number}</span> },
    { key: "type", header: "Type", width: "16%", render: (d) => <Badge variant="neutral">{TYPE_LABEL[d.type]}</Badge> },
    { key: "contact", header: "Contact", render: (d) => <span className="block truncate">{d.contact}</span> },
    { key: "date", header: "Date", width: "16%", render: (d) => date(d.date) },
    { key: "amount", header: "Amount", width: "14%", align: "right", render: (d) => money(d.amount) },
    {
      key: "actions",
      header: "",
      width: "220px",
      align: "right",
      render: (d) => (
        <div className="flex justify-end gap-[var(--space-xs)]">
          <Button size="sm" variant="outline" onClick={() => handleArchive(d)}>
            {beLabel("Archive")}
          </Button>
          <Button size="sm" onClick={() => handlePost(d)}>
            {beLabel("Post")}
          </Button>
        </div>
      ),
    },
  ];

  if (paper.documents.length === 0) {
    return (
      <EmptyState
        tone="primary"
        icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
        title="Nothing left to post"
        description={`Every invoice, expense claim and credit note dated on or before ${date(paper.periodEnd)} is in ${provider.name}.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-sm)]">
      <p className="text-body-sm text-content-secondary">
        {paper.documents.length} document{paper.documents.length === 1 ? "" : "s"} dated on or before {date(paper.periodEnd)} not yet
        posted to {provider.name}. Post or archive each one.
      </p>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={paper.documents} getRowKey={(d) => d.id} />
      </div>
      {/* Phone layout: stacked cards instead of a cramped six-column table. */}
      <div className="flex flex-col gap-[var(--space-sm)] md:hidden">
        {paper.documents.map((d) => (
          <div key={d.id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
            <div className="flex items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="font-semibold text-content-primary">{d.number}</p>
                <p className="truncate text-caption text-content-secondary">
                  {d.contact} · {date(d.date)}
                </p>
              </div>
              <span className="text-body-sm font-semibold text-content-primary">{money(d.amount)}</span>
            </div>
            <div className="mt-[var(--space-sm)] flex items-center justify-between gap-[var(--space-sm)]">
              <Badge variant="neutral">{TYPE_LABEL[d.type]}</Badge>
              <div className="flex gap-[var(--space-xs)]">
                <Button size="sm" variant="outline" onClick={() => handleArchive(d)}>
                  {beLabel("Archive")}
                </Button>
                <Button size="sm" onClick={() => handlePost(d)}>
                  {beLabel("Post")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
