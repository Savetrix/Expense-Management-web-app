"use client";

import Link from "next/link";
import { RefreshCw, Store } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, Modal, SearchInput } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { getUserDisplayName } from "@/lib/invoiceDisplay";
import { useAppSelector } from "@/store/hooks";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { formatDate, money } from "./format";

// "Statement" per vendor straight from the books: every bill Scantrix has
// posted, grouped by vendor and currency. This is real data already in the
// app. Pulling bills, payments and balances that were entered in the
// accounting software directly needs the backend (BE).

interface VendorAccount {
  key: string;
  vendor: string;
  currency: string;
  bills: InvoiceRecord[];
  total: number;
  latest: string; // YYYY-MM-DD or ""
}

function ymd(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : d.toISOString().slice(0, 10);
}

function groupByVendor(invoices: InvoiceRecord[]): VendorAccount[] {
  const map = new Map<string, VendorAccount>();
  for (const invoice of invoices) {
    const data = invoice.extractedData ?? {};
    const vendor = data.vendorName?.trim() || "Unknown vendor";
    const currency = data.currency?.trim() || "";
    const key = `${vendor.toLowerCase()}|${currency}`;
    const entry = map.get(key) ?? { key, vendor, currency, bills: [], total: 0, latest: "" };
    entry.bills.push(invoice);
    entry.total += Number(data.totalAmount ?? 0) || 0;
    const date = ymd(data.invoiceDate);
    if (date > entry.latest) entry.latest = date;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.vendor.localeCompare(b.vendor));
}

export function VendorAccountsPanel() {
  const provider = useActiveProvider();
  const autoPosted = useAppSelector((s) => s.invoice.autoPostedInvoices);
  const manualPosted = useAppSelector((s) => s.invoice.manualPostedInvoices);
  const loading = useAppSelector((s) => s.invoice.invoicesFetchPending);
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const accounts = useMemo(() => groupByVendor([...autoPosted, ...manualPosted]), [autoPosted, manualPosted]);
  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return lower ? accounts.filter((a) => a.vendor.toLowerCase().includes(lower)) : accounts;
  }, [accounts, search]);
  const open = accounts.find((a) => a.key === openKey) ?? null;

  const columns: DataTableColumn<VendorAccount>[] = [
    {
      key: "vendor",
      header: "Vendor",
      width: "40%",
      render: (a) => <span className="block truncate py-[var(--space-sm)] font-bold text-content-primary">{a.vendor}</span>,
    },
    {
      key: "bills",
      header: "Bills posted",
      width: "18%",
      render: (a) => <span className="block text-content-secondary">{a.bills.length}</span>,
    },
    {
      key: "latest",
      header: "Latest bill",
      width: "20%",
      render: (a) => <span className="block text-content-secondary">{a.latest ? formatDate(a.latest) : "—"}</span>,
    },
    {
      key: "total",
      header: "Total billed",
      width: "22%",
      align: "right",
      render: (a) => <span className="block truncate font-semibold">{money(a.total, a.currency || undefined)}</span>,
    },
  ];

  return (
    <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center lg:justify-between">
        <p className="text-body-sm text-content-secondary">
          Bills Scantrix has posted to {provider.name}, grouped by vendor. Bills entered in {provider.name} directly load once you sync.
        </p>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => notifyBackendPending(`Sync from ${provider.name}`)}>
          <RefreshCw size={14} strokeWidth={2.25} />
          {beLabel(`Sync from ${provider.name}`)}
        </Button>
      </div>

      {accounts.length > 0 && (
        <div className="border-b border-border p-[var(--space-md)]">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor…" widthClassName="w-full lg:w-80" />
        </div>
      )}

      {loading && accounts.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">Loading bills…</div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Store size={28} strokeWidth={1.75} />}
          title="No posted bills yet"
          description={`Once invoices are posted to ${provider.name}, each vendor's account appears here. Use Sync to load bills already in ${provider.name}.`}
        />
      ) : filtered.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No vendors match &quot;{search}&quot;.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <DataTable
              columns={columns}
              rows={filtered}
              getRowKey={(a) => a.key}
              onRowClick={(a) => setOpenKey(a.key)}
              bordered={false}
              maxHeightClassName="max-h-[560px]"
            />
          </div>
        </div>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpenKey(null)} title={open ? open.vendor : ""} widthClassName="max-w-2xl">
        {open && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <p className="text-body-sm text-content-secondary">
              {open.bills.length} bill{open.bills.length === 1 ? "" : "s"} posted · {money(open.total, open.currency || undefined)} in total
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {[...open.bills]
                .sort((a, b) => ymd(b.extractedData?.invoiceDate).localeCompare(ymd(a.extractedData?.invoiceDate)))
                .map((bill) => {
                  const date = ymd(bill.extractedData?.invoiceDate);
                  const by = getUserDisplayName(bill.quickbooks?.postedBy);
                  return (
                    <li key={bill._id}>
                      <Link
                        href={`/invoices/${bill._id}`}
                        className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] hover:bg-surface-alt"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm font-bold text-content-primary">
                            {bill.extractedData?.invoiceNumber?.trim() || "No number"}
                          </span>
                          <span className="block text-caption text-content-secondary">
                            {date ? formatDate(date) : "No date"}
                            {by ? ` · posted by ${by}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-body-sm font-semibold text-content-primary">
                          {money(Number(bill.extractedData?.totalAmount ?? 0) || 0, bill.extractedData?.currency || undefined)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
