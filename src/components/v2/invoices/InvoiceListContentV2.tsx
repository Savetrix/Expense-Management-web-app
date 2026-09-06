"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ChevronRight, FileX2, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEmailInvoiceIds } from "@/store/inboundEmail/inboundEmailApi";
import { getInvoices } from "@/store/invoice/invoiceApi";
import { setSelectedInvoice } from "@/store/invoice/invoiceSlice";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import {
  INVOICE_STATUS_THEME,
  getInvoiceAmount,
  getInvoiceFailureReason,
  getInvoicePostedDate,
  getInvoiceStatus,
  getInvoiceTitle,
  getUserDisplayName,
} from "@/lib/invoiceDisplay";
import { Badge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { vendorInitials } from "@/components/invoices/SelectedInvoiceCard";
import { Avatar, DataTable, SearchInput, SelectDropdown } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { OutcomeMixCardV2 } from "@/components/v2/invoices/OutcomeMixCardV2";
import { TopVendorsCardV2 } from "@/components/v2/invoices/TopVendorsCardV2";

type ListType = "auto" | "manual" | "failed";
type StatusFilter = "all" | "pending" | ListType;

const STATUS_ORDER: StatusFilter[] = ["all", "pending", "auto", "manual", "failed"];
const TAB_ORDER: ListType[] = ["auto", "manual", "failed"];

const STATUS_META: Record<StatusFilter, { label: string; emptyMessage: string }> = {
  all: { label: "All", emptyMessage: "No invoices yet. Scanned invoices will appear here." },
  pending: { label: "Pending", emptyMessage: "No pending invoices. Invoices awaiting review will appear here." },
  auto: {
    label: "Auto-Posted",
    emptyMessage: "No auto-posted invoices yet. Invoices with high confidence will appear here.",
  },
  manual: {
    label: "Manually Posted",
    emptyMessage: "No manually posted invoices yet. Reviewed invoices will appear here.",
  },
  failed: { label: "Failed", emptyMessage: "No failed invoices. Invoices that couldn't be processed will appear here." },
};

const SORT_OPTIONS: { by: "date" | "amount"; dir: "asc" | "desc"; label: string }[] = [
  { by: "date", dir: "desc", label: "Newest first" },
  { by: "date", dir: "asc", label: "Oldest first" },
  { by: "amount", dir: "desc", label: "Amount: high to low" },
  { by: "amount", dir: "asc", label: "Amount: low to high" },
];

// Status → Badge variant. "manual" and "pending" both read as the same
// amber "needs attention" tone in the reference design (its Pending pill
// and Manually Posted stat tile share one color), unlike the legacy /invoices
// screen where pending is a separate navy tone — an intentional v2 restyle,
// not a functional change (still driven by the same postedStatus value).
const STATUS_BADGE_VARIANT: Record<ReturnType<typeof getInvoiceStatus>, "success" | "warning" | "error"> = {
  auto: "success",
  manual: "warning",
  pending: "warning",
  processing: "warning",
  failed: "error",
};

function isListType(value: string | null): value is ListType {
  return value === "auto" || value === "manual" || value === "failed";
}

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === "all" || value === "pending" || isListType(value);
}

