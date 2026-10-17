"use client";

import { Archive, Copy, FileStack, FileX2, Merge, Scissors } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { DataTable, PageHeader, RoleInfoBanner, SearchInput, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

import { ArchivedDocumentModal, formatReceived } from "./ArchivedDocumentModal";
import { MergeDocumentsModal } from "./MergeDocumentsModal";
import {
  ARCHIVE_REASON_LABELS,
  ARCHIVED_DOCUMENTS,
  UNPOSTED_INVOICES,
  type ArchiveReason,
  type ArchivedDocument,
  type UnpostedInvoice,
} from "./mockData";

type ArchiveTab = "all" | ArchiveReason;

const MOCK_LATENCY_MS = 450;

const TAB_ORDER: { value: ArchiveTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "duplicate", label: "Duplicates" },
  { value: "notTransaction", label: "Not a transaction" },
  { value: "merged", label: "Merged" },
  { value: "splitOriginal", label: "Split originals" },
];

const EMPTY_COPY: Record<ArchiveTab, { icon: ReactNode; title: string; description: string }> = {
  all: {
    icon: <Archive size={28} strokeWidth={1.75} />,
    title: "Archive is empty",
    description: "Duplicates, non-financial documents and merged or split originals are moved here automatically.",
  },
  duplicate: {
    icon: <Copy size={28} strokeWidth={1.75} />,
    title: "No duplicates",
    description: "When a document matches one already in Scantrix on vendor, amount, date and reference, it lands here instead of being posted twice.",
  },
  notTransaction: {
    icon: <FileX2 size={28} strokeWidth={1.75} />,
    title: "Nothing filtered out",
    description: "Newsletters, delivery notes and other documents without a transaction will show up here.",
  },
  merged: {
    icon: <Merge size={28} strokeWidth={1.75} />,
    title: "No merged documents",
    description: "Documents you merge into another one are kept here with a reference to the primary.",
  },
  splitOriginal: {
    icon: <Scissors size={28} strokeWidth={1.75} />,
    title: "No split originals",
    description: "When one file contains several invoices, the original file is kept here after it's split.",
  },
};

const REASON_VARIANT: Record<ArchiveReason, "warning" | "neutral" | "success"> = {
  duplicate: "warning",
  notTransaction: "neutral",
  merged: "success",
  splitOriginal: "neutral",
};

