"use client";

import { CalendarRange, Download, Filter, History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, PageHeader, SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { useEnsureInvoices } from "@/components/v2/autopilot/useEnsureInvoices";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEmailInvoiceIds } from "@/store/inboundEmail/inboundEmailApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { AuditEventModal } from "./AuditEventModal";
import { ActorCell, formatTimestamp, relativeTime, withProvider } from "./format";
import { buildInvoiceAuditEvents } from "./invoiceEvents";
import { EVENT_TYPE_LABELS, type ActorType, type AuditEvent, type AuditEventType } from "./types";

type ActorTab = "all" | ActorType;
type RangeValue = "1" | "7" | "30" | "90" | "all";

const RANGE_OPTIONS: { value: RangeValue; label: string }[] = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function AuditTrailContentV2() {
  const provider = useActiveProvider();
  // Real activity from the invoices already in the store (uploads, status
  // changes, who posted). Other event types need the audit-log API (BE).
  useEnsureInvoices();
  const dispatch = useAppDispatch();
  const invoices = useAppSelector((state) => state.invoice.invoices);
  const emailInvoiceIds = useAppSelector((state) => state.inboundEmail.emailInvoiceIds);
  useEffect(() => {
    dispatch(fetchEmailInvoiceIds());
  }, [dispatch]);
  const events: AuditEvent[] = useMemo(() => buildInvoiceAuditEvents(invoices, emailInvoiceIds), [invoices, emailInvoiceIds]);
  const [search, setSearch] = useState("");
  const [actorTab, setActorTab] = useState<ActorTab>("all");
  const [eventType, setEventType] = useState<"all" | AuditEventType>("all");
  const [range, setRange] = useState<RangeValue>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // Reference time for the date-range filter, fixed when the page opens.
  const [now] = useState(() => Date.now());

  // Everything except the actor filter, so the tab counts reflect the other filters.
  const baseFiltered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const cutoff = range === "all" ? 0 : now - Number(range) * 24 * 60 * 60_000;
    return events.filter((e) => {
      if (eventType !== "all" && e.type !== eventType) return false;
      if (cutoff && new Date(e.at).getTime() < cutoff) return false;
      if (!lower) return true;
      return [e.actorName, e.item.label, e.details, EVENT_TYPE_LABELS[e.type], e.source].some((v) => v.toLowerCase().includes(lower));
    });
  }, [events, search, eventType, range, now]);

  const counts = useMemo(() => {
    const c: Record<ActorTab, number> = { all: baseFiltered.length, person: 0, autopilot: 0, assistant: 0 };
    baseFiltered.forEach((e) => (c[e.actorType] += 1));
    return c;
  }, [baseFiltered]);

  const filtered = useMemo(() => (actorTab === "all" ? baseFiltered : baseFiltered.filter((e) => e.actorType === actorTab)), [baseFiltered, actorTab]);

  const filtersActive = Boolean(search.trim()) || actorTab !== "all" || eventType !== "all" || range !== "all";
  const clearFilters = () => {
    setSearch("");
    setActorTab("all");
    setEventType("all");
    setRange("all");
  };

  const exportCsv = () => {
    notifyBackendPending("Export CSV");
    // Until the export endpoint exists, download the rows currently shown.
    const header = ["Time", "Actor", "Action", "Item", "Source", "Details"];
    const rows = filtered.map((e) =>
      [formatTimestamp(e.at), e.actorName, EVENT_TYPE_LABELS[e.type], e.item.label, e.source, withProvider(e.details, provider.name)].map(csvCell).join(","),
    );
    const blob = new Blob([[header.map(csvCell).join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columns: DataTableColumn<AuditEvent>[] = [
    {
      key: "time",
      header: "Time",
      width: "13%",
      render: (e) => (
        <span className="block min-w-0" title={formatTimestamp(e.at)}>
          <span className="block truncate font-semibold">{relativeTime(e.at)}</span>
          <span className="block truncate text-content-secondary">
            {new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </span>
      ),
    },
    { key: "actor", header: "Actor", width: "17%", render: (e) => <ActorCell event={e} /> },
    { key: "action", header: "Action", width: "13%", render: (e) => <span className="block truncate font-semibold">{EVENT_TYPE_LABELS[e.type]}</span> },
    { key: "item", header: "Item", width: "24%", render: (e) => <span className="block truncate" title={e.item.label}>{e.item.label}</span> },
    { key: "source", header: "Source", width: "9%", render: (e) => <Badge variant="neutral">{e.source}</Badge> },
    {
      key: "details",
      header: "Details",
      width: "24%",
      render: (e) => {
        const text = withProvider(e.details, provider.name);
        return (
          <span className="block truncate text-content-secondary" title={text}>
            {text}
          </span>
        );
      },
    },
  ];

  const openEvent = events.find((e) => e.id === openId) ?? null;

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Audit Trail"
        subtitle="Every change made by your team, Autopilot and the AI assistant — who did what, when, and from where."
        action={
          <Button variant="outline" size="sm" className="shrink-0" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={16} strokeWidth={2.25} />
            {beLabel("Export CSV")}
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)]">
          <div className="flex flex-col gap-[var(--space-md)] lg:flex-row lg:items-center">
            <div className="max-w-full overflow-x-auto">
              <Tabs
                items={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "person", label: "People", count: counts.person },
                  { value: "autopilot", label: "Autopilot", count: counts.autopilot },
                  { value: "assistant", label: "AI assistant", count: counts.assistant },
                ]}
                value={actorTab}
                onChange={(v) => setActorTab(v as ActorTab)}
              />
            </div>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, items or details…"
              widthClassName="w-full lg:w-80"
            />
          </div>
          <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
            <SelectDropdown
              uiSize="sm"
              icon={<Filter size={14} strokeWidth={2.25} />}
              aria-label="Event type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as "all" | AuditEventType)}
            >
              <option value="all">All events</option>
              {(Object.keys(EVENT_TYPE_LABELS) as AuditEventType[]).map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectDropdown>
            <SelectDropdown
              uiSize="sm"
              icon={<CalendarRange size={14} strokeWidth={2.25} />}
              aria-label="Date range"
              value={range}
              onChange={(e) => setRange(e.target.value as RangeValue)}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectDropdown>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-caption font-bold text-accent hover:underline">
                Clear filters
              </button>
            )}
            <span className="ml-auto text-caption text-content-secondary">
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<History size={28} strokeWidth={1.75} />}
            title={events.length === 0 ? "No activity yet" : "No activity matches these filters"}
            description={
              events.length === 0
                ? "Upload an invoice and its activity will be listed here. Edits, approvals and settings changes appear once the audit log is connected (BE)."
                : "Try a wider date range or a different event type or actor."
            }
            actionLabel={filtersActive ? "Clear filters" : undefined}
            onAction={filtersActive ? clearFilters : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <DataTable
                columns={columns}
                rows={filtered}
                getRowKey={(e) => e.id}
                onRowClick={(e) => setOpenId(e.id)}
                bordered={false}
                maxHeightClassName="max-h-[600px]"
              />
            </div>
          </div>
        )}
      </div>

      <AuditEventModal event={openEvent} providerName={provider.name} onClose={() => setOpenId(null)} />
    </div>
  );
}
