"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, ChevronRight, FileX2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
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
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { OutcomeMixCard } from "@/components/invoices/OutcomeMixCard";
import { TopVendorsCard } from "@/components/invoices/TopVendorsCard";
import { SelectedInvoiceCard, vendorInitials } from "@/components/invoices/SelectedInvoiceCard";

type ListType = "auto" | "manual" | "failed";
// Separate from ListType (which only drives the 3 outcome stat tiles) so
// adding "pending" here doesn't add a 4th tile — it's purely a filter/view
// option, matching PendingInvoicesContent's own dedicated review flow.
type StatusFilter = "all" | "pending" | ListType;

const STATUS_ORDER: StatusFilter[] = ["all", "pending", "auto", "manual", "failed"];
const TAB_ORDER: ListType[] = ["auto", "manual", "failed"];

const STATUS_META: Record<StatusFilter, { label: string; emptyMessage: string }> = {
  all: {
    label: "All",
    emptyMessage: "No invoices yet. Scanned invoices will appear here.",
  },
  pending: {
    label: "Pending",
    emptyMessage: "No pending invoices. Invoices awaiting review will appear here.",
  },
  auto: {
    label: "Auto-Posted",
    emptyMessage: "No auto-posted invoices yet. Invoices with high confidence will appear here.",
  },
  manual: {
    label: "Manually Posted",
    emptyMessage: "No manually posted invoices yet. Reviewed invoices will appear here.",
  },
  failed: {
    label: "Failed",
    emptyMessage: "No failed invoices. Invoices that couldn't be processed will appear here.",
  },
};

const SORT_OPTIONS: { by: "date" | "amount"; dir: "asc" | "desc"; label: string }[] = [
  { by: "date", dir: "desc", label: "Newest first" },
  { by: "date", dir: "asc", label: "Oldest first" },
  { by: "amount", dir: "desc", label: "Amount: high to low" },
  { by: "amount", dir: "asc", label: "Amount: low to high" },
];

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

