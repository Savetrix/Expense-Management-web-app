"use client";

import { useRouter } from "next/navigation";
import { CheckCheck, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";
import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import { useAppSelector } from "@/store/hooks";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";
import { CompactListRow, DataTable, PageHeader, SearchInput, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

import { DecisionTrailModal, formatShortDate } from "./DecisionTrailModal";
import { toAutopilotDocument } from "./documents";
import { MemoriesPanel } from "./MemoriesPanel";
import { OverviewPanel } from "./OverviewPanel";
import { UsagePanel } from "./UsagePanel";
import type { AiMemory, AutopilotDocument } from "./types";
import { useEnsureInvoices } from "./useEnsureInvoices";

type AutopilotTab = "overview" | "review" | "published" | "memories" | "usage";
type PublishedFilter = "all" | "autopilot" | "people";

export function AutopilotContentV2() {
  const router = useRouter();
  const provider = useActiveProvider();
  useEnsureInvoices();
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const accounts = useAppSelector((state) => state.quickBooks.accounts);
  const { invoices, pendingInvoices, autoPostedInvoices, manualPostedInvoices, loading: invoicesLoading } = useAppSelector(
    (state) => state.invoice,
  );
  const activeConnection = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const companyName = activeConnection?.name || "this company";

  const [activeTab, setActiveTab] = useState<AutopilotTab>("overview");
  const [enabled, setEnabled] = useState(true);
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [publishedFilter, setPublishedFilter] = useState<PublishedFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<{ doc: AutopilotDocument; mode: "review" | "published" } | null>(null);

  const loading = invoicesLoading && invoices.length === 0;

  const needsReview = useMemo(
    () => pendingInvoices.map((inv) => toAutopilotDocument(inv, accounts)),
    [pendingInvoices, accounts],
  );
  const published = useMemo(
    () => [
      ...autoPostedInvoices.map((inv) => toAutopilotDocument(inv, accounts, "autopilot")),
      ...manualPostedInvoices.map((inv) => toAutopilotDocument(inv, accounts, "person")),
    ].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    [autoPostedInvoices, manualPostedInvoices, accounts],
  );

  const stats = useMemo(() => {
    const publishedCount = autoPostedInvoices.length + manualPostedInvoices.length;
    return {
      processed: invoices.length,
      autopublished: autoPostedInvoices.length,
      rate: publishedCount > 0 ? Math.round((autoPostedInvoices.length / publishedCount) * 100) : null,
      waiting: pendingInvoices.length,
    };
  }, [invoices.length, autoPostedInvoices.length, manualPostedInvoices.length, pendingInvoices.length]);

  const matchesSearch = (doc: AutopilotDocument) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return doc.vendor.toLowerCase().includes(q) || doc.reference.toLowerCase().includes(q) || (doc.glAccount ?? "").toLowerCase().includes(q);
  };

  const filteredReview = needsReview.filter(matchesSearch);
  const filteredPublished = published
    .filter((d) => publishedFilter === "all" || (publishedFilter === "autopilot" ? d.publishedBy === "autopilot" : d.publishedBy === "person"))
    .filter(matchesSearch);

  // Approve, archive and undo need Autopilot endpoints; until then they only
  // tell the user so and leave the real invoice untouched.
  const handleBackendAction = (label: string) => {
    notifyBackendPending(label);
    setSelected(null);
  };

  const handleUndo = async (doc: AutopilotDocument) => {
    const confirmed = await confirmDialog({
      title: "Undo this publish?",
      message: `${doc.reference} will be removed from ${provider.name} and moved back to Needs review.`,
      confirmLabel: beLabel("Undo publish"),
      tone: "destructive",
    });
    if (!confirmed) return;
    handleBackendAction("Undo publish");
  };

  const publishedColumns: DataTableColumn<AutopilotDocument>[] = [
    {
      key: "date",
      header: "Date",
      width: "15%",
      render: (d) => <span className="block truncate py-[var(--space-sm)] text-content-secondary">{formatShortDate(d.publishedAt ?? d.date)}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      width: "28%",
      render: (d) => (
        <div className="min-w-0">
          <span className="block truncate font-bold text-content-primary">{d.vendor}</span>
          <span className="block truncate text-content-secondary">{d.reference}</span>
        </div>
      ),
    },
    { key: "gl", header: "GL account", width: "22%", render: (d) => <span className="block truncate text-content-secondary">{d.glAccount ?? "—"}</span> },
    {
      key: "total",
      header: "Total",
      width: "17%",
      align: "right",
      render: (d) => <span className="font-bold text-content-primary">{formatDetailAmount(d.total, d.currency)}</span>,
    },
    {
      key: "by",
      header: "Published by",
      width: "18%",
      align: "right",
      render: (d) =>
        d.publishedBy === "autopilot" ? (
          <Badge variant="success">
            <Zap size={12} strokeWidth={2.5} className="mr-1" />
            Autopilot
          </Badge>
        ) : (
          <Badge variant="neutral">{d.publishedByName ?? "You"}</Badge>
        ),
    },
  ];

  const tabCountFor = (filter: PublishedFilter) =>
    filter === "all" ? published.length : published.filter((d) => (filter === "autopilot" ? d.publishedBy === "autopilot" : d.publishedBy === "person")).length;

  const showSearch = activeTab === "review" || activeTab === "published";

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader title="Autopilot" subtitle={`Publish routine documents for ${companyName} to ${provider.name} automatically, with a clear reason for everything else.`} />

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center">
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={[
                { value: "overview", label: "Overview" },
                { value: "review", label: "Needs review", count: needsReview.length },
                { value: "published", label: "Autopublished", count: published.length },
                { value: "memories", label: "AI memories", count: memories.length },
                { value: "usage", label: "Usage" },
              ]}
              value={activeTab}
              onChange={(v) => {
                setActiveTab(v as AutopilotTab);
                setSearchText("");
              }}
            />
          </div>
          {showSearch && (
            <SearchInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search vendor, reference or account…"
              widthClassName="w-full lg:w-80"
            />
          )}
        </div>

        {loading ? (
          <div className="p-[var(--space-md)]">
            <SkeletonListRows count={4} />
          </div>
        ) : activeTab === "overview" ? (
          <OverviewPanel
            companyName={companyName}
            providerName={provider.name}
            enabled={enabled}
            onEnabledChange={setEnabled}
            stats={stats}
            onShowWaiting={() => setActiveTab("review")}
          />
        ) : activeTab === "review" ? (
          needsReview.length === 0 ? (
            <EmptyState
              icon={<CheckCheck size={28} strokeWidth={1.75} />}
              title="Nothing needs you right now"
              description="Every document passed its checks or has already been reviewed. New exceptions will show up here with the reason."
              tone="primary"
            />
          ) : filteredReview.length === 0 ? (
            <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No documents match &quot;{searchText}&quot;.</div>
          ) : (
            <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
              {!enabled && (
                <p className="text-caption text-content-secondary">Autopilot is off, so every new document waits here for review.</p>
              )}
              {filteredReview.map((doc) => {
                return (
                  <CompactListRow
                    key={doc.id}
                    title={
                      <>
                        {doc.vendor} <span className="font-normal text-content-secondary">· {doc.reference} · {formatDetailAmount(doc.total, doc.currency)}</span>
                      </>
                    }
                    meta="Reason available once Autopilot is connected (BE)"
                    onClick={() => setSelected({ doc, mode: "review" })}
                  />
                );
              })}
            </div>
          )
        ) : activeTab === "published" ? (
          <>
            <div className="border-b border-border p-[var(--space-md)]">
              <Tabs
                items={[
                  { value: "all", label: "All", count: tabCountFor("all") },
                  { value: "autopilot", label: "Autopilot", count: tabCountFor("autopilot") },
                  { value: "people", label: "People", count: tabCountFor("people") },
                ]}
                value={publishedFilter}
                onChange={(v) => setPublishedFilter(v as PublishedFilter)}
              />
            </div>
            {filteredPublished.length === 0 ? (
              <EmptyState
                icon={<Zap size={28} strokeWidth={1.75} />}
                title={searchText ? "No matches" : "Nothing published yet"}
                description={
                  searchText
                    ? `No published documents match "${searchText}".`
                    : "Documents published by Autopilot or by your team will be listed here."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <DataTable
                    columns={publishedColumns}
                    rows={filteredPublished}
                    getRowKey={(d) => d.id}
                    onRowClick={(doc) => setSelected({ doc, mode: "published" })}
                    bordered={false}
                    maxHeightClassName="max-h-[560px]"
                  />
                </div>
              </div>
            )}
          </>
        ) : activeTab === "memories" ? (
          <MemoriesPanel memories={memories} onChange={setMemories} />
        ) : (
          <UsagePanel />
        )}
      </div>

      <DecisionTrailModal
        document={selected?.doc ?? null}
        mode={selected?.mode ?? "review"}
        busyAction={null}
        onClose={() => setSelected(null)}
        onApprove={() => handleBackendAction("Approve & publish")}
        onArchive={() => handleBackendAction("Archive")}
        onOpenInvoice={(doc) => router.push(`/invoices/${doc.id}`)}
        onUndoPublish={handleUndo}
      />
    </div>
  );
}
