"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { PendingAdjustment } from "./mockData";
import { date, money } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

const KIND_LABEL: Record<PendingAdjustment["kind"], string> = {
  prepayment: "Prepayment",
  deferred_income: "Deferred income",
  fixed_asset: "Fixed asset",
  accrual: "Accrual",
};

// Section 2 — schedule-driven journals (prepayment releases, deferred income,
// depreciation, accruals) for the period that haven't been posted yet.
export function PendingAdjustmentsSection({ paper, onUpdate }: CloseSectionProps) {
  const router = useRouter();
  const provider = useActiveProvider();
  const pending = paper.adjustments;

  const handlePost = (adj: PendingAdjustment) => {
    notifyBackendPending("Post adjustment");
    onUpdate((wp) => ({ ...wp, adjustments: wp.adjustments.filter((a) => a.id !== adj.id) }));
    showToast(`${KIND_LABEL[adj.kind]} journal posted to ${provider.name}.`, "success");
  };

  const handlePostAll = async () => {
    const ok = await confirmDialog({
      title: `Post ${pending.length} adjustments?`,
      message: `Each adjustment is posted as a journal to ${provider.name}, dated ${date(paper.periodEnd)}.`,
      confirmLabel: beLabel("Post all"),
    });
    if (!ok) return;
    notifyBackendPending("Post all adjustments");
    onUpdate((wp) => ({ ...wp, adjustments: [] }));
  };

  const openAdjustments = () => router.push("/month-end");

  const columns: DataTableColumn<PendingAdjustment>[] = [
    { key: "kind", header: "Type", width: "18%", render: (a) => <Badge variant="neutral">{KIND_LABEL[a.kind]}</Badge> },
    { key: "description", header: "Description", render: (a) => <span className="block truncate">{a.description}</span> },
    { key: "account", header: "Account", width: "20%", render: (a) => <span className="block truncate">{a.account}</span> },
    { key: "date", header: "Date", width: "14%", render: (a) => date(a.date) },
    { key: "amount", header: "Amount", width: "13%", align: "right", render: (a) => money(a.amount) },
    {
      key: "actions",
      header: "",
      width: "120px",
      align: "right",
      render: (a) => (
        <Button size="sm" onClick={() => handlePost(a)}>
          {beLabel("Post")}
        </Button>
      ),
    },
  ];

  const link = (
    <button
      type="button"
      onClick={openAdjustments}
      className="inline-flex items-center gap-[var(--space-xs)] text-body-sm font-semibold text-accent hover:underline"
    >
      Open Month-End Adjustments
      <ExternalLink size={14} strokeWidth={2.25} />
    </button>
  );

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState
          tone="primary"
          icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
          title="All adjustments posted"
          description="Prepayments, deferred income, depreciation and accruals for this period are up to date."
        />
        {link}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-sm)]">
      <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-content-secondary">
          {pending.length} scheduled adjustment{pending.length === 1 ? "" : "s"} for this period not yet posted. Edit schedules in{" "}
          Month-End Adjustments.
        </p>
        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          {link}
          <Button size="sm" onClick={handlePostAll}>
            {beLabel("Post all")}
          </Button>
        </div>
      </div>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pending} getRowKey={(a) => a.id} />
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] md:hidden">
        {pending.map((a) => (
          <div key={a.id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
            <div className="flex items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="font-semibold text-content-primary">{a.description}</p>
                <p className="truncate text-caption text-content-secondary">
                  {a.account} · {date(a.date)}
                </p>
              </div>
              <span className="text-body-sm font-semibold text-content-primary">{money(a.amount)}</span>
            </div>
            <div className="mt-[var(--space-sm)] flex items-center justify-between">
              <Badge variant="neutral">{KIND_LABEL[a.kind]}</Badge>
              <Button size="sm" onClick={() => handlePost(a)}>
                {beLabel("Post")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
