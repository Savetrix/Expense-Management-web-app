"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";
import { useAppDispatch } from "@/store/hooks";
import { setSelectedInvoice, type InvoiceRecord } from "@/store/invoice/invoiceSlice";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { date, money } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

interface Props extends CloseSectionProps {
  /** Real pending invoices dated on or before the period end. */
  invoices: InvoiceRecord[];
  loading: boolean;
  loadFailed: boolean;
}

const numberOf = (inv: InvoiceRecord) => inv.extractedData?.invoiceNumber || inv.file?.originalName || "Invoice";
const contactOf = (inv: InvoiceRecord) => inv.extractedData?.vendorName || "Unknown vendor";
export const invoiceDateOf = (inv: InvoiceRecord) => {
  const d = inv.extractedData?.invoiceDate;
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : (inv.createdAt ?? "").slice(0, 10);
};

// Section 1 — every pending invoice dated on or before period end must be
// posted (reviewed) or archived before the period can close. The list comes
// from the invoices already loaded for this company.
export function PendingInvoicesSection({ paper, invoices, loading, loadFailed }: Props) {
  const provider = useActiveProvider();
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Posting happens on the invoice's own review screen.
  const handlePost = (inv: InvoiceRecord) => {
    dispatch(setSelectedInvoice(inv));
    router.push(`/invoices/${inv._id}/review`);
  };

  const handleArchive = async (inv: InvoiceRecord) => {
    const ok = await confirmDialog({
      title: "Archive invoice?",
      message: `${numberOf(inv)} from ${contactOf(inv)} will be archived and won't be posted to ${provider.name}.`,
      confirmLabel: beLabel("Archive"),
    });
    if (!ok) return;
    notifyBackendPending("Archive");
  };

  const columns: DataTableColumn<InvoiceRecord>[] = [
    { key: "number", header: "Invoice", width: "20%", render: (d) => <span className="block truncate font-semibold">{numberOf(d)}</span> },
    { key: "contact", header: "Vendor", render: (d) => <span className="block truncate">{contactOf(d)}</span> },
    { key: "date", header: "Date", width: "16%", render: (d) => date(invoiceDateOf(d)) },
    { key: "amount", header: "Amount", width: "14%", align: "right", render: (d) => money(d.extractedData?.totalAmount ?? 0) },
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
            Review &amp; post
          </Button>
        </div>
      ),
    },
  ];

  if (loading) return <p className="text-body-sm text-content-secondary">Loading invoices…</p>;

  if (loadFailed) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
        title="Couldn't load invoices"
        description="Pending invoices couldn't be loaded, so this step can't be checked yet. Reload the page to try again."
      />
    );
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        tone="primary"
        icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
        title="Nothing left to post"
        description={`No pending invoices dated on or before ${date(paper.periodEnd)}.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-sm)]">
      <p className="text-body-sm text-content-secondary">
        {invoices.length} pending invoice{invoices.length === 1 ? "" : "s"} dated on or before {date(paper.periodEnd)} not yet posted to{" "}
        {provider.name}. Review and post, or archive, each one.
      </p>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={invoices} getRowKey={(d) => d._id} />
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] md:hidden">
        {invoices.map((d) => (
          <div key={d._id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
            <div className="flex items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="truncate font-semibold text-content-primary">{numberOf(d)}</p>
                <p className="truncate text-caption text-content-secondary">
                  {contactOf(d)} · {date(invoiceDateOf(d))}
                </p>
              </div>
              <span className="text-body-sm font-semibold text-content-primary">{money(d.extractedData?.totalAmount ?? 0)}</span>
            </div>
            <div className="mt-[var(--space-sm)] flex items-center justify-end gap-[var(--space-xs)]">
              <Button size="sm" variant="outline" onClick={() => handleArchive(d)}>
                {beLabel("Archive")}
              </Button>
              <Button size="sm" onClick={() => handlePost(d)}>
                Review &amp; post
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