function formatTotal({ total, currency }: { total: number; currency: string }): string {
  return `${currency} ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
}

export function InvoiceListContent() {
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
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);

  const [searchText, setSearchText] = useState("");
  const [sortIndex, setSortIndex] = useState(0);
  const [vendorFilter, setVendorFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const sort = SORT_OPTIONS[sortIndex];

  const refetch = () => {
    dispatch(getInvoices());
  };

  // Depends on qbConnectionId (not just mount) so switching companies in the
  // top bar re-fetches for the new entity instead of leaving the previous
  // one's invoices on screen until a manual reload. Guarded on qbConnectionId
  // being set since right after login it's briefly blank — see
  // DashboardContent's identical guard for why firing earlier 400s.
  useEffect(() => {
    if (!qbConnectionId) return;
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  // Clears a leftover search/selection when switching status — a match (or
  // a selected row) from a different status has no bearing on this one.
  useEffect(() => {
    setSearchText("");
    setSelectedInvoiceId(null);
  }, [statusFilter]);

  const combinedInvoices = useMemo(
    () => [...pendingInvoices, ...autoPostedInvoices, ...manualPostedInvoices, ...failedInvoices],
    [pendingInvoices, autoPostedInvoices, manualPostedInvoices, failedInvoices],
  );

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

  // Pending invoices go straight to the editable review screen (matching
  // PendingInvoicesContent's handleOpenInvoice) since a pending invoice has
  // no posted data yet worth showing read-only.
  const handleOpenFullDetails = (invoice: InvoiceRecord) => {
    dispatch(setSelectedInvoice(invoice));
    if (invoice.postedStatus === "pending") {
      router.push(`/invoices/${invoice._id}/review`);
      return;
    }
    router.push(`/invoices/${invoice._id}${statusFilter !== "all" ? `?type=${statusFilter}` : ""}`);
  };

  const selectedInvoice = selectedInvoiceId
    ? statusFilteredInvoices.find((invoice) => invoice._id === selectedInvoiceId) || null
    : null;

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

  return (
    <div className="mx-auto max-w-7xl p-[var(--space-lg)]">
      <div className="grid grid-cols-1 gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex flex-col gap-[var(--space-md)]">
          {/* Stat tiles — real dollar totals per status, doubling as status
              shortcuts (matches the old StatRow cards' click-to-switch
              behavior, plus a dark "Total" hero tile across all three). */}
          <div className="grid grid-cols-2 gap-[var(--space-sm)] sm:grid-cols-4">
            <button
              type="button"
              onClick={() => router.replace("/invoices?type=all")}
              className="rounded-lg bg-primary-900 p-[var(--space-md)] text-left text-white"
            >
              <p className="text-caption font-semibold uppercase tracking-wide text-primary-200">Total</p>
              <p className="mt-[var(--space-xs)] text-h2 font-bold">{formatTotal(totals.total)}</p>
              <p className="mt-[var(--space-xs)] text-caption text-primary-200">
                {combinedInvoices.length} invoice{combinedInvoices.length === 1 ? "" : "s"}
              </p>
            </button>
            {TAB_ORDER.map((t) => {
              const tileTheme = INVOICE_STATUS_THEME[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => router.replace(`/invoices?type=${t}`)}
                  className={`rounded-lg p-[var(--space-md)] text-left ${tileTheme.cardBgClass}`}
                >
                  <p className={`text-caption font-semibold uppercase tracking-wide ${tileTheme.accentTextClass}`}>
                    {tileTheme.label}
                  </p>
                  <p className={`mt-[var(--space-xs)] text-h2 font-bold ${tileTheme.accentTextClass}`}>
                    {formatTotal(totals[t])}
                  </p>
                  <p className={`mt-[var(--space-xs)] text-caption ${tileTheme.accentTextClass}`}>
                    {tabCounts[t]} invoice{tabCounts[t] === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-border bg-white">
            {/* Filter bar */}
            <div className="flex flex-col gap-[var(--space-sm)] border-b border-border p-[var(--space-md)]">
              {/* Row 1: search + sort */}
              <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                <label className="flex min-w-0 flex-1 items-center gap-[var(--space-xs)] rounded-pill bg-background-alt px-[var(--space-md)] py-[10px] lg:flex-none lg:w-72 lg:py-[var(--space-xs)]">
                  <Search size={14} strokeWidth={2.25} className="shrink-0 text-text-secondary" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search vendor, invoice #, amount"
                    className="w-full min-w-0 bg-transparent text-body-sm text-text-primary outline-none placeholder:text-text-secondary"
                  />
                </label>
                <label className="flex shrink-0 items-center gap-[var(--space-xs)] rounded-pill border border-border px-[var(--space-md)] py-[10px] text-body-sm font-semibold text-text-secondary hover:bg-background-alt lg:ml-auto lg:py-[var(--space-xs)]">
                  <ArrowUpDown size={14} strokeWidth={2.25} className="shrink-0" />
                  <select
                    value={sortIndex}
                    onChange={(event) => setSortIndex(Number(event.target.value))}
                    className="bg-transparent text-body-sm font-semibold text-text-secondary focus:outline-none"
                  >
                    {SORT_OPTIONS.map((option, index) => (
                      <option key={option.label} value={index}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Row 2: status, vendor, currency */}
              <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                <select
                  value={statusFilter}
                  onChange={(event) => router.replace(`/invoices?type=${event.target.value}`)}
                  className="rounded-pill border border-border bg-white px-[var(--space-md)] py-[10px] text-body-sm font-semibold text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 lg:py-[var(--space-xs)]"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      Status: {STATUS_META[s].label}
                    </option>
                  ))}
                </select>

                <select
                  value={vendorFilter}
                  onChange={(event) => setVendorFilter(event.target.value)}
                  className="max-w-[160px] rounded-pill border border-border bg-white px-[var(--space-md)] py-[10px] text-body-sm font-semibold text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 lg:py-[var(--space-xs)]"
                >
                  <option value="all">Vendor: All</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>

                <select
                  value={currencyFilter}
                  onChange={(event) => setCurrencyFilter(event.target.value)}
                  className="rounded-pill border border-border bg-white px-[var(--space-md)] py-[10px] text-body-sm font-semibold text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 lg:py-[var(--space-xs)]"
                >
                  <option value="all">Currency: All</option>
                  {currencyOptions.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Table header */}
            {!loading && !error && statusFilteredInvoices.length > 0 && (
              <div className="hidden gap-[var(--space-sm)] px-[var(--space-md)] pb-[var(--space-sm)] pt-[var(--space-md)] text-caption font-bold uppercase tracking-wide text-text-secondary lg:grid lg:grid-cols-[40px_2fr_1fr_1.5fr_1fr_1fr_24px]">
                <span />
                <span>Vendor / Invoice</span>
                <span>Received</span>
                <span>Uploaded By</span>
                <span>Status</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
            )}

            {loading ? (
              <div className="p-[var(--space-md)]">
                <SkeletonListRows count={4} />
              </div>
            ) : error ? (
              <div className="p-[var(--space-md)]">
                <ErrorState message="Couldn't load these invoices." onRetry={refetch} />
              </div>
            ) : statusFilteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center py-[var(--space-xl)] text-center">
                <span className="mb-[var(--space-md)] flex h-24 w-24 items-center justify-center rounded-full bg-background-alt">
                  <FileX2 size={40} strokeWidth={1.5} className="text-text-secondary" />
                </span>
                <p className="text-h3 font-extrabold text-text-primary">No invoices found</p>
                <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-text-secondary">{meta.emptyMessage}</p>
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center py-[var(--space-xl)] text-center">
                <p className="font-bold text-text-primary">No invoices match these filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchText("");
                    setVendorFilter("all");
                    setCurrencyFilter("all");
                  }}
                  className="mt-[var(--space-sm)] text-body-sm font-semibold text-primary-700"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div>
                {filteredInvoices.map((invoice) => {
                  const rowTheme = INVOICE_STATUS_THEME[getInvoiceStatus(invoice.postedStatus)];
                  const failureReason = getInvoiceFailureReason(invoice);
                  const confidence =
                    invoice.confidenceScore != null ? `${Math.round(Number(invoice.confidenceScore))}%` : null;
                  const isSelected = invoice._id === selectedInvoiceId;
                  return (
                    <button
                      key={invoice._id}
                      type="button"
                      onClick={() => setSelectedInvoiceId(invoice._id)}
                      className={`flex w-full items-start gap-[var(--space-sm)] border-b border-border px-[var(--space-md)] py-[var(--space-sm)] text-left last:border-b-0 lg:grid lg:grid-cols-[40px_2fr_1fr_1.5fr_1fr_1fr_24px] lg:items-center ${
                        isSelected ? "bg-primary-50" : "hover:bg-background-alt"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-caption font-bold ${rowTheme.cardBgClass} ${rowTheme.accentTextClass}`}
                      >
                        {vendorInitials(invoice)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-text-primary">
                          {getInvoiceTitle(invoice)}
                        </span>
                        {failureReason ? (
                          <span className="block truncate text-caption text-error">{failureReason}</span>
                        ) : confidence ? (
                          <span className="block truncate text-caption text-text-secondary">
                            {confidence} confidence
                          </span>
                        ) : null}
                        {/* Card-style meta line for mobile — the desktop table
                            columns below (date/badge/amount) are hidden here
                            via lg:hidden and shown separately as grid cells
                            at lg:+ so the desktop layout is unchanged. */}
                        <span className="mt-[var(--space-xs)] flex flex-wrap items-center gap-x-[var(--space-sm)] gap-y-[2px] lg:hidden">
                          <span
                            className={`inline-flex w-fit items-center rounded-pill px-[var(--space-sm)] py-[2px] text-caption font-bold ${rowTheme.badgeClass}`}
                          >
                            {rowTheme.label}
                          </span>
                          <span className="text-caption text-text-secondary">{getInvoicePostedDate(invoice)}</span>
                          <span className="ml-auto font-bold text-text-primary">{getInvoiceAmount(invoice)}</span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 truncate text-body-sm text-text-secondary lg:block">
                        {getInvoicePostedDate(invoice)}
                      </span>
                      <span className="hidden min-w-0 truncate text-body-sm text-text-secondary lg:block">
                        {getUserDisplayName(invoice.uploadedBy) || "—"}
                      </span>
                      <span className="hidden min-w-0 lg:block">
                        <span
                          className={`inline-flex w-fit items-center rounded-pill px-[var(--space-sm)] py-[2px] text-caption font-bold ${rowTheme.badgeClass}`}
                        >
                          {rowTheme.label}
                        </span>
                      </span>
                      <span className="hidden min-w-0 truncate text-right font-bold text-text-primary lg:block">
                        {getInvoiceAmount(invoice)}
                      </span>
                      <ChevronRight
                        size={18}
                        strokeWidth={2}
                        className="mt-[2px] shrink-0 justify-self-end text-text-secondary lg:mt-0"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="sticky top-[var(--space-lg)] flex flex-col gap-[var(--space-md)]">
          {selectedInvoice ? (
            <SelectedInvoiceCard
              invoice={selectedInvoice}
              theme={INVOICE_STATUS_THEME[getInvoiceStatus(selectedInvoice.postedStatus)]}
              glAccounts={glAccounts}
              taxCodes={taxCodes}
              issueMessage={getInvoiceFailureReason(selectedInvoice)}
              onViewFullDetails={() => handleOpenFullDetails(selectedInvoice)}
              onClose={() => setSelectedInvoiceId(null)}
            />
          ) : (
            <>
              <OutcomeMixCard invoices={combinedInvoices} />
              <TopVendorsCard invoices={allInvoices} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
