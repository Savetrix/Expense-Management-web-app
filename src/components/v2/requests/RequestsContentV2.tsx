"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar, DataTable, PageHeader, ProgressBar, SearchInput, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";

import { dueText, formatDate, isOverdue, receivedCount } from "./format";
import { MOCK_REQUESTS, requestTypeLabel, type PaperworkRequest } from "./mockData";
import { NewRequestWizard, type RequestPrefill } from "./NewRequestWizard";
import { RequestDetailModal } from "./RequestDetailModal";

type RequestTab = "open" | "overdue" | "completed";

const EMPTY_COPY: Record<RequestTab, { title: string; description: string }> = {
  open: { title: "No open requests", description: "Ask someone for missing invoices, receipts or statements and track the replies here." },
  overdue: { title: "Nothing overdue", description: "Every open request is still within its due date." },
  completed: { title: "No completed requests yet", description: "Requests move here once everything is received, or when you close them." },
};

export function RequestsContentV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [requests, setRequests] = useState<PaperworkRequest[]>(MOCK_REQUESTS);
  const [tab, setTab] = useState<RequestTab>("open");
  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [prefill, setPrefill] = useState<RequestPrefill | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const openWizard = useCallback((next: RequestPrefill | null = null) => {
    setPrefill(next);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);

  // /requests?new=1 (e.g. "Request invoice from vendor" on a supplier
  // statement) lands straight in the wizard, optionally with the item filled.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || searchParams.get("new") !== "1") return;
    autoOpenedRef.current = true;
    const amount = Number(searchParams.get("amount"));
    const item = searchParams.get("item") ?? undefined;
    openWizard(
      item || searchParams.get("vendor")
        ? {
            vendor: searchParams.get("vendor") ?? undefined,
            item,
            amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
            date: searchParams.get("date") ?? undefined,
          }
        : null,
    );
    router.replace("/requests");
  }, [searchParams, router, openWizard]);

  const tabOf = (r: PaperworkRequest): RequestTab => (r.status !== "open" ? "completed" : isOverdue(r) ? "overdue" : "open");

  const counts = useMemo(() => {
    const c: Record<RequestTab, number> = { open: 0, overdue: 0, completed: 0 };
    requests.forEach((r) => (c[tabOf(r)] += 1));
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return requests
      .filter((r) => tabOf(r) === tab)
      .filter((r) => !lower || r.title.toLowerCase().includes(lower) || r.assigneeName.toLowerCase().includes(lower) || r.assigneeEmail.toLowerCase().includes(lower))
      .sort((a, b) => (tab === "completed" ? b.sentAt.localeCompare(a.sentAt) : a.dueDate.localeCompare(b.dueDate)));
  }, [requests, tab, search]);

  const updateRequest = useCallback((id: string, update: (r: PaperworkRequest) => PaperworkRequest) => {
    setRequests((list) => list.map((r) => (r.id === id ? update(r) : r)));
  }, []);

  const handleSend = (request: PaperworkRequest) => {
    setRequests((list) => [request, ...list]);
    setTab("open");
    showToast(`Request sent to ${request.assigneeEmail}.`, "success");
  };

  const openRequest = requests.find((r) => r.id === openId) ?? null;

  const columns: DataTableColumn<PaperworkRequest>[] = [
    {
      key: "title",
      header: "Request",
      width: "28%",
      render: (r) => (
        <span className="block min-w-0 py-[var(--space-xs)]">
          <span className="block truncate font-bold text-content-primary">{r.title}</span>
          <span className="block truncate text-content-secondary">{requestTypeLabel(r.type)}</span>
        </span>
      ),
    },
    {
      key: "assignee",
      header: "Assignee",
      width: "26%",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <Avatar name={r.assigneeName} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{r.assigneeName}</span>
            <span className="block truncate text-content-secondary">{r.assigneeEmail}</span>
          </span>
        </span>
      ),
    },
    {
      key: "items",
      header: "Items",
      width: "8%",
      render: (r) => <span className="font-semibold">{r.items.length}</span>,
    },
    {
      key: "progress",
      header: "Progress",
      width: "18%",
      render: (r) => {
        const got = receivedCount(r);
        return (
          <span className="block min-w-0">
            <span className="block truncate text-content-secondary">
              {got} of {r.items.length} received
            </span>
            <span className="mt-[var(--space-xs)] block">
              <ProgressBar percent={r.items.length ? (got / r.items.length) * 100 : 0} colorClassName="bg-accent" label="Items received" />
            </span>
          </span>
        );
      },
    },
    {
      key: "due",
      header: "Due",
      width: "20%",
      align: "right",
      render: (r) => (
        <span className="flex flex-col items-end gap-[2px]">
          <span className="truncate">{formatDate(r.dueDate)}</span>
          {r.status === "completed" ? (
            <Badge variant="success">Completed</Badge>
          ) : r.status === "cancelled" ? (
            <Badge variant="neutral">Cancelled</Badge>
          ) : isOverdue(r) ? (
            <Badge variant="error">{dueText(r.dueDate)}</Badge>
          ) : (
            <span className="truncate text-content-secondary">{dueText(r.dueDate)}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Paperwork Requests"
        subtitle="Ask clients, vendors or teammates for missing paperwork. Replies are matched automatically and chased with reminders."
        action={
          <Button size="sm" className="shrink-0" onClick={() => openWizard()}>
            <Plus size={16} strokeWidth={2.5} />
            New request
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center">
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={[
                { value: "open", label: "Open", count: counts.open },
                { value: "overdue", label: "Overdue", count: counts.overdue },
                { value: "completed", label: "Completed", count: counts.completed },
              ]}
              value={tab}
              onChange={(v) => setTab(v as RequestTab)}
            />
          </div>
          {requests.length > 0 && (
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requests or people…"
              widthClassName="w-full lg:w-80"
            />
          )}
        </div>

        {filtered.length === 0 ? (
          search.trim() ? (
            <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No requests match &quot;{search}&quot;.</div>
          ) : (
            <EmptyState
              icon={<ClipboardList size={28} strokeWidth={1.75} />}
              title={EMPTY_COPY[tab].title}
              description={EMPTY_COPY[tab].description}
              actionLabel={tab === "open" ? "New request" : undefined}
              onAction={tab === "open" ? () => openWizard() : undefined}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <DataTable
                columns={columns}
                rows={filtered}
                getRowKey={(r) => r.id}
                onRowClick={(r) => setOpenId(r.id)}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        )}
      </div>

      {wizardOpen && (
        <NewRequestWizard
          key={wizardKey}
          prefill={prefill}
          onClose={() => setWizardOpen(false)}
          onSend={handleSend}
          onView={(id) => {
            setWizardOpen(false);
            setOpenId(id);
          }}
        />
      )}

      <RequestDetailModal request={openRequest} onClose={() => setOpenId(null)} onChange={updateRequest} />
    </div>
  );
}