export function ArchiveContentV2() {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<ArchivedDocument[]>(ARCHIVED_DOCUMENTS);
  const [unposted, setUnposted] = useState<UnpostedInvoice[]>(UNPOSTED_INVOICES);
  const [activeTab, setActiveTab] = useState<ArchiveTab>("all");
  const [searchText, setSearchText] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [openDoc, setOpenDoc] = useState<ArchivedDocument | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"unarchive" | "delete" | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), MOCK_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const counts = useMemo(() => {
    const base: Record<ArchiveTab, number> = { all: documents.length, duplicate: 0, notTransaction: 0, merged: 0, splitOriginal: 0 };
    documents.forEach((d) => {
      base[d.reason] += 1;
    });
    return base;
  }, [documents]);

  const tabRows = activeTab === "all" ? documents : documents.filter((d) => d.reason === activeTab);
  const visibleRows = tabRows.filter((d) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return [d.fileName, d.vendor ?? "", d.reasonText].some((v) => v.toLowerCase().includes(q));
  });

  const removeDocs = (ids: string[]) => {
    setDocuments((list) => list.filter((d) => !ids.includes(d.id)));
    setSelectedKeys((keys) => {
      const next = new Set(keys);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const changeTab = (tab: ArchiveTab) => {
    setActiveTab(tab);
    setSelectedKeys(new Set());
  };

  const toggleRow = (doc: ArchivedDocument) =>
    setSelectedKeys((keys) => {
      const next = new Set(keys);
      if (next.has(doc.id)) next.delete(doc.id);
      else next.add(doc.id);
      return next;
    });

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((d) => selectedKeys.has(d.id));
  const toggleAllVisible = () =>
    setSelectedKeys(allVisibleSelected ? new Set() : new Set(visibleRows.map((d) => d.id)));

  const handleUnarchive = async (doc: ArchivedDocument, { notDuplicate }: { notDuplicate: boolean }) => {
    if (!notDuplicate) {
      const confirmed = await confirmDialog({
        title: "Unarchive this document?",
        message: "It will go back to your inbox and be processed again, including the duplicate check.",
        confirmLabel: beLabel("Unarchive"),
      });
      if (!confirmed) return;
    }
    setBusyAction("unarchive");
    notifyBackendPending(notDuplicate ? "Not a duplicate — unarchive" : "Unarchive");
    window.setTimeout(() => {
      removeDocs([doc.id]);
      setBusyAction(null);
      setOpenDoc(null);
      showToast(
        notDuplicate ? `${doc.fileName} marked as not a duplicate and sent back for processing.` : `${doc.fileName} unarchived and queued for processing.`,
        "success",
      );
    }, MOCK_LATENCY_MS);
  };

  const handleDelete = async (doc: ArchivedDocument) => {
    const confirmed = await confirmDialog({
      title: "Delete permanently?",
      message: `${doc.fileName} and its original file will be removed for good. This can't be undone.`,
      confirmLabel: beLabel("Delete permanently"),
      tone: "destructive",
    });
    if (!confirmed) return;
    notifyBackendPending("Delete permanently");
    removeDocs([doc.id]);
    setOpenDoc(null);
    showToast(`${doc.fileName} deleted.`, "neutral");
  };

  const handleDownload = () => {
    setBusyAction("download");
    notifyBackendPending("Download original");
    window.setTimeout(() => setBusyAction(null), MOCK_LATENCY_MS);
  };

  const handleBulkUnarchive = async () => {
    const ids = [...selectedKeys];
    const confirmed = await confirmDialog({
      title: `Unarchive ${ids.length} ${ids.length === 1 ? "document" : "documents"}?`,
      message: "They'll go back to your inbox and be processed again, including the duplicate check.",
      confirmLabel: beLabel("Unarchive"),
    });
    if (!confirmed) return;
    setBulkBusy("unarchive");
    notifyBackendPending("Unarchive selected");
    window.setTimeout(() => {
      removeDocs(ids);
      setBulkBusy(null);
      showToast(`${ids.length} ${ids.length === 1 ? "document" : "documents"} unarchived.`, "success");
    }, MOCK_LATENCY_MS);
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedKeys];
    const confirmed = await confirmDialog({
      title: `Delete ${ids.length} ${ids.length === 1 ? "document" : "documents"} permanently?`,
      message: "The documents and their original files will be removed for good. This can't be undone.",
      confirmLabel: beLabel("Delete permanently"),
      tone: "destructive",
    });
    if (!confirmed) return;
    setBulkBusy("delete");
    notifyBackendPending("Delete selected");
    window.setTimeout(() => {
      removeDocs(ids);
      setBulkBusy(null);
      showToast(`${ids.length} ${ids.length === 1 ? "document" : "documents"} deleted.`, "neutral");
    }, MOCK_LATENCY_MS);
  };

  const handleMerged = (primary: UnpostedInvoice, merged: UnpostedInvoice[]) => {
    const mergedIds = merged.map((m) => m.id);
    setUnposted((list) => list.filter((i) => !mergedIds.includes(i.id)));
    const now = new Date().toISOString();
    setDocuments((list) => [
      ...merged.map<ArchivedDocument>((m) => ({
        id: `ar-merged-${m.id}`,
        fileName: m.fileName,
        vendor: m.vendor,
        receivedAt: now,
        source: "Upload",
        reason: "merged",
        reasonText: `Merged into ${primary.reference}`,
      })),
      ...list,
    ]);
    showToast(`Merged into ${primary.reference}.`, "success");
  };

  const columns: DataTableColumn<ArchivedDocument>[] = [
    {
      key: "document",
      header: "Document",
      width: "28%",
      render: (d) => (
        <div className="min-w-0 py-[var(--space-xs)]">
          <span className="block truncate font-bold text-content-primary" title={d.fileName}>
            {d.fileName}
          </span>
          <span className="block truncate text-content-secondary">{d.vendor ?? "Unknown sender"}</span>
        </div>
      ),
    },
    { key: "received", header: "Received", width: "14%", render: (d) => <span className="block truncate text-content-secondary">{formatReceived(d.receivedAt)}</span> },
    { key: "source", header: "Source", width: "12%", render: (d) => <Badge variant="neutral">{d.source}</Badge> },
    {
      key: "reason",
      header: "Why it's archived",
      width: "46%",
      render: (d) => (
        <div className="flex min-w-0 flex-col items-start gap-[var(--space-xs)]">
          <Badge variant={REASON_VARIANT[d.reason]}>{ARCHIVE_REASON_LABELS[d.reason]}</Badge>
          <span className="line-clamp-2 text-content-secondary">{d.reasonText}</span>
        </div>
      ),
    },
  ];

  const selectedCount = selectedKeys.size;
  const empty = EMPTY_COPY[activeTab];

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Archive & Duplicates"
        subtitle="Duplicates, non-financial documents and merged or split originals — kept out of your books, but never lost."
        action={
          <Button size="sm" onClick={() => setMergeOpen(true)} className="shrink-0">
            <FileStack size={16} strokeWidth={2.25} />
            Merge documents
          </Button>
        }
      />

      <div className="mt-[var(--space-md)]">
        <RoleInfoBanner>
          Duplicate checks only compare documents processed by Scantrix. Bills entered in your accounting software before Scantrix
          was connected aren&apos;t checked.
        </RoleInfoBanner>
      </div>

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center">
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={TAB_ORDER.map((t) => ({ ...t, count: counts[t.value] }))}
              value={activeTab}
              onChange={(v) => changeTab(v as ArchiveTab)}
            />
          </div>
          {tabRows.length > 0 && (
            <SearchInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search file, vendor or reason…"
              widthClassName="w-full lg:w-80"
            />
          )}
        </div>

        {visibleRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-[var(--space-sm)] border-b border-border px-[var(--space-md)] py-[var(--space-sm)]">
            <label className="flex items-center gap-[var(--space-xs)] text-caption font-semibold text-content-secondary">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="rounded border-border-strong text-accent focus:ring-accent"
              />
              {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
            </label>
            {selectedCount > 0 && (
              <div className="ml-auto flex flex-wrap gap-[var(--space-sm)]">
                <Button variant="outline" size="sm" onClick={() => setSelectedKeys(new Set())} disabled={bulkBusy !== null}>
                  Clear
                </Button>
                <Button variant="outline" size="sm" onClick={handleBulkUnarchive} loading={bulkBusy === "unarchive"} disabled={bulkBusy !== null}>
                  {beLabel("Unarchive selected")}
                </Button>
                <Button variant="danger" size="sm" onClick={handleBulkDelete} loading={bulkBusy === "delete"} disabled={bulkBusy !== null}>
                  {beLabel("Delete selected")}
                </Button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="p-[var(--space-md)]">
            <SkeletonListRows count={4} />
          </div>
        ) : tabRows.length === 0 ? (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            actionLabel={activeTab === "merged" ? "Merge documents" : undefined}
            onAction={activeTab === "merged" ? () => setMergeOpen(true) : undefined}
          />
        ) : visibleRows.length === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No archived documents match &quot;{searchText}&quot;.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <DataTable
                columns={columns}
                rows={visibleRows}
                getRowKey={(d) => d.id}
                onRowClick={setOpenDoc}
                selectedKeys={selectedKeys}
                onToggleRow={toggleRow}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        )}
      </div>

      <ArchivedDocumentModal
        document={openDoc}
        busyAction={busyAction}
        onClose={() => setOpenDoc(null)}
        onUnarchive={handleUnarchive}
        onDelete={handleDelete}
        onDownload={handleDownload}
      />

      <MergeDocumentsModal
        open={mergeOpen}
        invoices={unposted}
        onClose={() => setMergeOpen(false)}
        onMerged={handleMerged}
        onViewMerged={() => changeTab("merged")}
      />
    </div>
  );
}
