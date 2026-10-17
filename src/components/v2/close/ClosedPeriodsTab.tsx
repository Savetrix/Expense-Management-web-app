"use client";

import { useState } from "react";
import { Archive } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { CompactListRow, DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

import type { WorkingPaper } from "./mockData";
import { date, dateTime } from "./closeShared";
import { WorkingPaperModal } from "./WorkingPaperModal";

interface ClosedPeriodsTabProps {
  periods: WorkingPaper[];
  hasOpenClose: boolean;
  canManage: boolean;
  onExport: (paper: WorkingPaper) => void;
  onReopen: (paper: WorkingPaper) => void;
}

export function ClosedPeriodsTab({ periods, hasOpenClose, canManage, onExport, onReopen }: ClosedPeriodsTabProps) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = periods.find((p) => p.id === viewingId) ?? null;

  if (periods.length === 0) {
    return (
      <EmptyState
        icon={<Archive size={28} strokeWidth={1.75} />}
        title="No closed periods yet"
        description="When you close a period, its working paper is locked and kept here as a read-only snapshot you can export."
      />
    );
  }

  const columns: DataTableColumn<WorkingPaper>[] = [
    { key: "period", header: "Period", render: (p) => <span className="block truncate font-semibold">{p.name}</span> },
    { key: "dates", header: "Dates", width: "28%", render: (p) => `${date(p.periodStart)} – ${date(p.periodEnd)}` },
    { key: "closedBy", header: "Closed by", width: "18%", render: (p) => <span className="block truncate">{p.closedBy ?? "—"}</span> },
    { key: "closedAt", header: "Closed on", width: "22%", render: (p) => dateTime(p.closedAt) },
  ];

  return (
    <>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={periods} getRowKey={(p) => p.id} onRowClick={(p) => setViewingId(p.id)} bordered={false} maxHeightClassName="max-h-[560px]" />
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)] md:hidden">
        {periods.map((p) => (
          <CompactListRow
            key={p.id}
            title={p.name}
            meta={`Closed by ${p.closedBy ?? "—"} · ${date(p.closedAt)}`}
            onClick={() => setViewingId(p.id)}
          />
        ))}
      </div>
      <WorkingPaperModal
        paper={viewing}
        hasOpenClose={hasOpenClose}
        canManage={canManage}
        onClose={() => setViewingId(null)}
        onExport={onExport}
        onReopen={(p) => {
          setViewingId(null);
          onReopen(p);
        }}
      />
    </>
  );
}
