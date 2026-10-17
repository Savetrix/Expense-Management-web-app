"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";

import type { AgedContact } from "./mockData";
import { ContactReviewModal, FLAG_REASON } from "./ContactReviewModal";
import { money, signOffText } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

type Side = "payables" | "receivables";

const contactTotal = (c: AgedContact) => c.current + c.d30 + c.d60 + c.d90;

// Section 3 — aged payables and receivables by contact. Contacts with items
// more than 3 months overdue or a negative balance are flagged and must be
// resolved before each side can be reconciled.
export function PayablesReceivablesSection({ paper, onUpdate, actor }: CloseSectionProps) {
  const [side, setSide] = useState<Side>("payables");
  const [reviewId, setReviewId] = useState<string | null>(null);

  const rows = side === "payables" ? paper.payables : paper.receivables;
  const reconciled = side === "payables" ? paper.payablesReconciled : paper.receivablesReconciled;
  const openFlags = rows.filter((c) => c.flag && !c.resolution).length;
  const sideLabel = side === "payables" ? "payables" : "receivables";
  const reviewing = rows.find((c) => c.id === reviewId) ?? null;

  const unresolved = (list: AgedContact[]) => list.filter((c) => c.flag && !c.resolution).length;

  const handleResolve = (contactId: string, note: string, attachmentName?: string) => {
    notifyBackendPending("Resolve flag");
    const resolution = { by: actor, at: new Date().toISOString(), note, attachmentName };
    const apply = (list: AgedContact[]) => list.map((c) => (c.id === contactId ? { ...c, resolution } : c));
    onUpdate((wp) => (side === "payables" ? { ...wp, payables: apply(wp.payables) } : { ...wp, receivables: apply(wp.receivables) }));
    setReviewId(null);
  };

  const handleReconcile = () => {
    const label = side === "payables" ? "Reconcile payables" : "Reconcile receivables";
    notifyBackendPending(label);
    const signOff = { by: actor, at: new Date().toISOString() };
    onUpdate((wp) => ({ ...wp, ...(side === "payables" ? { payablesReconciled: signOff } : { receivablesReconciled: signOff }) }));
    showToast(`Trade ${sideLabel} reconciled.`, "success");
  };

  const totals = rows.reduce(
    (acc, c) => ({ current: acc.current + c.current, d30: acc.d30 + c.d30, d60: acc.d60 + c.d60, d90: acc.d90 + c.d90 }),
    { current: 0, d30: 0, d60: 0, d90: 0 },
  );

  const columns: DataTableColumn<AgedContact>[] = [
    {
      key: "contact",
      header: "Contact",
      width: "26%",
      render: (c) => (
        <div className="flex min-w-0 flex-col items-start gap-[var(--space-xs)]">
          <span className="block w-full truncate font-semibold">{c.contact}</span>
          {c.flag && (c.resolution ? <Badge variant="success">Resolved</Badge> : <Badge variant="error" title={FLAG_REASON[c.flag]}>Flag</Badge>)}
        </div>
      ),
    },
    { key: "current", header: "Current", align: "right", render: (c) => money(c.current) },
    { key: "d30", header: "30 days", align: "right", render: (c) => money(c.d30) },
    { key: "d60", header: "60 days", align: "right", render: (c) => money(c.d60) },
    { key: "d90", header: "90+ days", align: "right", render: (c) => money(c.d90) },
    { key: "total", header: "Total", align: "right", render: (c) => <span className="font-semibold">{money(contactTotal(c))}</span> },
    {
      key: "actions",
      header: "",
      width: "110px",
      align: "right",
      render: (c) => (
        <Button size="sm" variant="outline" onClick={() => setReviewId(c.id)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          items={[
            { value: "payables", label: "Trade payables", count: unresolved(paper.payables) || undefined },
            { value: "receivables", label: "Trade receivables", count: unresolved(paper.receivables) || undefined },
          ]}
          value={side}
          onChange={(v) => {
            setSide(v as Side);
            setReviewId(null);
          }}
        />
        {reconciled ? (
          <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
            <Badge variant="success">Reconciled</Badge>
            <span className="text-caption text-content-secondary">{signOffText("Reconciled", reconciled)}</span>
          </div>
        ) : (
          <Button size="sm" onClick={handleReconcile} disabled={openFlags > 0}>
            {beLabel(side === "payables" ? "Reconcile payables" : "Reconcile receivables")}
          </Button>
        )}
      </div>

      {!reconciled && (
        <p className="text-body-sm text-content-secondary">
          {openFlags > 0
            ? `${openFlags} flagged contact${openFlags === 1 ? "" : "s"} to review before you can reconcile ${sideLabel}. Flags are raised for items more than 3 months overdue or a negative balance.`
            : `No open flags. Check the aged balances below, then reconcile ${sideLabel}.`}
        </p>
      )}

      <div className="hidden lg:block">
        <DataTable columns={columns} rows={rows} getRowKey={(c) => c.id} />
        <div className="flex justify-end gap-[var(--space-lg)] px-[var(--space-sm)] pt-[var(--space-sm)] text-caption text-content-secondary">
          <span>Current {money(totals.current)}</span>
          <span>30 days {money(totals.d30)}</span>
          <span>60 days {money(totals.d60)}</span>
          <span>90+ days {money(totals.d90)}</span>
          <span className="font-bold text-content-primary">Total {money(totals.current + totals.d30 + totals.d60 + totals.d90)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-[var(--space-sm)] lg:hidden">
        {rows.map((c) => (
          <div key={c.id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
            <div className="flex items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="truncate font-semibold text-content-primary">{c.contact}</p>
                {c.flag && (
                  <div className="mt-[var(--space-xs)]">
                    {c.resolution ? <Badge variant="success">Resolved</Badge> : <Badge variant="error">Flag</Badge>}
                  </div>
                )}
              </div>
              <span className="text-body-sm font-bold text-content-primary">{money(contactTotal(c))}</span>
            </div>
            <dl className="mt-[var(--space-sm)] grid grid-cols-2 gap-x-[var(--space-md)] gap-y-[var(--space-xs)] text-caption sm:grid-cols-4">
              {(
                [
                  ["Current", c.current],
                  ["30 days", c.d30],
                  ["60 days", c.d60],
                  ["90+ days", c.d90],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-[var(--space-xs)]">
                  <dt className="text-content-secondary">{label}</dt>
                  <dd className="font-semibold text-content-primary">{money(value)}</dd>
                </div>
              ))}
            </dl>
            <Button size="sm" variant="outline" className="mt-[var(--space-sm)] w-full" onClick={() => setReviewId(c.id)}>
              Review
            </Button>
          </div>
        ))}
      </div>

      <ContactReviewModal contact={reviewing} onClose={() => setReviewId(null)} onResolve={handleResolve} />
    </div>
  );
}