function invoiceTimestamp(invoice: InvoiceRecord): number {
  const history = invoice.statusHistory;
  const latest = history && history.length > 0 ? history[history.length - 1] : undefined;
  const dateStr = latest?.changedAt || invoice.extractedData?.invoiceDate || invoice.createdAt;
  if (!dateStr) return 0;
  const parsed = new Date(dateStr).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sumAndCurrency(list: InvoiceRecord[]): { total: number; currency: string } {
  const total = list.reduce((sum, invoice) => sum + (invoice.extractedData?.totalAmount || 0), 0);
  const currency = list.find((invoice) => invoice.extractedData?.currency)?.extractedData?.currency || "";
  return { total, currency };
}

function formatAmount(total: number): string {
  return total.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function InvoiceListContentV2() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();

  const typeParam = searchParams.get("type");
  const statusFilter: StatusFilter = isStatusFilter(typeParam) ? typeParam : "all";

  const {
    invoices: allInvoices,
    autoPostedInvoices,
    manualPostedInvoices,
    pendingInvoices,
    failedInvoices,
    loading,
    error,
  } = useAppSelector((state) => state.invoice);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const emailInvoiceIds = useAppSelector((state) => state.inboundEmail.emailInvoiceIds);

  const [searchText, setSearchText] = useState("");
  const [sortIndex, setSortIndex] = useState(0);
  const [vendorFilter, setVendorFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const sort = SORT_OPTIONS[sortIndex];

  const refetch = () => {
    dispatch(getInvoices());
  };

  useEffect(() => {
    if (!qbConnectionId) return;
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  useEffect(() => {
    dispatch(fetchEmailInvoiceIds());
  }, [dispatch]);

  useEffect(() => {
    setSearchText("");
  }, [statusFilter]);

  const combinedInvoices = useMemo(
    () => [...pendingInvoices, ...autoPostedInvoices, ...manualPostedInvoices, ...failedInvoices],
    [pendingInvoices, autoPostedInvoices, manualPostedInvoices, failedInvoices],
  );

  const emailSourced = useMemo(() => new Set(emailInvoiceIds), [emailInvoiceIds]);

  const statusFilteredInvoices: InvoiceRecord[] = useMemo(() => {
    if (statusFilter === "all") return combinedInvoices;
    if (statusFilter === "pending") return pendingInvoices;
    if (statusFilter === "auto") return autoPostedInvoices;
    if (statusFilter === "manual") return manualPostedInvoices;
    return failedInvoices;
  }, [statusFilter, combinedInvoices, pendingInvoices, autoPostedInvoices, manualPostedInvoices, failedInvoices]);

  const vendorOptions = useMemo(() => {
    const names = new Set<string>();
    combinedInvoices.forEach((invoice) => {
      const name = invoice.extractedData?.vendorName?.trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [combinedInvoices]);

  const currencyOptions = useMemo(() => {
    const currencies = new Set<string>();
    combinedInvoices.forEach((invoice) => {
      const currency = invoice.extractedData?.currency?.trim();
      if (currency) currencies.add(currency);
    });
    return Array.from(currencies).sort();
  }, [combinedInvoices]);

  const filteredInvoices = useMemo(() => {
    let list = statusFilteredInvoices;

    if (vendorFilter !== "all") {
      list = list.filter((invoice) => invoice.extractedData?.vendorName === vendorFilter);
    }
    if (currencyFilter !== "all") {
      list = list.filter((invoice) => invoice.extractedData?.currency === currencyFilter);
    }

    const query = searchText.trim().toLowerCase();
    if (query) {
      list = list.filter((invoice) => {
        const vendor = invoice.extractedData?.vendorName?.toLowerCase() || "";
        const number = invoice.extractedData?.invoiceNumber?.toLowerCase() || "";
        const amount = String(invoice.extractedData?.totalAmount ?? "");
        return vendor.includes(query) || number.includes(query) || amount.includes(query);
      });
    }

    return [...list].sort((a, b) => {
      const aValue = sort.by === "amount" ? a.extractedData?.totalAmount || 0 : invoiceTimestamp(a);
      const bValue = sort.by === "amount" ? b.extractedData?.totalAmount || 0 : invoiceTimestamp(b);
      return sort.dir === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [statusFilteredInvoices, vendorFilter, currencyFilter, searchText, sort]);

  const handleOpenFullDetails = (invoice: InvoiceRecord) => {
    dispatch(setSelectedInvoice(invoice));
    if (invoice.postedStatus === "pending") {
      router.push(`/invoices/${invoice._id}/review`);
      return;
    }
    router.push(`/invoices/${invoice._id}${statusFilter !== "all" ? `?type=${statusFilter}` : ""}`);
  };

  const tabCounts: Record<ListType, number> = {
    auto: autoPostedInvoices.length,
    manual: manualPostedInvoices.length,
    failed: failedInvoices.length,
  };

  const totals = useMemo(
    () => ({
      total: sumAndCurrency(combinedInvoices),
      auto: sumAndCurrency(autoPostedInvoices),
      manual: sumAndCurrency(manualPostedInvoices),
      failed: sumAndCurrency(failedInvoices),
    }),
    [combinedInvoices, autoPostedInvoices, manualPostedInvoices, failedInvoices],
  );

  const meta = STATUS_META[statusFilter];

  const columns: DataTableColumn<InvoiceRecord>[] = [
    {
      key: "vendor",
      header: "Vendor / Invoice",
      width: "38%",
      render: (invoice) => {
        const status = getInvoiceStatus(invoice.postedStatus);
        const failureReason = getInvoiceFailureReason(invoice);
        const confidence = invoice.confidenceScore != null ? `${Math.round(Number(invoice.confidenceScore))}%` : null;
        const fromEmail = emailSourced.has(invoice._id);
        return (
          <div className="flex items-center gap-[var(--space-xs)]">
            <Avatar
              name={getInvoiceTitle(invoice)}
              initials={vendorInitials(invoice)}
              shape="square"
              size="sm"
              toneClassName={status === "auto" ? "bg-accent-bg text-status-success-text" : "bg-border text-nav-bg"}
            />
            <div className="min-w-0">
              <p className="truncate text-caption font-bold text-content-primary">{getInvoiceTitle(invoice)}</p>
              {failureReason ? (
                <p className="truncate text-tiny text-status-danger-text">{failureReason}</p>
              ) : confidence ? (
                <p className="truncate text-tiny text-content-secondary">{confidence} confidence</p>
              ) : null}
              {fromEmail && (
                <span className="mt-[2px] inline-flex w-fit items-center gap-[2px] rounded-pill bg-surface-alt px-[var(--space-xs)] py-[1px] text-tiny font-bold text-content-secondary">
                  <Mail size={10} strokeWidth={2.5} />
                  Email
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "received",
      header: "Received",
      width: "14%",
      render: (invoice) => (
        <span className="block truncate whitespace-nowrap text-content-secondary">{getInvoicePostedDate(invoice)}</span>
      ),
    },
    {
      key: "uploadedBy",
      header: "Uploaded By",
      width: "20%",
      render: (invoice) => (
        <span className="block truncate text-content-secondary">{getUserDisplayName(invoice.uploadedBy) || "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (invoice) => {
        const status = getInvoiceStatus(invoice.postedStatus);
        return (
          <span className="block truncate whitespace-nowrap">
            <Badge variant={STATUS_BADGE_VARIANT[status]}>{INVOICE_STATUS_THEME[status].label}</Badge>
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "12%",
      render: (invoice) => (
        <span className="block truncate whitespace-nowrap font-bold text-content-primary">{getInvoiceAmount(invoice)}</span>
      ),
    },
    {
      key: "chevron",
      header: "",
      align: "right",
      width: "32px",
      render: () => <ChevronRight size={16} strokeWidth={2} className="inline text-content-muted" />,
    },
  ];

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      {/* 6-column grid (4/2 split, ~66/33) instead of a centered max-width
          column + fixed 320px sidebar — the fixed sidebar left dead space on
          wide viewports instead of the two sides scaling together. Stacks to
          a single column below lg. */}
      <div className="grid grid-cols-1 gap-[var(--space-md)] sm:gap-[var(--space-lg)] lg:grid-cols-6 lg:items-start">
        <div className="flex min-w-0 flex-col gap-[var(--space-md)] lg:col-span-4">
          {/* Stat tiles — real per-status dollar totals, doubling as status
              shortcuts (click to filter), matching the reference design's
              dark "Total" hero tile + 3 status-tinted tiles. */}
          <div className="grid grid-cols-2 gap-[var(--space-sm)] sm:grid-cols-4">
            <button
              type="button"
              onClick={() => router.replace("/v2/invoices?type=all")}
              className="flex flex-col justify-between rounded-lg border border-nav-bg bg-nav-bg px-[var(--space-sm)] py-[10px] text-left"
            >
              <p className="text-tiny font-bold uppercase tracking-wider text-nav-muted">Total</p>
              <div className="my-[2px]">
                <p className="text-tiny font-medium text-nav-muted">{totals.total.currency || "—"}</p>
                <p className="text-h3 font-bold tracking-tight text-white">{formatAmount(totals.total.total)}</p>
              </div>
              <p className="text-tiny text-nav-muted">
                {combinedInvoices.length} invoice{combinedInvoices.length === 1 ? "" : "s"}
              </p>
            </button>
            {TAB_ORDER.map((t) => {
              const tileTheme = INVOICE_STATUS_THEME[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => router.replace(`/v2/invoices?type=${t}`)}
                  className={`flex flex-col justify-between rounded-lg border px-[var(--space-sm)] py-[10px] text-left ${tileTheme.cardBgClass} ${
                    t === "auto"
                      ? "border-status-success-border"
                      : t === "manual"
                        ? "border-status-warning-border"
                        : "border-status-danger-border"
                  }`}
                >
                  <p className={`text-tiny font-bold uppercase tracking-wider ${tileTheme.accentTextClass}`}>
                    {tileTheme.label}
                  </p>
                  <div className="my-[2px]">
                    <p className={`text-tiny font-medium ${tileTheme.accentTextClass}`}>{totals[t].currency || "—"}</p>
                    <p className={`text-h3 font-bold tracking-tight ${tileTheme.accentTextClass}`}>
                      {formatAmount(totals[t].total)}
                    </p>
                  </div>
                  <p className={`text-tiny ${tileTheme.accentTextClass}`}>
                    {tabCounts[t]} invoice{tabCounts[t] === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {/* Filter toolbar */}
            <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)]">
              <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                <SearchInput
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search vendor, invoice #, amount"
                />
                <SelectDropdown
                  uiSize="sm"
                  icon={<ArrowUpDown size={14} strokeWidth={2.25} />}
                  value={sortIndex}
                  onChange={(event) => setSortIndex(Number(event.target.value))}
                  className="w-[150px] lg:ml-auto"
                >
                  {SORT_OPTIONS.map((option, index) => (
                    <option key={option.label} value={index}>
                      {option.label}
                    </option>
                  ))}
                </SelectDropdown>
              </div>

              <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                <SelectDropdown
                  uiSize="sm"
                  value={statusFilter}
                  onChange={(event) => router.replace(`/v2/invoices?type=${event.target.value}`)}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      Status: {STATUS_META[s].label}
                    </option>
                  ))}
                </SelectDropdown>

                <SelectDropdown uiSize="sm" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
                  <option value="all">Vendor: All</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </SelectDropdown>

                <SelectDropdown uiSize="sm" value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
                  <option value="all">Currency: All</option>
                  {currencyOptions.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
            </div>

            {loading ? (
              <div className="p-[var(--space-md)]">
                <SkeletonListRows count={4} />
              </div>
            ) : error ? (
              <div className="p-[var(--space-md)]">
                <ErrorState message="Couldn't load these invoices." onRetry={refetch} />
              </div>
            ) : statusFilteredInvoices.length === 0 ? (
              <EmptyState icon={<FileX2 size={28} strokeWidth={1.5} />} title="No invoices found" description={meta.emptyMessage} />
            ) : filteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center py-[var(--space-xl)] text-center">
                <p className="font-bold text-content-primary">No invoices match these filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchText("");
                    setVendorFilter("all");
                    setCurrencyFilter("all");
                  }}
                  className="mt-[var(--space-sm)] text-body-sm font-semibold text-accent"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={filteredInvoices}
                getRowKey={(invoice) => invoice._id}
                onRowClick={(invoice) => handleOpenFullDetails(invoice)}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            )}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--space-md)] lg:sticky lg:top-[var(--space-lg)] lg:col-span-2">
          <OutcomeMixCardV2 invoices={combinedInvoices} />
          <TopVendorsCardV2 invoices={allInvoices} />
        </aside>
      </div>
    </div>
  );
}
